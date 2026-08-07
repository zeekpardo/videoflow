import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { chromium } from "playwright";

const claimJob = makeFunctionReference("videoFlowV2:claimWorkerJob");
const updateJob = makeFunctionReference("videoFlowV2:updateWorkerJob");
const completeJob = makeFunctionReference("videoFlowV2:completeWorkerJob");

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const workerSecret = process.env.MEDIA_WORKER_SECRET;
const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const workerId = process.env.MEDIA_WORKER_ID || `worker-${randomUUID()}`;
const pollMs = Math.max(1_000, Number(process.env.MEDIA_WORKER_POLL_MS || 5_000));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

if (!convexUrl || !workerSecret || workerSecret.length < 32 || !appUrl) {
  throw new Error("CONVEX_URL, APP_URL, and a 32+ character MEDIA_WORKER_SECRET are required");
}

const client = new ConvexHttpClient(convexUrl);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status(job, state, progress, error) {
  await client.action(updateJob, {
    workerSecret,
    jobId: job.jobId,
    workerId,
    status: state,
    progress,
    ...(error ? { errorCode: error.code || "worker_error", errorMessage: String(error.message || error).slice(0, 500) } : {}),
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`FFmpeg exited with ${code}: ${stderr.slice(-2_000)}`), { code: "ffmpeg_failed" })));
  });
}

async function uploadFile(url, path, type) {
  const response = await fetch(url, { method: "PUT", headers: { "content-type": type }, body: createReadStream(path), duplex: "half" });
  if (!response.ok) throw Object.assign(new Error(`Output upload failed with ${response.status}`), { code: "upload_failed" });
}

async function processJob(browser, job) {
  const workspace = join(tmpdir(), `videoflow-${job.jobId}`);
  await mkdir(workspace, { recursive: true });
  const stagingPath = join(workspace, "render.webm");
  const outputPath = join(workspace, "output.mp4");
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await status(job, "processing", .02);
    await page.goto(`${appUrl}/worker-render`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForFunction(() => document.documentElement.dataset.videoFlowWorkerReady === "true", undefined, { timeout: 30_000 });
    const renderResult = await page.evaluate(async (payload) => {
      if (!window.videoFlowWorkerRender) throw new Error("Worker renderer did not initialize");
      return window.videoFlowWorkerRender(payload);
    }, {
      durationMs: job.durationMs,
      mode: job.mode,
      editState: job.editState,
      zoomEffects: job.zoomEffects,
      captions: job.captions,
      sources: job.sources,
      graphicAssets: job.graphicAssets,
      outputUrl: job.renderUpload.url,
      preset: job.preset,
    });
    await status(job, "uploading", job.format === "webm" ? .92 : .58);
    if (job.format === "mp4") {
      const source = await fetch(job.renderUpload.readUrl);
      if (!source.ok || !source.body) throw Object.assign(new Error(`Staging download failed with ${source.status}`), { code: "download_failed" });
      await pipeline(source.body, createWriteStream(stagingPath));
      await status(job, "processing", .68);
      await run(ffmpeg, ["-hide_banner", "-loglevel", "warning", "-y", "-i", stagingPath, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath]);
      await status(job, "uploading", .88);
      await uploadFile(job.output.url, outputPath, "video/mp4");
    }
    await status(job, "verifying", .97);
    await client.action(completeJob, { workerSecret, jobId: job.jobId, workerId, durationMs: renderResult.durationMs });
  } finally {
    await context.close().catch(() => undefined);
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
try {
  while (!stopping) {
    let job = null;
    try {
      job = await client.action(claimJob, { workerSecret, workerId });
      if (!job) {
        await delay(pollMs);
        continue;
      }
      await processJob(browser, job);
    } catch (error) {
      if (job) {
        const retry = Number(job.attempts || 1) < 3;
        await status(job, retry ? "retry_wait" : "failed", 0, error).catch(() => undefined);
      } else {
        await delay(pollMs);
      }
    }
  }
} finally {
  await browser.close();
}
