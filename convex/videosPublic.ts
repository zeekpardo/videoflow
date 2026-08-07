import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { currentFinishedRendition } from "./lib/finishedRendition";
import { hashToken } from "./lib/tokens";
import {
  buildFinishedTimeline,
  finishedTimeToSourceMs,
  sourceIntervalToFinished,
  sourceTimeToFinishedMs,
} from "./lib/videoTimeline";
import { r2 } from "./r2";
import { referencedGraphicAssetIds } from "../lib/graphic-assets";

const URL_EXPIRY = 24 * 60 * 60;
const MAX_NAME = 120;
const MAX_EMAIL = 320;
const MAX_BODY = 5000;
const REACTIONS = new Set(["👍", "❤️", "🎉", "😮", "👏"]);

const brand = () => ({
  name: process.env.APP_NAME || "VideoFlow",
  color: process.env.BRAND_COLOR || "#6d5bfc",
  url: process.env.APP_URL || "http://localhost:3000",
});

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function videoByToken(ctx: QueryCtx | MutationCtx, token: string): Promise<{ video: Doc<"videos">; shareLink: Doc<"videoShareLinks"> | null } | null> {
  const shareLink = await ctx.db.query("videoShareLinks").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (shareLink) {
    if (shareLink.status !== "active" || (shareLink.expiresAt !== undefined && shareLink.expiresAt <= Date.now()) || (shareLink.maxViews !== undefined && shareLink.viewCount >= shareLink.maxViews)) return null;
    const video = await ctx.db.get(shareLink.videoId);
    return video ? { video, shareLink } : null;
  }
  const video = await ctx.db.query("videos").withIndex("by_share_token", (q) => q.eq("shareToken", token)).first();
  return video?.visibility === "public" ? { video, shareLink: null } : null;
}

async function sessionAllows(ctx: QueryCtx | MutationCtx, video: Doc<"videos">, shareLink: Doc<"videoShareLinks"> | null, sessionToken?: string) {
  if (shareLink) {
    if (!shareLink.passwordHash && !shareLink.requireEmail) return true;
    if (!sessionToken || sessionToken.length > 256) return false;
    const session = await ctx.db.query("videoShareLinkSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", hashToken(sessionToken))).first();
    return !!session && session.shareLinkId === shareLink._id && session.expiresAt > Date.now();
  }
  if (!video.passwordHash) return true;
  if (!sessionToken || sessionToken.length > 256) return false;
  const session = await ctx.db.query("videoShareSessions").withIndex("by_token_hash", (q) => q.eq("tokenHash", hashToken(sessionToken))).first();
  return !!session && session.videoId === video._id && session.expiresAt > Date.now();
}

async function publicVideo(ctx: QueryCtx | MutationCtx, token: string, sessionToken?: string) {
  const resolved = await videoByToken(ctx, token);
  if (!resolved) return { video: null, shareLink: null, allowed: false };
  return { ...resolved, allowed: await sessionAllows(ctx, resolved.video, resolved.shareLink, sessionToken) };
}

function finishedPlayback(video: Doc<"videos">) {
  const rendition = currentFinishedRendition(video);
  if (!rendition) return null;
  return {
    rendition,
    timeline: buildFinishedTimeline(video.durationMs, video.editState),
  };
}

function incomingTimestamp(video: Doc<"videos">, timestampMs: number | undefined) {
  if (timestampMs === undefined) return undefined;
  const finished = finishedPlayback(video);
  if (finished) return finishedTimeToSourceMs(timestampMs, finished.timeline);
  const safeTimestampMs = Number.isFinite(timestampMs) ? timestampMs : 0;
  return Math.min(video.durationMs, Math.max(0, safeTimestampMs));
}

async function rateLimit(ctx: MutationCtx, key: string, action: string, limit: number, windowMs: number) {
  const safeKey = key.slice(0, 300);
  const row = await ctx.db.query("publicRateLimits").withIndex("by_key_action", (q) => q.eq("key", safeKey).eq("action", action)).first();
  const now = Date.now();
  if (!row) {
    await ctx.db.insert("publicRateLimits", { key: safeKey, action, count: 1, windowStart: now });
    return;
  }
  if (now - row.windowStart >= windowMs) {
    await ctx.db.patch(row._id, { count: 1, windowStart: now });
    return;
  }
  if (row.count >= limit) throw new Error("Too many requests. Please wait and try again.");
  await ctx.db.patch(row._id, { count: row.count + 1 });
}

export const getByShareToken = query({
  args: { token: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video) return null;
    if (!allowed) return { locked: true as const, title: shareLink?.customTitle ?? video.title, requiresEmail: shareLink?.requireEmail ?? false, hasPassword: shareLink ? !!shareLink.passwordHash : !!video.passwordHash };
    const [transcript, captionTrack, interactiveElements] = await Promise.all([
      video.transcriptStatus === "done" ? ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", video._id)).first() : null,
      ctx.db.query("videoCaptionTracks").withIndex("by_video", (q) => q.eq("videoId", video._id)).first(),
      ctx.db.query("videoInteractiveElements").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect(),
    ]);
    const reviewRequest = shareLink
      ? await ctx.db.query("videoReviewRequests").withIndex("by_share_link", (q) => q.eq("shareLinkId", shareLink._id)).first()
      : null;
    const finished = finishedPlayback(video);
    const finishedRendition = finished?.rendition;
    const transcriptSegments = transcript && finished && finishedRendition
      ? transcript.segments.flatMap((segment) => sourceIntervalToFinished(
        segment.start,
        segment.end,
        finished.timeline,
        finished.rendition.durationMs,
      ).map((interval) => ({ start: interval.startMs, end: interval.endMs, text: segment.text })))
      : transcript?.segments;
    const referencedAssets = finishedRendition ? new Set<string>() : referencedGraphicAssetIds(video.editState);
    const graphicAssets = referencedAssets.size ? await Promise.all(
      (await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect())
        .filter((asset) => referencedAssets.has(asset.assetId))
        .map(async (asset) => ({
          assetId: asset.assetId,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width,
          height: asset.height,
          url: await r2.getUrl(asset.storageId, { expiresIn: URL_EXPIRY }),
        }))
    ) : [];
    const mappedCaptionCues = captionTrack?.cues.flatMap((cue) => {
      if (!finished || !finishedRendition) return [cue];
      return sourceIntervalToFinished(cue.startMs, cue.endMs, finished.timeline, finished.rendition.durationMs).map((interval, index) => ({ ...cue, id: `${cue.id}-${index}`, startMs: interval.startMs, endMs: interval.endMs, words: undefined }));
    }) ?? [];
    const mappedInteractiveElements = interactiveElements.flatMap((element) => {
      if (!finished || !finishedRendition) return [element];
      return sourceIntervalToFinished(element.startMs, element.endMs, finished.timeline, finished.rendition.durationMs).map((interval) => ({ ...element, startMs: interval.startMs, endMs: interval.endMs }));
    });
    return {
      locked: false as const,
      videoId: video._id,
      title: shareLink?.customTitle ?? video.title,
      description: shareLink?.customDescription ?? video.description,
      durationMs: finishedRendition?.durationMs ?? video.durationMs,
      mode: video.mode,
      cta: shareLink?.cta ?? video.cta,
      allowComments: shareLink?.allowComments ?? video.allowComments,
      allowReactions: shareLink?.allowReactions ?? video.allowReactions,
      allowDownload: shareLink?.allowDownload ?? video.allowDownload,
      allowEmbed: shareLink?.allowEmbed ?? false,
      embedDomains: shareLink?.embedDomains ?? [],
      shareLinkId: shareLink?._id,
      viewCount: shareLink?.viewCount ?? video.viewCount,
      createdAt: video.createdAt,
      ownerName: video.ownerName,
      ownerImage: video.ownerImage,
      mimeType: finishedRendition?.mimeType ?? video.mimeType,
      url: await r2.getUrl(finishedRendition?.storageId ?? video.storageId, { expiresIn: URL_EXPIRY }),
      screenUrl: finishedRendition ? null : video.screenStorageId ? await r2.getUrl(video.screenStorageId, { expiresIn: URL_EXPIRY }) : null,
      cameraUrl: finishedRendition ? null : video.cameraStorageId ? await r2.getUrl(video.cameraStorageId, { expiresIn: URL_EXPIRY }) : null,
      thumbnailUrl: video.thumbnailStorageId ? await r2.getUrl(video.thumbnailStorageId, { expiresIn: URL_EXPIRY }) : null,
      zoomEffects: finishedRendition ? [] : video.zoomEffects ?? [],
      editState: finishedRendition ? undefined : video.editState,
      editRevision: video.editRevision ?? 0,
      mediaSource: finishedRendition ? "finished" as const : "live" as const,
      finishedRendition: finishedRendition ? {
        editRevision: finishedRendition.editRevision,
        durationMs: finishedRendition.durationMs,
        mimeType: finishedRendition.mimeType,
        sizeBytes: finishedRendition.sizeBytes,
      } : null,
      graphicAssets,
      transcript: transcript ? {
        fullText: finished ? (transcriptSegments ?? []).map((segment) => segment.text).join(" ") : transcript.fullText,
        segments: transcriptSegments ?? [],
      } : null,
      captionTrack: captionTrack ? { language: captionTrack.language, revision: captionTrack.revision, style: captionTrack.style, cues: mappedCaptionCues } : null,
      interactiveElements: mappedInteractiveElements,
      reviewRequest: reviewRequest ? {
        recipientName: reviewRequest.recipientName,
        message: reviewRequest.message,
        dueAt: reviewRequest.dueAt,
        status: reviewRequest.status,
        responseName: reviewRequest.responseName,
        responseNote: reviewRequest.responseNote,
        respondedAt: reviewRequest.respondedAt,
      } : null,
    };
  },
});

export const askContext = internalQuery({
  args: { token: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed) throw new Error("Video unavailable");
    if (video.transcriptStatus !== "done") throw new Error("This video does not have an askable transcript");
    const transcript = await ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", video._id)).first();
    if (!transcript?.segments.length) throw new Error("This video does not have an askable transcript");
    const finished = finishedPlayback(video);
    const segments = finished
      ? transcript.segments.flatMap((segment) => sourceIntervalToFinished(segment.start, segment.end, finished.timeline, finished.rendition.durationMs).map((interval) => ({ start: interval.startMs, end: interval.endMs, text: segment.text })))
      : transcript.segments;
    return { videoId: video._id, title: video.title, segments };
  },
});

export const consumeAskQuota = internalMutation({
  args: { videoId: v.id("videos"), viewerKey: v.string() },
  handler: async (ctx, args) => {
    const viewerKey = args.viewerKey.trim().slice(0, 160);
    if (viewerKey.length < 8) throw new Error("Viewer session unavailable");
    await rateLimit(ctx, `${args.videoId}:${viewerKey}`, "ask_video", 10, 60 * 60 * 1_000);
    await rateLimit(ctx, String(args.videoId), "ask_video_global", 500, 24 * 60 * 60 * 1_000);
  },
});

export const feed = query({
  args: { token: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed || !(shareLink?.allowComments ?? video.allowComments)) return [];
    const comments = (await ctx.db.query("videoComments").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect()).filter((comment) => shareLink ? comment.shareLinkId === shareLink._id : comment.shareLinkId === undefined);
    const finished = finishedPlayback(video);
    comments.sort((a, b) => a.createdAt - b.createdAt);
    return comments.flatMap((comment) => {
      const timestampMs = comment.timestampMs === undefined || !finished
        ? comment.timestampMs
        : sourceTimeToFinishedMs(comment.timestampMs, finished.timeline);
      if (comment.timestampMs !== undefined && timestampMs === null) return [];
      return [{
        _id: comment._id,
        bodyHtml: comment.bodyHtml,
        timestampMs: timestampMs ?? undefined,
        createdAt: comment.createdAt,
        authorName: comment.guestName,
        authorImage: undefined,
        isGuest: true,
      }];
    });
  },
});

export const reactions = query({
  args: { token: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed || !(shareLink?.allowReactions ?? video.allowReactions)) return [] as { emoji: string; count: number }[];
    const rows = (await ctx.db.query("videoReactions").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect()).filter((row) => shareLink ? row.shareLinkId === shareLink._id : row.shareLinkId === undefined);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.emoji] = (counts[row.emoji] || 0) + 1;
    return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
  },
});

export const reactionMoments = query({
  args: { token: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed || !(shareLink?.allowReactions ?? video.allowReactions)) return [] as { _id: string; emoji: string; timestampMs: number; createdAt: number }[];
    const rows = (await ctx.db.query("videoReactions").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect()).filter((row) => shareLink ? row.shareLinkId === shareLink._id : row.shareLinkId === undefined);
    const finished = finishedPlayback(video);
    return rows
      .filter((row) => row.timestampMs !== undefined)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
      .flatMap((row) => {
        const timestampMs = finished ? sourceTimeToFinishedMs(row.timestampMs!, finished.timeline) : row.timestampMs!;
        return timestampMs === null ? [] : [{ _id: row._id, emoji: row.emoji, timestampMs, createdAt: row.createdAt }];
      });
  },
});

export const recordView = mutation({
  args: { token: v.string(), sessionToken: v.optional(v.string()), viewerKey: v.string(), userAgent: v.optional(v.string()), referrer: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed) return;
    const viewerKey = args.viewerKey.slice(0, 160);
    if (viewerKey.length < 8) return;
    const existing = shareLink
      ? await ctx.db.query("videoViews").withIndex("by_share_viewer", (q) => q.eq("shareLinkId", shareLink._id).eq("viewerKey", viewerKey)).first()
      : (await ctx.db.query("videoViews").withIndex("by_video_viewer", (q) => q.eq("videoId", video._id).eq("viewerKey", viewerKey)).collect()).find((row) => row.shareLinkId === undefined);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastAt: now });
      return;
    }
    await ctx.db.insert("videoViews", {
      videoId: video._id, shareLinkId: shareLink?._id, viewerKey, watchedMs: 0, maxPositionMs: 0, percentWatched: 0, completed: false,
      userAgent: args.userAgent?.slice(0, 500), referrer: args.referrer?.slice(0, 1000), startedAt: now, lastAt: now,
    });
    await ctx.db.patch(video._id, { viewCount: video.viewCount + 1 });
    if (shareLink) await ctx.db.patch(shareLink._id, { viewCount: shareLink.viewCount + 1, updatedAt: now });
    if (video.viewCount === 0 && video.ownerEmail) {
      await ctx.scheduler.runAfter(0, internal.videosPublic.sendViewNotification, { to: video.ownerEmail, videoTitle: video.title, videoId: video._id });
    }
  },
});

export const updateViewProgress = mutation({
  args: { token: v.string(), sessionToken: v.optional(v.string()), viewerKey: v.string(), positionMs: v.number(), watchedDeltaMs: v.number() },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed) return;
    const viewerKey = args.viewerKey.slice(0, 160);
    const view = shareLink
      ? await ctx.db.query("videoViews").withIndex("by_share_viewer", (q) => q.eq("shareLinkId", shareLink._id).eq("viewerKey", viewerKey)).first()
      : (await ctx.db.query("videoViews").withIndex("by_video_viewer", (q) => q.eq("videoId", video._id).eq("viewerKey", viewerKey)).collect()).find((row) => row.shareLinkId === undefined);
    if (!view) return;
    const durationMs = currentFinishedRendition(video)?.durationMs ?? video.durationMs;
    const positionMs = Math.min(durationMs, Math.max(0, Number.isFinite(args.positionMs) ? args.positionMs : 0));
    const watchedDeltaMs = Math.min(30_000, Math.max(0, Number.isFinite(args.watchedDeltaMs) ? args.watchedDeltaMs : 0));
    const maxPositionMs = Math.min(durationMs, Math.max(view.maxPositionMs, positionMs));
    const percentWatched = durationMs ? Math.min(100, Math.round(maxPositionMs / durationMs * 100)) : 0;
    await ctx.db.patch(view._id, {
      watchedMs: view.watchedMs + watchedDeltaMs,
      maxPositionMs,
      percentWatched,
      completed: view.completed || percentWatched >= 90,
      lastAt: Date.now(),
    });
  },
});

export const addGuestComment = mutation({
  args: { token: v.string(), sessionToken: v.optional(v.string()), viewerKey: v.string(), guestName: v.string(), guestEmail: v.string(), body: v.string(), timestampMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed || !(shareLink?.allowComments ?? video.allowComments)) throw new Error("Comments are not enabled for this video");
    await rateLimit(ctx, `${video._id}:${args.viewerKey}`, "comment", 5, 60_000);
    const name = args.guestName.trim();
    const email = args.guestEmail.trim().toLowerCase();
    const body = args.body.trim();
    if (!name || name.length > MAX_NAME) throw new Error("Enter a valid name");
    if (!email || email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    if (!body || body.length > MAX_BODY) throw new Error("Comment must be between 1 and 5,000 characters");
    const timestampMs = incomingTimestamp(video, args.timestampMs);
    const commentId = await ctx.db.insert("videoComments", {
      videoId: video._id, shareLinkId: shareLink?._id, guestName: name, guestEmail: email, timestampMs,
      bodyHtml: `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`, createdAt: Date.now(),
    });
    if (video.ownerEmail) await ctx.scheduler.runAfter(0, internal.videosPublic.sendCommentNotification, {
      to: video.ownerEmail, videoTitle: video.title, videoId: video._id, commenterName: name, bodyText: body.slice(0, 500),
    });
    return { commentId };
  },
});

export const submitReviewResponse = mutation({
  args: {
    token: v.string(),
    sessionToken: v.optional(v.string()),
    viewerKey: v.string(),
    reviewerName: v.string(),
    decision: v.union(v.literal("approved"), v.literal("changes_requested")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !shareLink || !allowed) throw new Error("Review request is unavailable");
    const request = await ctx.db.query("videoReviewRequests").withIndex("by_share_link", (q) => q.eq("shareLinkId", shareLink._id)).first();
    if (!request || request.videoId !== video._id || request.status !== "pending") throw new Error("Review request is unavailable");
    const viewerKey = args.viewerKey.trim().slice(0, 160);
    if (viewerKey.length < 8) throw new Error("Viewer session unavailable");
    await rateLimit(ctx, `${request._id}:${viewerKey}`, "review_response", 5, 60_000);
    const reviewerName = args.reviewerName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME);
    if (!reviewerName) throw new Error("Enter your name");
    const note = args.note?.trim().slice(0, MAX_BODY) || undefined;
    if (args.decision === "changes_requested" && !note) throw new Error("Describe the changes you need");
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.decision,
      responseName: reviewerName,
      responseNote: note,
      respondedAt: now,
      updatedAt: now,
    });
    if (video.ownerEmail) await ctx.scheduler.runAfter(0, internal.videosPublic.sendReviewResponseNotification, {
      to: video.ownerEmail,
      videoTitle: video.title,
      videoId: video._id,
      reviewerName,
      decision: args.decision,
      note,
    });
    return { status: args.decision, respondedAt: now };
  },
});

export const addReaction = mutation({
  args: { token: v.string(), sessionToken: v.optional(v.string()), emoji: v.string(), viewerKey: v.string(), timestampMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed || !(shareLink?.allowReactions ?? video.allowReactions) || !REACTIONS.has(args.emoji)) return;
    const viewerKey = args.viewerKey.slice(0, 160);
    await rateLimit(ctx, `${video._id}:${viewerKey}`, "reaction", 10, 60_000);
    const existing = shareLink
      ? await ctx.db.query("videoReactions").withIndex("by_share_viewer_emoji", (q) => q.eq("shareLinkId", shareLink._id).eq("viewerKey", viewerKey).eq("emoji", args.emoji)).first()
      : (await ctx.db.query("videoReactions").withIndex("by_video_viewer_emoji", (q) => q.eq("videoId", video._id).eq("viewerKey", viewerKey).eq("emoji", args.emoji)).collect()).find((row) => row.shareLinkId === undefined);
    const timestampMs = incomingTimestamp(video, args.timestampMs);
    if (!existing) await ctx.db.insert("videoReactions", { videoId: video._id, shareLinkId: shareLink?._id, emoji: args.emoji, viewerKey, timestampMs, createdAt: Date.now() });
  },
});

export const recordInteraction = mutation({
  args: {
    token: v.string(), sessionToken: v.optional(v.string()), elementId: v.id("videoInteractiveElements"),
    viewerKey: v.string(), event: v.union(v.literal("shown"), v.literal("clicked"), v.literal("answered")), value: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { video, shareLink, allowed } = await publicVideo(ctx, args.token, args.sessionToken);
    if (!video || !allowed) return;
    const element = await ctx.db.get(args.elementId);
    if (!element || element.videoId !== video._id) return;
    const viewerKey = args.viewerKey.slice(0, 160);
    if (viewerKey.length < 8) return;
    await rateLimit(ctx, `${element._id}:${viewerKey}`, "interaction", 30, 60_000);
    await ctx.db.insert("videoInteractionEvents", { videoId: video._id, shareLinkId: shareLink?._id, elementId: element._id, viewerKey, event: args.event, value: args.value?.slice(0, 200), createdAt: Date.now() });
  },
});

function emailHtml(heading: string, title: string, body: string | undefined, url: string) {
  const config = brand();
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b"><div style="max-width:560px;margin:32px auto;padding:0 16px"><p style="font-weight:700">${escapeHtml(config.name)}</p><div style="background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:32px"><p style="color:${config.color};font-weight:700;font-size:12px;text-transform:uppercase">${escapeHtml(heading)}</p><h1 style="font-size:21px">${escapeHtml(title)}</h1>${body ? `<p style="color:#52525b;line-height:1.6">${escapeHtml(body)}</p>` : ""}<p style="margin-top:28px"><a href="${url}" style="background:${config.color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px">Open video</a></p></div><p style="text-align:center;color:#a1a1aa;font-size:12px">Sent by ${escapeHtml(config.name)}</p></div></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !fromEmail) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${brand().name} <${fromEmail}>`, to: [to], subject, html }),
  });
  if (!response.ok) console.error("Notification email failed", response.status);
}

export const sendViewNotification = internalAction({
  args: { to: v.string(), videoTitle: v.string(), videoId: v.id("videos") },
  handler: async (_ctx, args) => {
    const config = brand();
    await sendEmail(args.to, `Your video “${args.videoTitle}” got its first view`, emailHtml("First view", args.videoTitle, undefined, `${config.url}/videos/${args.videoId}`));
  },
});

export const sendCommentNotification = internalAction({
  args: { to: v.string(), videoTitle: v.string(), videoId: v.id("videos"), commenterName: v.string(), bodyText: v.string() },
  handler: async (_ctx, args) => {
    const config = brand();
    await sendEmail(args.to, `New comment on “${args.videoTitle}”`, emailHtml(`${args.commenterName} commented`, args.videoTitle, args.bodyText, `${config.url}/videos/${args.videoId}`));
  },
});

export const sendReviewRequestNotification = internalAction({
  args: {
    to: v.string(),
    reviewerName: v.string(),
    requesterName: v.string(),
    videoTitle: v.string(),
    reviewUrl: v.string(),
    message: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    reminder: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const due = args.dueAt ? `Review requested by ${new Date(args.dueAt).toLocaleDateString()}.` : undefined;
    const body = [
      `${args.requesterName} asked ${args.reviewerName} to review this video.`,
      args.message,
      due,
      "No account is required. Open the private review link to approve it or request changes.",
    ].filter(Boolean).join("\n\n");
    const subject = args.reminder ? `Reminder: review “${args.videoTitle}”` : `Review requested: “${args.videoTitle}”`;
    const heading = args.reminder ? "Video review reminder" : "Video review requested";
    await sendEmail(args.to, subject, emailHtml(heading, args.videoTitle, body, args.reviewUrl));
  },
});

export const sendReviewResponseNotification = internalAction({
  args: {
    to: v.string(),
    videoTitle: v.string(),
    videoId: v.id("videos"),
    reviewerName: v.string(),
    decision: v.union(v.literal("approved"), v.literal("changes_requested")),
    note: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const config = brand();
    const label = args.decision === "approved" ? "approved the video" : "requested changes";
    await sendEmail(args.to, `${args.reviewerName} ${label}: “${args.videoTitle}”`, emailHtml(`${args.reviewerName} ${label}`, args.videoTitle, args.note, `${config.url}/videos/${args.videoId}`));
  },
});
