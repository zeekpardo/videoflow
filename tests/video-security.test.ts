import { beforeEach, describe, expect, test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib/tokens";

process.env.R2_BUCKET ||= "test";
process.env.R2_ENDPOINT ||= "https://example.r2.cloudflarestorage.com";
process.env.R2_ACCESS_KEY_ID ||= "test";
process.env.R2_SECRET_ACCESS_KEY ||= "test-secret";
process.env.MEDIA_WORKER_SECRET ||= "test-media-worker-secret-at-least-32-characters";

const modules = import.meta.glob("../convex/**/*.*s");
type Harness = TestConvex<typeof schema>;

async function seedVideo(t: Harness, ownerId: string, values: { visibility?: "private" | "public"; shareToken?: string; passwordHash?: string; passwordSalt?: string } = {}) {
  return t.run(async (ctx) => ctx.db.insert("videos", {
    ownerId,
    ownerName: ownerId,
    title: `${ownerId} video`,
    storageId: `${ownerId}-video-key`,
    durationMs: 60_000,
    mode: "screen",
    mimeType: "video/webm",
    sizeBytes: 1000,
    visibility: values.visibility || "private",
    shareToken: values.shareToken,
    allowComments: true,
    allowReactions: true,
    allowDownload: false,
    passwordHash: values.passwordHash,
    passwordSalt: values.passwordSalt,
    transcriptStatus: "none",
    viewCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

function editStateWithImage(assetId: string) {
  return {
    version: 2 as const,
    trim: { startMs: 0, endMs: 60_000 },
    cuts: [],
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
    textOverlays: [],
    audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
    objects: [{
      id: "image-object", kind: "image" as const, startMs: 0, endMs: 10_000,
      x: 0.5, y: 0.5, width: 0.3, height: 0.3, rotation: 0, opacity: 1,
      zIndex: 1, fill: "transparent", stroke: "transparent", strokeWidth: 0, assetId,
    }],
    interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
  };
}

describe("video ownership and public engagement", () => {
  let t: Harness;
  beforeEach(() => { t = convexTest(schema, modules); });

  test("private queries require authentication", async () => {
    await expect(t.query(api.videos.list, {})).rejects.toThrow("Not authenticated");
  });

  test("users see and edit only their own videos", async () => {
    const ownerA = "issuer|owner-a";
    const ownerB = "issuer|owner-b";
    await seedVideo(t, ownerA);
    const videoB = await seedVideo(t, ownerB);
    const asA = t.withIdentity({ tokenIdentifier: ownerA, subject: "owner-a", issuer: "issuer", name: "Owner A" });
    const list = await asA.query(api.videos.list, {});
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("issuer|owner-a video");
    await expect(asA.mutation(api.videos.update, { videoId: videoB, title: "stolen" })).rejects.toThrow("Not authorized");
  });

  test("V2 organization, captions, share links, and render jobs stay owner-scoped", async () => {
    const owner = "issuer|v2-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "v2-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|v2-other", subject: "v2-other", issuer: "issuer" });

    const folderId = await asOwner.mutation(api.videoFlowV2.createFolder, { name: "Launches" });
    await asOwner.mutation(api.videoFlowV2.organizeVideos, { videoIds: [videoId], folderId, tags: ["Launch", "Customer"], favorite: true });
    const workspace = await asOwner.query(api.videoFlowV2.workspace, {});
    expect(workspace.folders[0].name).toBe("Launches");
    expect(workspace.organization[0]).toMatchObject({ videoId, folderId, tags: ["launch", "customer"], favorite: true });
    await expect(asOther.mutation(api.videoFlowV2.organizeVideos, { videoIds: [videoId], favorite: true })).rejects.toThrow("Not authorized");

    await asOwner.mutation(api.videoFlowV2.saveCaptionTrack, {
      videoId,
      language: "en",
      cues: [{ id: "cue-1", startMs: 0, endMs: 1_000, text: "Welcome" }],
      style: { preset: "karaoke", position: "bottom", textColor: "#ffffff", highlightColor: "#facc15", backgroundColor: "#0f172acc", fontScale: 1, burnIn: false },
    });
    expect((await asOwner.query(api.videoFlowV2.getCaptionTrack, { videoId }))?.cues[0].text).toBe("Welcome");
    await expect(asOther.query(api.videoFlowV2.getCaptionTrack, { videoId })).rejects.toThrow("Not authorized");

    const shareLinkId = await asOwner.mutation(api.videoFlowV2.createShareLink, { videoId, name: "Customer review" });
    await asOwner.mutation(api.videoFlowV2.updateShareLink, { shareLinkId, customTitle: "Customer launch", allowComments: false, maxViews: 10 });
    await expect(asOther.mutation(api.videoFlowV2.updateShareLink, { shareLinkId, name: "stolen" })).rejects.toThrow("Share link not found");
    const link = (await asOwner.query(api.videoFlowV2.listShareLinks, { videoId }))[0];
    expect(link).toMatchObject({ name: "Customer review", customTitle: "Customer launch", allowComments: false, maxViews: 10 });
    const publicData = await t.query(api.videosPublic.getByShareToken, { token: link.token });
    expect(publicData).toMatchObject({ locked: false, title: "Customer launch", allowComments: false, shareLinkId, captionTrack: { language: "en" } });

    const jobId = await asOwner.mutation(api.videoFlowV2.enqueueRender, { videoId, preset: "1080p", format: "mp4" });
    expect((await asOwner.query(api.videoFlowV2.listMediaJobs, { videoId }))[0]).toMatchObject({ _id: jobId, status: "queued", preset: "1080p", format: "mp4" });
    await expect(asOther.mutation(api.videoFlowV2.enqueueRender, { videoId, preset: "720p", format: "mp4" })).rejects.toThrow("Not authorized");
  });

  test("no-login review requests stay owner-scoped and honor protected share sessions", async () => {
    const owner = "issuer|review-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "review-owner", issuer: "issuer", name: "Review Owner" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|review-other", subject: "review-other", issuer: "issuer" });
    const created = await asOwner.mutation(api.videoFlowV2.createReviewRequest, {
      videoId,
      recipientName: "Casey Reviewer",
      recipientEmail: "casey@example.com",
      message: "Please check the launch details.",
    });

    await expect(asOther.query(api.videoFlowV2.listReviewRequests, { videoId })).rejects.toThrow("Not authorized");
    const ownerRequests = await asOwner.query(api.videoFlowV2.listReviewRequests, { videoId });
    expect(ownerRequests[0]).toMatchObject({
      _id: created.reviewRequestId,
      shareLinkId: created.shareLinkId,
      recipientEmail: "casey@example.com",
      status: "pending",
    });
    expect(await asOwner.query(api.videoFlowV2.workspaceReviewRequests, {})).toEqual([
      expect.objectContaining({
        _id: created.reviewRequestId,
        videoId,
        videoTitle: `${owner} video`,
        recipientEmail: "casey@example.com",
        token: created.token,
      }),
    ]);
    expect(await asOther.query(api.videoFlowV2.workspaceReviewRequests, {})).toEqual([]);

    const publicData = await t.query(api.videosPublic.getByShareToken, { token: created.token });
    expect(publicData).toMatchObject({
      locked: false,
      reviewRequest: { recipientName: "Casey Reviewer", status: "pending" },
    });
    expect(JSON.stringify(publicData)).not.toContain("casey@example.com");

    await asOwner.mutation(api.videoFlowV2.updateShareLink, { shareLinkId: created.shareLinkId, requireEmail: true });
    await expect(t.action(api.videoFlowV2Actions.issueShareLinkSession, {
      token: created.token,
      viewerEmail: "someone-else@example.com",
    })).rejects.toThrow("assigned to this review request");
    expect(await t.action(api.videoFlowV2Actions.issueShareLinkSession, {
      token: created.token,
      viewerEmail: "casey@example.com",
    })).toMatchObject({ sessionToken: expect.any(String) });
    await asOwner.mutation(api.videoFlowV2.updateShareLink, { shareLinkId: created.shareLinkId, requireEmail: false });

    await t.run(async (ctx) => ctx.db.patch(created.shareLinkId, { passwordSalt: "salt", passwordHash: "hash" }));
    await expect(t.mutation(api.videosPublic.submitReviewResponse, {
      token: created.token,
      viewerKey: "reviewer-session",
      reviewerName: "Casey",
      decision: "approved",
    })).rejects.toThrow("Review request is unavailable");

    const sessionToken = "valid-review-share-session";
    await t.run(async (ctx) => ctx.db.insert("videoShareLinkSessions", {
      shareLinkId: created.shareLinkId,
      tokenHash: hashToken(sessionToken),
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    }));
    await t.mutation(api.videosPublic.submitReviewResponse, {
      token: created.token,
      sessionToken,
      viewerKey: "reviewer-session",
      reviewerName: "Casey",
      decision: "approved",
      note: "Ready to publish.",
    });
    expect((await asOwner.query(api.videoFlowV2.listReviewRequests, { videoId }))[0]).toMatchObject({
      status: "approved",
      responseName: "Casey",
      responseNote: "Ready to publish.",
    });

    const cancelable = await asOwner.mutation(api.videoFlowV2.createReviewRequest, {
      videoId,
      recipientName: "Morgan Reviewer",
      recipientEmail: "morgan@example.com",
    });
    expect(await asOwner.mutation(api.videoFlowV2.remindReviewRequest, { reviewRequestId: cancelable.reviewRequestId })).toBe(true);
    await expect(asOther.mutation(api.videoFlowV2.cancelReviewRequest, { reviewRequestId: cancelable.reviewRequestId })).rejects.toThrow("Review request not found");
    await asOwner.mutation(api.videoFlowV2.cancelReviewRequest, { reviewRequestId: cancelable.reviewRequestId });
    expect((await asOwner.query(api.videoFlowV2.listReviewRequests, { videoId })).find((request) => request._id === cancelable.reviewRequestId)).toMatchObject({
      status: "canceled",
      reminderCount: 1,
      linkStatus: "revoked",
    });
    await expect(t.mutation(api.videosPublic.submitReviewResponse, {
      token: cancelable.token,
      viewerKey: "canceled-reviewer-session",
      reviewerName: "Morgan",
      decision: "approved",
    })).rejects.toThrow("Review request is unavailable");
  });

  test("video task proposals require owner approval and remain owner-scoped", async () => {
    const owner = "issuer|task-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "task-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|task-other", subject: "task-other", issuer: "issuer" });
    await t.run(async (ctx) => ctx.db.insert("videoTranscripts", {
      videoId,
      fullText: "Action item: update the onboarding checklist.",
      segments: [{ start: 2_000, end: 3_000, text: "Action item: update the onboarding checklist." }],
      createdAt: Date.now(),
    }));

    const generated = await asOwner.action(api.videoFlowV2Actions.generateTaskProposals, { videoId });
    expect(generated).toMatchObject({ count: 1, usedAi: false });
    await expect(asOther.query(api.videoFlowV2.listTaskProposals, { videoId })).rejects.toThrow("Not authorized");
    const proposals = await asOwner.query(api.videoFlowV2.listTaskProposals, { videoId });
    expect(proposals[0]).toMatchObject({ sourceKind: "transcript", sourceTimestampMs: 2_000, status: "proposed" });
    await expect(asOther.mutation(api.videoFlowV2.acceptTaskProposal, { proposalId: proposals[0]._id })).rejects.toThrow("Task proposal not found");

    const taskId = await asOwner.mutation(api.videoFlowV2.acceptTaskProposal, { proposalId: proposals[0]._id });
    expect((await asOwner.query(api.videoFlowV2.listTasks, { videoId }))[0]).toMatchObject({ _id: taskId, status: "todo" });
    await asOwner.mutation(api.videoFlowV2.updateTask, { taskId, status: "done" });
    expect((await asOwner.query(api.videoFlowV2.listTasks, { videoId }))[0].status).toBe("done");

    const commentId = await t.run(async (ctx) => ctx.db.insert("videoComments", {
      videoId,
      guestName: "Reviewer",
      guestEmail: "reviewer@example.com",
      timestampMs: 9_000,
      bodyHtml: "<p>Replace the mobile screenshot.</p>",
      createdAt: Date.now(),
    }));
    await expect(asOther.mutation(api.videoFlowV2.createTaskFromComment, { commentId })).rejects.toThrow("Comment not found");
    const commentTaskId = await asOwner.mutation(api.videoFlowV2.createTaskFromComment, { commentId });
    expect(await asOwner.mutation(api.videoFlowV2.createTaskFromComment, { commentId })).toBe(commentTaskId);
    expect((await asOwner.query(api.videos.ownerComments, { videoId })).find((comment) => comment._id === commentId)).toMatchObject({ taskId: commentTaskId });
    await asOwner.mutation(api.videoFlowV2.updateTask, { taskId: commentTaskId, status: "done" });
    expect((await asOwner.query(api.videos.ownerComments, { videoId })).find((comment) => comment._id === commentId)?.resolvedAt).toEqual(expect.any(Number));
    await asOwner.mutation(api.videoFlowV2.updateTask, { taskId: commentTaskId, status: "todo" });
    expect((await asOwner.query(api.videos.ownerComments, { videoId })).find((comment) => comment._id === commentId)?.resolvedAt).toBeUndefined();
  });

  test("social publish connections and jobs are owner-bound and worker-bound", async () => {
    const owner = "issuer|social-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "social-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|social-other", subject: "social-other", issuer: "issuer" });
    const bindingSecret = "social-connection-binding-secret-1234567890";
    const connectionId = await asOwner.mutation(api.videoFlowV2.createSocialConnection, {
      provider: "youtube",
      name: "Launch channel",
      workerBindingSecret: bindingSecret,
    });
    expect(JSON.stringify(await asOwner.query(api.videoFlowV2.listSocialConnections, {}))).not.toContain("workerBindingHash");
    await expect(asOther.mutation(api.videoFlowV2.updateSocialConnection, { connectionId, status: "disabled" })).rejects.toThrow("Social connection not found");

    await t.run(async (ctx) => ctx.db.patch(videoId, {
      editRevision: 2,
      finishedRenditionStorageId: "social-ready.mp4",
      finishedRenditionSizeBytes: 4_096,
      finishedRenditionMimeType: "video/mp4",
      finishedRenditionDurationMs: 60_000,
      finishedRenditionRevision: 2,
      finishedRenditionStatus: "ready",
    }));
    const jobId = await asOwner.mutation(api.videoFlowV2.enqueueSocialPublish, {
      videoId,
      connectionId,
      title: "Launch walkthrough",
      caption: "A concise product walkthrough.",
      privacy: "private",
    });
    await expect(asOther.query(api.videoFlowV2.listSocialPublishJobs, { videoId })).rejects.toThrow("Not authorized");
    await expect(t.action(api.videoFlowV2.claimSocialPublish, {
      workerSecret: process.env.MEDIA_WORKER_SECRET!, connectionId, connectionSecret: "wrong-connection-secret-that-is-long-enough", workerId: "social-worker",
    })).rejects.toThrow("Social connection authentication failed");
    expect(await t.action(api.videoFlowV2.claimSocialPublish, {
      workerSecret: process.env.MEDIA_WORKER_SECRET!, connectionId, connectionSecret: bindingSecret, workerId: "social-worker",
    })).toMatchObject({ jobId, provider: "youtube", source: { sizeBytes: 4_096, mimeType: "video/mp4" } });
    await t.action(api.videoFlowV2.completeSocialPublish, {
      workerSecret: process.env.MEDIA_WORKER_SECRET!, jobId, workerId: "social-worker", providerPostId: "youtube-video-id", providerPostUrl: "https://www.youtube.com/watch?v=youtube-video-id",
    });
    expect((await asOwner.query(api.videoFlowV2.listSocialPublishJobs, { videoId })).find((job) => job._id === jobId)).toMatchObject({ status: "published", providerPostId: "youtube-video-id" });

    const zernioSecret = "zernio-connection-binding-secret-123456789";
    await expect(asOwner.mutation(api.videoFlowV2.createSocialConnection, {
      provider: "zernio", name: "Missing target", accountRef: "zernio-account-id", workerBindingSecret: zernioSecret,
    })).rejects.toThrow("target platform and account ID");
    const zernioConnectionId = await asOwner.mutation(api.videoFlowV2.createSocialConnection, {
      provider: "zernio", name: "Launch Instagram", accountRef: "zernio-account-id", targetPlatform: "instagram", workerBindingSecret: zernioSecret,
    });
    expect((await asOwner.query(api.videoFlowV2.listSocialConnections, {})).find((connection) => connection._id === zernioConnectionId)).toMatchObject({
      provider: "zernio", accountRef: "zernio-account-id", targetPlatform: "instagram",
    });
    const zernioJobId = await asOwner.mutation(api.videoFlowV2.enqueueSocialPublish, {
      videoId, connectionId: zernioConnectionId, title: "Zernio launch", caption: "Published through Zernio.", privacy: "public",
    });
    expect(await t.action(api.videoFlowV2.claimSocialPublish, {
      workerSecret: process.env.MEDIA_WORKER_SECRET!, connectionId: zernioConnectionId, connectionSecret: zernioSecret, workerId: "zernio-worker",
    })).toMatchObject({
      jobId: zernioJobId, provider: "zernio", accountRef: "zernio-account-id", targetPlatform: "instagram",
      providerRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    await t.action(api.videoFlowV2.completeSocialPublish, {
      workerSecret: process.env.MEDIA_WORKER_SECRET!, jobId: zernioJobId, workerId: "zernio-worker", providerPostId: "zernio-post-id", providerPostUrl: "https://instagram.com/p/example",
    });
    expect((await asOwner.query(api.videoFlowV2.listSocialPublishJobs, { videoId })).find((job) => job._id === zernioJobId)).toMatchObject({ status: "published", providerPostId: "zernio-post-id", provider: "zernio" });
  });

  test("multipart upload progress is resumable and owner-scoped", async () => {
    const owner = "issuer|upload-owner";
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "upload-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|upload-other", subject: "upload-other", issuer: "issuer" });
    const partSizeBytes = 8 * 1024 * 1024;
    const sessionId = await t.mutation(internal.multipartUploadData.createSession, {
      ownerId: owner,
      key: "uploads/test-video.webm",
      uploadId: "r2-upload-id",
      contentType: "video/webm",
      fileName: "test-video.webm",
      sizeBytes: partSizeBytes + 10,
      partSizeBytes,
      expiresAt: Date.now() + 60_000,
    });
    expect(await asOther.query(api.multipartUploadData.get, { sessionId })).toBeNull();
    await expect(asOther.mutation(api.multipartUploadData.recordPart, {
      sessionId,
      partNumber: 1,
      etag: '"0123456789abcdef0123456789abcdef"',
      sizeBytes: partSizeBytes,
    })).rejects.toThrow("unavailable");
    await asOwner.mutation(api.multipartUploadData.recordPart, {
      sessionId,
      partNumber: 1,
      etag: '"0123456789abcdef0123456789abcdef"',
      sizeBytes: partSizeBytes,
    });
    expect(await asOwner.query(api.multipartUploadData.get, { sessionId })).toMatchObject({
      status: "uploading",
      uploadedParts: [{ partNumber: 1, sizeBytes: partSizeBytes }],
    });
  });

  test("zoom effects are owner-scoped and server-clamped", async () => {
    const owner = "issuer|zoom-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "zoom-owner", issuer: "issuer" });
    await asOwner.mutation(api.videos.update, {
      videoId,
      zoomEffects: [{ id: "zoom-1", startMs: -500, endMs: 999_999, x: -1, y: 4, scale: 9 }],
    });
    const stored = await t.run(async (ctx) => ctx.db.get(videoId));
    expect(stored?.zoomEffects).toEqual([{ id: "zoom-1", startMs: 0, endMs: 60_000, x: .05, y: .95, scale: 3 }]);
    expect(stored?.editRevision).toBe(1);
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" });
    await expect(asOther.mutation(api.videos.update, { videoId, zoomEffects: [] })).rejects.toThrow("Not authorized");
  });

  test("editor project state and zooms advance one atomic revision", async () => {
    const owner = "issuer|project-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "project-owner", issuer: "issuer" });
    const saved = await asOwner.mutation(api.videos.saveEditorProject, {
      videoId,
      editState: {
        version: 1,
        cuts: [],
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
        textOverlays: [],
      },
      zoomEffects: [{ id: "zoom", startMs: 1_000, endMs: 2_000, x: 0.5, y: 0.5, scale: 2 }],
    });
    expect(saved.editRevision).toBe(1);
    expect(saved.editState.version).toBe(2);
    expect(saved.zoomEffects).toEqual([{ id: "zoom", startMs: 1_000, endMs: 2_000, x: 0.5, y: 0.5, scale: 2 }]);
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toMatchObject({ editRevision: 1, zoomEffects: saved.zoomEffects, editState: saved.editState });
  });

  test("edit metadata is owner-scoped, bounded, and revisioned", async () => {
    const owner = "issuer|edit-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "edit-owner", issuer: "issuer" });
    const requested = {
      version: 1 as const,
      cuts: [{ id: " cut-1 ", startMs: -100, endMs: 90_000 }],
      crop: { top: 0.8, right: 2, bottom: 0.8, left: -1 },
      screen: { x: 2, y: -2, scale: 10, cornerRadius: 2 },
      camera: { x: 2, y: -1, size: 4, shape: "rounded" as const, mirror: true, visible: true },
      textOverlays: [{
        id: " overlay-1 ", startMs: 59_000, endMs: 500, text: "  Hello viewer  ",
        x: -1, y: 2, fontSize: 999, color: "#ABCDEF", background: "TRANSPARENT",
      }],
    };
    const saved = await asOwner.mutation(api.videos.saveEdits, { videoId, editState: requested });
    expect(saved.editRevision).toBe(1);
    expect(saved.editState).toEqual({
      version: 2,
      trim: { startMs: 0, endMs: 60_000 },
      cuts: [{ id: "cut-1", startMs: 0, endMs: 60_000 }],
      crop: { top: 0.475, right: 0.95, bottom: 0.475, left: 0 },
      screen: { x: 1, y: 0, scale: 4, cornerRadius: 2 },
      camera: { x: 1, y: 0, size: 1, shape: "rounded", strokeWidth: 3, strokeColor: "#ffffff", mirror: true, visible: true },
      textOverlays: [{
        id: "overlay-1", startMs: 59_000, endMs: 59_001, text: "Hello viewer",
        x: 0, y: 1, fontSize: 200, color: "#abcdef", background: "transparent",
      }],
      audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      objects: [],
      interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
    });
    const savedAgain = await asOwner.mutation(api.videos.saveEdits, { videoId, editState: saved.editState });
    expect(savedAgain.editRevision).toBe(2);

    const asOther = t.withIdentity({ tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" });
    await expect(asOther.mutation(api.videos.saveEdits, { videoId, editState: requested })).rejects.toThrow("Not authorized");
    await expect(asOwner.mutation(api.videos.saveEdits, {
      videoId,
      editState: { ...requested, textOverlays: [{ ...requested.textOverlays[0], color: "red" }] },
    })).rejects.toThrow("Text color must be a hex color");
  });

  test("finished renditions are owner-scoped, upload-bound, and revision-safe", async () => {
    const owner = "issuer|rendition-owner";
    const videoId = await seedVideo(t, owner);
    await t.run(async (ctx) => ctx.db.patch(videoId, { editRevision: 2 }));
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "rendition-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" });

    await expect(asOther.mutation(api.videos.beginFinishedRendition, { videoId, editRevision: 2 })).rejects.toThrow("Not authorized");
    await asOwner.mutation(api.videos.beginFinishedRendition, { videoId, editRevision: 2 });
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toMatchObject({
      finishedRenditionRevision: 2,
      finishedRenditionStatus: "rendering",
    });
    await expect(asOther.action(api.videoActions.finalizeFinishedRendition, {
      videoId,
      storageId: "other-render-key",
      editRevision: 2,
      durationMs: 45_000,
    })).rejects.toThrow("Not authorized");

    await t.run(async (ctx) => ctx.db.insert("pendingUploads", {
      key: "finished-render-key",
      ownerId: owner,
      createdAt: Date.now(),
    }));
    await t.run(async (ctx) => ctx.db.insert("pendingUploads", {
      key: "foreign-render-key",
      ownerId: "issuer|other",
      createdAt: Date.now(),
    }));
    const finalizeArgs = {
      videoId,
      storageId: "finished-render-key",
      ownerId: owner,
      editRevision: 2,
      durationMs: 45_000,
      verifiedSizeBytes: 8_000,
      mimeType: "video/webm;codecs=vp9,opus",
    };
    await expect(t.mutation(internal.videos.finalizeFinishedRendition, { ...finalizeArgs, ownerId: "issuer|other" })).rejects.toThrow("Not authorized");
    await expect(t.mutation(internal.videos.finalizeFinishedRendition, { ...finalizeArgs, editRevision: 1 })).rejects.toThrow("changed while the rendition was rendering");
    await expect(t.mutation(internal.videos.finalizeFinishedRendition, { ...finalizeArgs, storageId: "foreign-render-key" })).rejects.toThrow("Upload does not belong to this user");
    const finalized = await t.mutation(internal.videos.finalizeFinishedRendition, finalizeArgs);
    expect(finalized).toEqual({ editRevision: 2, sizeBytes: 8_000, mimeType: "video/webm;codecs=vp9,opus", durationMs: 45_000 });
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toMatchObject({
      finishedRenditionStorageId: "finished-render-key",
      finishedRenditionSizeBytes: 8_000,
      finishedRenditionDurationMs: 45_000,
      finishedRenditionRevision: 2,
      finishedRenditionStatus: "ready",
    });
    expect(await t.run(async (ctx) => ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", "finished-render-key")).first())).toBeNull();

    await asOwner.mutation(api.videos.update, {
      videoId,
      zoomEffects: [{ id: "new-zoom", startMs: 1_000, endMs: 2_000, x: 0.5, y: 0.5, scale: 2 }],
    });
    const invalidated = await t.run(async (ctx) => ctx.db.get(videoId));
    expect(invalidated?.editRevision).toBe(3);
    expect(invalidated?.finishedRenditionStorageId).toBeUndefined();
    expect(invalidated?.finishedRenditionStatus).toBeUndefined();
    await expect(t.mutation(internal.videos.finalizeFinishedRendition, {
      ...finalizeArgs,
      storageId: "stale-render-key",
    })).rejects.toThrow("changed while the rendition was rendering");
  });

  test("rendition failure state cannot be written for a stale revision", async () => {
    const owner = "issuer|failed-render-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "failed-render-owner", issuer: "issuer" });
    await asOwner.mutation(api.videos.beginFinishedRendition, { videoId, editRevision: 0 });
    await asOwner.mutation(api.videos.failFinishedRendition, { videoId, editRevision: 0, message: " Encoder stopped " });
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toMatchObject({
      finishedRenditionRevision: 0,
      finishedRenditionStatus: "error",
      finishedRenditionError: "Encoder stopped",
    });
    await asOwner.mutation(api.videos.saveEdits, {
      videoId,
      editState: {
        version: 1,
        cuts: [],
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
        textOverlays: [],
      },
    });
    await expect(asOwner.mutation(api.videos.failFinishedRendition, { videoId, editRevision: 0, message: "Late failure" })).rejects.toThrow("changed while the rendition was rendering");
  });

  test("raw screen and camera uploads are consumed only for their owner", async () => {
    const owner = "issuer|layer-owner";
    const now = Date.now();
    let cameraPendingId: Id<"pendingUploads">;
    await t.run(async (ctx) => {
      await ctx.db.insert("pendingUploads", { key: "composite-key", ownerId: owner, createdAt: now });
      await ctx.db.insert("pendingUploads", { key: "screen-key", ownerId: owner, createdAt: now });
      cameraPendingId = await ctx.db.insert("pendingUploads", { key: "camera-key", ownerId: "issuer|other", createdAt: now });
    });
    const createArgs = {
      ownerId: owner,
      ownerName: "Layer Owner",
      title: "Editable layers",
      storageId: "composite-key",
      screenStorageId: "screen-key",
      cameraStorageId: "camera-key",
      durationMs: 30_000,
      width: 1920,
      height: 1080,
      mode: "screen_camera" as const,
      mimeType: "video/webm",
      sizeBytes: 1_000,
      verifiedVideoSize: 1_000,
      verifiedScreenSize: 900,
      verifiedCameraSize: 400,
    };
    await expect(t.mutation(internal.videos.createFromUploads, createArgs)).rejects.toThrow("Upload does not belong to this user");
    await t.run(async (ctx) => ctx.db.patch(cameraPendingId!, { ownerId: owner }));
    const { videoId } = await t.mutation(internal.videos.createFromUploads, createArgs);
    const stored = await t.run(async (ctx) => ctx.db.get(videoId));
    expect(stored?.screenStorageId).toBe("screen-key");
    expect(stored?.screenSizeBytes).toBe(900);
    expect(stored?.cameraStorageId).toBe("camera-key");
    expect(stored?.cameraSizeBytes).toBe(400);
    expect(stored?.editRevision).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("pendingUploads").collect())).toEqual([]);
  });

  test("graphic assets are owner-scoped, raster-only, and upload-bound", async () => {
    const owner = "issuer|graphic-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "graphic-owner", issuer: "issuer" });
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" });
    await t.run(async (ctx) => {
      await ctx.db.insert("pendingUploads", { key: "graphic-key", ownerId: owner, createdAt: Date.now() });
      await ctx.db.insert("pendingUploads", { key: "foreign-graphic-key", ownerId: "issuer|other", createdAt: Date.now() });
    });
    const args = {
      videoId,
      ownerId: owner,
      assetId: "graphic_1",
      storageId: "graphic-key",
      mimeType: "image/png",
      verifiedSizeBytes: 2_000,
      width: 1200,
      height: 630,
    };
    await expect(t.mutation(internal.videoAssets.finalizeUpload, { ...args, ownerId: "issuer|other" })).rejects.toThrow("Not authorized");
    await expect(t.mutation(internal.videoAssets.finalizeUpload, { ...args, mimeType: "image/svg+xml" })).rejects.toThrow("PNG, JPG, or WebP");
    await expect(t.mutation(internal.videoAssets.finalizeUpload, { ...args, storageId: "foreign-graphic-key" })).rejects.toThrow("Upload does not belong to this user");
    const created = await t.mutation(internal.videoAssets.finalizeUpload, args);
    expect(created).toMatchObject({ assetId: "graphic_1", mimeType: "image/png", sizeBytes: 2_000, width: 1200, height: 630 });
    expect(await t.run(async (ctx) => ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", "graphic-key")).first())).toBeNull();

    const ownedAssets = await asOwner.query(api.videoAssets.list, { videoId });
    expect(ownedAssets).toHaveLength(1);
    expect(ownedAssets[0].url).toContain("graphic-key");
    expect(Object.prototype.hasOwnProperty.call(ownedAssets[0], "storageId")).toBe(false);
    await expect(asOther.query(api.videoAssets.list, { videoId })).rejects.toThrow("Not authorized");
    await expect(asOther.mutation(api.videoAssets.remove, { videoId, assetId: "graphic_1" })).rejects.toThrow("Not authorized");
  });

  test("deleting a video cascades its graphic asset metadata", async () => {
    const owner = "issuer|graphic-delete-owner";
    const videoId = await seedVideo(t, owner);
    await t.run(async (ctx) => ctx.db.insert("videoAssets", {
      videoId,
      ownerId: owner,
      assetId: "delete_graphic",
      storageId: "delete-graphic-key",
      mimeType: "image/webp",
      sizeBytes: 100,
      width: 100,
      height: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "graphic-delete-owner", issuer: "issuer" });
    await asOwner.mutation(api.videos.remove, { videoId });
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect())).toEqual([]);
  });

  test("share tokens are owner-only and rotate to a new opaque value", async () => {
    const owner = "issuer|share-owner";
    const videoId = await seedVideo(t, owner);
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "share-owner", issuer: "issuer" });
    const first = await asOwner.action(api.videoShares.setVisibility, { videoId, visibility: "public" });
    expect(first.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const second = await asOwner.action(api.videoShares.regenerate, { videoId });
    expect(second.shareToken).not.toBe(first.shareToken);
    const asOther = t.withIdentity({ tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" });
    await expect(asOther.action(api.videoShares.regenerate, { videoId })).rejects.toThrow("Not authorized");
  });

  test("locked videos reject engagement without a valid share session", async () => {
    const videoId = await seedVideo(t, "owner", { visibility: "public", shareToken: "locked-token", passwordHash: "hash", passwordSalt: "salt" });
    await t.run(async (ctx) => ctx.db.patch(videoId, {
      screenStorageId: "private-screen-key",
      cameraStorageId: "private-camera-key",
      editRevision: 1,
      editState: editStateWithImage("locked_graphic"),
      finishedRenditionStorageId: "private-finished-key",
      finishedRenditionSizeBytes: 1_000,
      finishedRenditionMimeType: "video/webm",
      finishedRenditionDurationMs: 50_000,
      finishedRenditionRevision: 1,
      finishedRenditionStatus: "ready",
    }));
    await t.run(async (ctx) => ctx.db.insert("videoAssets", {
      videoId, ownerId: "owner", assetId: "locked_graphic", storageId: "private-graphic-key",
      mimeType: "image/png", sizeBytes: 100, width: 100, height: 100, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const locked = await t.query(api.videosPublic.getByShareToken, { token: "locked-token" });
    expect(locked).toEqual({ locked: true, title: "owner video", hasPassword: true, requiresEmail: false });
    expect(await t.query(api.videosPublic.feed, { token: "locked-token" })).toEqual([]);
    await expect(t.mutation(api.videosPublic.addGuestComment, {
      token: "locked-token", viewerKey: "viewer-locked-123", guestName: "Viewer", guestEmail: "viewer@example.com", body: "Hello",
    })).rejects.toThrow("Comments are not enabled");

    const sessionToken = "a-valid-random-share-session";
    await t.run(async (ctx) => ctx.db.insert("videoShareSessions", { videoId, tokenHash: hashToken(sessionToken), expiresAt: Date.now() + 60_000, createdAt: Date.now() }));
    await t.mutation(api.videosPublic.addGuestComment, {
      token: "locked-token", sessionToken, viewerKey: "viewer-locked-123", guestName: "Viewer", guestEmail: "viewer@example.com", body: "Hello <script>", timestampMs: 999_999,
    });
    const feed = await t.query(api.videosPublic.feed, { token: "locked-token", sessionToken });
    expect(feed).toHaveLength(1);
    expect(feed[0].bodyHtml).toContain("&lt;script&gt;");
    expect(feed[0].timestampMs).toBe(60_000);
  });

  test("public playback exposes only a current finished rendition", async () => {
    const videoId = await seedVideo(t, "owner", { visibility: "public", shareToken: "finished-token" });
    await t.run(async (ctx) => ctx.db.patch(videoId, {
      editRevision: 3,
      editState: editStateWithImage("public_graphic"),
      screenStorageId: "private-screen-key",
      cameraStorageId: "private-camera-key",
      zoomEffects: [{ id: "zoom", startMs: 0, endMs: 1_000, x: 0.5, y: 0.5, scale: 2 }],
      finishedRenditionStorageId: "finished-key",
      finishedRenditionSizeBytes: 4_000,
      finishedRenditionMimeType: "video/webm",
      finishedRenditionDurationMs: 42_000,
      finishedRenditionRevision: 3,
      finishedRenditionStatus: "ready",
      finishedRenditionUpdatedAt: Date.now(),
    }));
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("videoAssets", {
        videoId, ownerId: "owner", assetId: "public_graphic", storageId: "public-graphic-key",
        mimeType: "image/png", sizeBytes: 500, width: 320, height: 180, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("videoAssets", {
        videoId, ownerId: "owner", assetId: "unused_graphic", storageId: "unused-graphic-key",
        mimeType: "image/jpeg", sizeBytes: 500, width: 320, height: 180, createdAt: now, updatedAt: now,
      });
    });
    const finished = await t.query(api.videosPublic.getByShareToken, { token: "finished-token" });
    expect(finished && !finished.locked ? finished : null).toMatchObject({
      mediaSource: "finished",
      durationMs: 42_000,
      screenUrl: null,
      cameraUrl: null,
      zoomEffects: [],
      graphicAssets: [],
      finishedRendition: {
        editRevision: 3,
        durationMs: 42_000,
        mimeType: "video/webm",
        sizeBytes: 4_000,
      },
    });
    if (finished && !finished.locked) {
      expect(finished.url).toContain("finished-key");
      expect(Object.prototype.hasOwnProperty.call(finished, "editState")).toBe(false);
    }

    await t.run(async (ctx) => ctx.db.patch(videoId, { editRevision: 4 }));
    const stale = await t.query(api.videosPublic.getByShareToken, { token: "finished-token" });
    expect(stale && !stale.locked ? stale : null).toMatchObject({
      mediaSource: "live",
      durationMs: 60_000,
      finishedRendition: null,
    });
    if (stale && !stale.locked) {
      expect(stale.url).toContain("owner-video-key");
      expect(stale.screenUrl).toContain("private-screen-key");
      expect(stale.cameraUrl).toContain("private-camera-key");
      expect(stale.zoomEffects).toHaveLength(1);
      expect(stale.graphicAssets).toHaveLength(1);
      expect(stale.graphicAssets[0]).toMatchObject({ assetId: "public_graphic", mimeType: "image/png", width: 320, height: 180 });
      expect(stale.graphicAssets[0].url).toContain("public-graphic-key");
    }
  });

  test("passwords are derived server-side and unlock into short-lived sessions", async () => {
    const owner = "issuer|password-owner";
    const videoId = await seedVideo(t, owner, { visibility: "public", shareToken: "password-token" });
    const asOwner = t.withIdentity({ tokenIdentifier: owner, subject: "password-owner", issuer: "issuer" });
    await asOwner.action(api.videoPasswords.setPassword, { videoId, password: "a-strong-password" });
    const stored = await t.run(async (ctx) => ctx.db.get(videoId));
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe("a-strong-password");
    await expect(t.action(api.videoPasswords.unlock, { shareToken: "password-token", password: "wrong-password", viewerKey: "password-viewer-1" })).rejects.toThrow("Incorrect password");
    const unlocked = await t.action(api.videoPasswords.unlock, { shareToken: "password-token", password: "a-strong-password", viewerKey: "password-viewer-1" });
    expect(unlocked.sessionToken).toBeTruthy();
    const session = await t.run(async (ctx) => ctx.db.query("videoShareSessions").withIndex("by_video", (q) => q.eq("videoId", videoId)).first());
    expect(session?.tokenHash).not.toBe(unlocked.sessionToken);
    expect(session?.expiresAt).toBeGreaterThan(Date.now());
  });

  test("reactions deduplicate and analytics inputs are clamped", async () => {
    const videoId = await seedVideo(t, "owner", { visibility: "public", shareToken: "public-token" });
    const reaction = { token: "public-token", emoji: "👍", viewerKey: "viewer-key-12345", timestampMs: 999_999 };
    await t.mutation(api.videosPublic.addReaction, reaction);
    await t.mutation(api.videosPublic.addReaction, reaction);
    expect(await t.query(api.videosPublic.reactions, { token: "public-token" })).toEqual([{ emoji: "👍", count: 1 }]);
    const moments = await t.query(api.videosPublic.reactionMoments, { token: "public-token" });
    expect(moments).toHaveLength(1);
    expect(moments[0].timestampMs).toBe(60_000);

    await t.mutation(api.videosPublic.recordView, { token: "public-token", viewerKey: "viewer-key-12345" });
    await t.mutation(api.videosPublic.updateViewProgress, { token: "public-token", viewerKey: "viewer-key-12345", positionMs: 999_999, watchedDeltaMs: 999_999 });
    const view = await t.run(async (ctx) => ctx.db.query("videoViews").withIndex("by_video", (q) => q.eq("videoId", videoId as Id<"videos">)).first());
    expect(view?.percentWatched).toBe(100);
    expect(view?.watchedMs).toBe(30_000);
    expect(view?.completed).toBe(true);
  });

  test("scheduled cleanup removes expired share sessions and keeps live ones", async () => {
    const videoId = await seedVideo(t, "owner");
    const currentRenderVideoId = await seedVideo(t, "owner-current-render");
    await t.run(async (ctx) => {
      await ctx.db.insert("videoShareSessions", { videoId, tokenHash: "expired", expiresAt: Date.now() - 1, createdAt: Date.now() - 1000 });
      await ctx.db.insert("videoShareSessions", { videoId, tokenHash: "live", expiresAt: Date.now() + 60_000, createdAt: Date.now() });
      await ctx.db.patch(videoId, {
        finishedRenditionRevision: 0,
        finishedRenditionStatus: "rendering",
        finishedRenditionUpdatedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      await ctx.db.patch(currentRenderVideoId, {
        editRevision: 0,
        finishedRenditionStorageId: "known-good-render",
        finishedRenditionSizeBytes: 1_000,
        finishedRenditionMimeType: "video/webm",
        finishedRenditionDurationMs: 50_000,
        finishedRenditionRevision: 0,
        finishedRenditionStatus: "rendering",
        finishedRenditionUpdatedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
    });
    await t.mutation(internal.cleanup.expired, {});
    const sessions = await t.run(async (ctx) => ctx.db.query("videoShareSessions").collect());
    expect(sessions.map((session) => session.tokenHash)).toEqual(["live"]);
    expect(await t.run(async (ctx) => ctx.db.get(videoId))).toMatchObject({
      finishedRenditionStatus: "error",
      finishedRenditionError: "Rendition timed out before it was published",
    });
    expect(await t.run(async (ctx) => ctx.db.get(currentRenderVideoId))).toMatchObject({
      finishedRenditionStatus: "ready",
      finishedRenditionStorageId: "known-good-render",
    });
  });
});
