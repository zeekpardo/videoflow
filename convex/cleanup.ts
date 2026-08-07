import { internalMutation } from "./_generated/server";
import { currentFinishedRendition } from "./lib/finishedRendition";
import { r2 } from "./r2";

export const expired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessions = await ctx.db.query("videoShareSessions").withIndex("by_expiry", (q) => q.lt("expiresAt", now)).take(200);
    for (const session of sessions) await ctx.db.delete(session._id);
    const shareLinkSessions = await ctx.db.query("videoShareLinkSessions").withIndex("by_expiry", (q) => q.lt("expiresAt", now)).take(200);
    for (const session of shareLinkSessions) await ctx.db.delete(session._id);

    const cutoff = now - 24 * 60 * 60 * 1000;
    const uploads = await ctx.db.query("pendingUploads").withIndex("by_created", (q) => q.lt("createdAt", cutoff)).take(100);
    for (const upload of uploads) {
      try { await r2.deleteObject(ctx, upload.key); } catch { /* already removed */ }
      await ctx.db.delete(upload._id);
    }

    const multipartUploads = await ctx.db.query("multipartUploads").withIndex("by_expiry", (q) => q.lt("expiresAt", now)).take(100);
    for (const upload of multipartUploads) {
      for (const part of await ctx.db.query("multipartParts").withIndex("by_session", (q) => q.eq("uploadSessionId", upload._id)).collect()) await ctx.db.delete(part._id);
      await ctx.db.delete(upload._id);
    }

    const staleRenders = await ctx.db.query("videos")
      .withIndex("by_finished_status_updated", (q) => q.eq("finishedRenditionStatus", "rendering").lt("finishedRenditionUpdatedAt", cutoff))
      .take(100);
    for (const video of staleRenders) {
      // A replacement render may time out while a previously published output
      // for the same revision remains valid. Keep serving that known-good file.
      if (currentFinishedRendition(video)) {
        await ctx.db.patch(video._id, {
          finishedRenditionStatus: "ready",
          finishedRenditionError: undefined,
          finishedRenditionUpdatedAt: now,
        });
      } else {
        await ctx.db.patch(video._id, {
          finishedRenditionStatus: "error",
          finishedRenditionError: "Rendition timed out before it was published",
          finishedRenditionUpdatedAt: now,
        });
      }
    }

    const leasedStates = ["leased", "processing", "uploading", "verifying"] as const;
    const expiredLeases = (await Promise.all(leasedStates.map((status) => ctx.db.query("mediaJobs").withIndex("by_status_available", (q) => q.eq("status", status)).take(100))))
      .flat()
      .filter((job) => (job.leaseExpiresAt ?? 0) < now);
    for (const job of expiredLeases) {
      if (job.attempts < 3) {
        await ctx.db.patch(job._id, { status: "retry_wait", availableAt: now + 5_000 * 2 ** Math.max(0, job.attempts - 1), leaseOwner: undefined, leaseExpiresAt: undefined, errorCode: "lease_expired", errorMessage: "The worker lease expired; the job will retry", updatedAt: now });
      } else {
        await ctx.db.patch(job._id, { status: "failed", leaseOwner: undefined, leaseExpiresAt: undefined, errorCode: "lease_expired", errorMessage: "The media worker stopped responding", updatedAt: now });
        const video = await ctx.db.get(job.videoId);
        if (video && (video.editRevision ?? 0) === job.editRevision) await ctx.db.patch(video._id, { finishedRenditionStatus: "error", finishedRenditionError: "The background media worker stopped responding", finishedRenditionUpdatedAt: now, updatedAt: now });
      }
    }

    const rateLimits = await ctx.db.query("publicRateLimits").withIndex("by_window", (q) => q.lt("windowStart", cutoff)).take(500);
    for (const row of rateLimits) await ctx.db.delete(row._id);
  },
});
