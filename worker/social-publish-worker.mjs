import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const claimSocialPublish = makeFunctionReference("videoFlowV2:claimSocialPublish");
const updateSocialPublish = makeFunctionReference("videoFlowV2:updateSocialPublish");
const completeSocialPublish = makeFunctionReference("videoFlowV2:completeSocialPublish");

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.MEDIA_WORKER_SECRET;
const connectionId = process.env.SOCIAL_CONNECTION_ID;
const connectionSecret = process.env.SOCIAL_CONNECTION_SECRET;
const directAccessToken = process.env.SOCIAL_PROVIDER_ACCESS_TOKEN;
const zernioApiKey = process.env.ZERNIO_API_KEY;
const workerId = process.env.SOCIAL_WORKER_ID || `social-${randomUUID()}`;
const pollMs = Math.max(1_000, Number(process.env.SOCIAL_WORKER_POLL_MS || 5_000));

if (!convexUrl || !workerSecret || workerSecret.length < 32 || !connectionId || !connectionSecret || connectionSecret.length < 32 || (!directAccessToken && !zernioApiKey)) {
  throw new Error("CONVEX_URL, MEDIA_WORKER_SECRET, SOCIAL_CONNECTION_ID, SOCIAL_CONNECTION_SECRET, and either SOCIAL_PROVIDER_ACCESS_TOKEN or ZERNIO_API_KEY are required");
}

const client = new ConvexHttpClient(convexUrl);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checked(response, context) {
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  const error = new Error(`${context} failed with ${response.status}: ${body.slice(0, 1_000)}`);
  error.code = response.status >= 500 || response.status === 429 ? "provider_retryable" : "provider_rejected";
  throw error;
}

async function status(job, state, progress, error) {
  await client.action(updateSocialPublish, {
    workerSecret,
    jobId: job.jobId,
    workerId,
    status: state,
    progress,
    ...(error ? { errorCode: error.code || "social_worker_error", errorMessage: String(error.message || error).slice(0, 500) } : {}),
  });
}

async function download(job, path) {
  const response = await checked(await fetch(job.source.url), "Rendition download");
  if (!response.body) throw Object.assign(new Error("Rendition download did not include a body"), { code: "download_failed" });
  await pipeline(response.body, createWriteStream(path));
}

async function publishYouTube(job, path, accessToken) {
  const privacyStatus = job.privacy === "public" ? "public" : job.privacy === "unlisted" ? "unlisted" : "private";
  const metadata = JSON.stringify({
    snippet: { title: job.title.slice(0, 100), description: job.caption.slice(0, 5_000), categoryId: process.env.YOUTUBE_CATEGORY_ID || "22" },
    status: { privacyStatus, embeddable: true },
  });
  const initiate = await checked(await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "content-length": String(Buffer.byteLength(metadata)),
      "x-upload-content-length": String(job.source.sizeBytes),
      "x-upload-content-type": job.source.mimeType,
    },
    body: metadata,
  }), "YouTube upload initialization");
  const uploadUrl = initiate.headers.get("location");
  if (!uploadUrl) throw Object.assign(new Error("YouTube did not return a resumable upload URL"), { code: "provider_response_invalid" });
  const uploaded = await checked(await fetch(uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": job.source.mimeType, "content-length": String(job.source.sizeBytes) },
    body: createReadStream(path),
    duplex: "half",
  }), "YouTube video upload");
  const result = await uploaded.json();
  if (!result?.id) throw Object.assign(new Error("YouTube upload completed without a video ID"), { code: "provider_response_invalid" });
  return { id: String(result.id), url: `https://www.youtube.com/watch?v=${encodeURIComponent(result.id)}` };
}

function linkedInHeaders(accessToken) {
  const version = process.env.LINKEDIN_VERSION;
  if (!version || !/^\d{6}$/.test(version)) throw Object.assign(new Error("LINKEDIN_VERSION must be a supported YYYYMM API version"), { code: "provider_configuration" });
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "linkedin-version": version,
    "x-restli-protocol-version": "2.0.0",
  };
}

async function publishLinkedIn(job, path, accessToken) {
  const owner = job.accountRef || process.env.LINKEDIN_OWNER_URN;
  if (!owner?.startsWith("urn:li:")) throw Object.assign(new Error("LinkedIn requires a member or organization owner URN"), { code: "provider_configuration" });
  const headers = linkedInHeaders(accessToken);
  const initialized = await checked(await fetch("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers,
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: job.source.sizeBytes, uploadCaptions: false, uploadThumbnail: false } }),
  }), "LinkedIn upload initialization");
  const value = (await initialized.json())?.value;
  if (!value?.video || !Array.isArray(value.uploadInstructions) || !value.uploadInstructions.length) throw Object.assign(new Error("LinkedIn returned invalid upload instructions"), { code: "provider_response_invalid" });
  const uploadedPartIds = [];
  for (const instruction of value.uploadInstructions) {
    const start = Number(instruction.firstByte);
    const end = Math.min(job.source.sizeBytes - 1, Number(instruction.lastByte));
    if (!instruction.uploadUrl || !Number.isInteger(start) || !Number.isInteger(end) || end < start) throw Object.assign(new Error("LinkedIn returned an invalid upload part"), { code: "provider_response_invalid" });
    const part = await checked(await fetch(instruction.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "content-length": String(end - start + 1) },
      body: createReadStream(path, { start, end }),
      duplex: "half",
    }), "LinkedIn video part upload");
    const partId = part.headers.get("etag");
    if (!partId) throw Object.assign(new Error("LinkedIn upload part did not return an ETag"), { code: "provider_response_invalid" });
    uploadedPartIds.push(partId);
  }
  await checked(await fetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers,
    body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken || "", uploadedPartIds } }),
  }), "LinkedIn upload finalization");
  const post = await checked(await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      author: owner,
      commentary: job.caption.slice(0, 3_000),
      visibility: job.privacy === "private" ? "CONNECTIONS" : "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title: job.title.slice(0, 200), id: value.video } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  }), "LinkedIn post creation");
  const postId = post.headers.get("x-restli-id");
  if (!postId) throw Object.assign(new Error("LinkedIn created the post without returning its ID"), { code: "provider_response_invalid" });
  return { id: postId };
}

async function publishZernio(job, path, apiKey) {
  if (!job.accountRef || !job.targetPlatform) {
    throw Object.assign(new Error("Zernio requires a connected account ID and target platform"), { code: "provider_configuration" });
  }
  const authorization = `Bearer ${apiKey}`;
  const presigned = await checked(await fetch("https://zernio.com/api/v1/media/presign", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ filename: `${job.jobId}.mp4`, contentType: job.source.mimeType, size: job.source.sizeBytes }),
  }), "Zernio media initialization");
  const media = await presigned.json();
  if (!media?.uploadUrl || !media?.publicUrl) {
    throw Object.assign(new Error("Zernio did not return media upload URLs"), { code: "provider_response_invalid" });
  }
  await checked(await fetch(media.uploadUrl, {
    method: "PUT",
    headers: { "content-type": job.source.mimeType, "content-length": String(job.source.sizeBytes) },
    body: createReadStream(path),
    duplex: "half",
  }), "Zernio media upload");

  const platform = { platform: job.targetPlatform, accountId: job.accountRef };
  if (job.targetPlatform === "youtube") {
    platform.platformSpecificData = { title: job.title.slice(0, 100), visibility: job.privacy, madeForKids: false };
  }
  const createResponse = await fetch("https://zernio.com/api/v1/posts", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "x-request-id": job.providerRequestId || randomUUID(),
    },
    body: JSON.stringify({
      title: job.title,
      content: job.caption || job.title,
      mediaItems: [{ type: "video", url: media.publicUrl, title: job.title }],
      platforms: [platform],
      publishNow: true,
    }),
  });
  if (createResponse.status === 409) {
    const duplicate = await createResponse.json().catch(() => null);
    const existingPostId = duplicate?.details?.existingPostId || duplicate?.existingPostId;
    if (existingPostId) return { id: String(existingPostId) };
  }
  const created = await checked(createResponse, "Zernio post creation");
  const result = await created.json();
  const post = result?.post || result?.existingPost;
  const destination = post?.platforms?.find((item) => item.platform === job.targetPlatform);
  if (!post?._id) throw Object.assign(new Error("Zernio completed without returning a post ID"), { code: "provider_response_invalid" });
  if (["failed", "partial"].includes(post.status) || ["failed", "partial"].includes(destination?.status)) {
    throw Object.assign(new Error("Zernio could not publish the post to the selected account"), { code: "provider_rejected" });
  }
  return { id: String(post._id), url: destination?.platformPostUrl };
}

async function processJob(job) {
  const workspace = join(tmpdir(), `videoflow-social-${job.jobId}`);
  const sourcePath = join(workspace, "source.mp4");
  await mkdir(workspace, { recursive: true });
  try {
    await status(job, "uploading", .05);
    await download(job, sourcePath);
    await status(job, "uploading", .35);
    let result;
    if (job.provider === "zernio") {
      if (!zernioApiKey) throw Object.assign(new Error("ZERNIO_API_KEY is required for this connection"), { code: "provider_configuration" });
      result = await publishZernio(job, sourcePath, zernioApiKey);
    } else {
      if (!directAccessToken) throw Object.assign(new Error("SOCIAL_PROVIDER_ACCESS_TOKEN is required for direct publishing"), { code: "provider_configuration" });
      result = job.provider === "youtube"
        ? await publishYouTube(job, sourcePath, directAccessToken)
        : await publishLinkedIn(job, sourcePath, directAccessToken);
    }
    await status(job, "publishing", .95);
    await client.action(completeSocialPublish, { workerSecret, jobId: job.jobId, workerId, providerPostId: result.id, ...(result.url ? { providerPostUrl: result.url } : {}) });
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

while (!stopping) {
  let job = null;
  try {
    job = await client.action(claimSocialPublish, { workerSecret, connectionId, connectionSecret, workerId });
    if (!job) { await delay(pollMs); continue; }
    await processJob(job);
  } catch (error) {
    if (job) {
      const retry = Number(job.attempts || 1) < 3 && error?.code !== "provider_rejected" && error?.code !== "provider_configuration";
      await status(job, retry ? "retry_wait" : "failed", 0, error).catch(() => undefined);
    } else {
      await delay(pollMs);
    }
  }
}
