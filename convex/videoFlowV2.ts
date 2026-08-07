import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { hashToken } from "./lib/tokens";
import { r2 } from "./r2";

const captionPreset = v.union(v.literal("minimal"), v.literal("karaoke"), v.literal("pop"), v.literal("lower_third"));
const captionPosition = v.union(v.literal("top"), v.literal("middle"), v.literal("bottom"));
const captionStyle = v.object({
  preset: captionPreset,
  position: captionPosition,
  textColor: v.string(),
  highlightColor: v.string(),
  backgroundColor: v.string(),
  fontScale: v.number(),
  burnIn: v.boolean(),
});
const captionCue = v.object({
  id: v.string(), startMs: v.number(), endMs: v.number(), text: v.string(),
  words: v.optional(v.array(v.object({ text: v.string(), startMs: v.number(), endMs: v.number() }))),
});
const shareCta = v.object({ label: v.string(), url: v.string() });
const documentKind = v.union(v.literal("sop"), v.literal("tutorial"), v.literal("release_notes"), v.literal("recap"), v.literal("email"));
const documentVisual = v.object({ assetId: v.string(), timestampMs: v.number(), caption: v.string() });
const jobPreset = v.union(v.literal("native"), v.literal("1080p"), v.literal("720p"));
const jobFormat = v.union(v.literal("mp4"), v.literal("webm"));
const socialProvider = v.union(v.literal("youtube"), v.literal("linkedin"), v.literal("zernio"));
const zernioPlatform = v.union(
  v.literal("twitter"), v.literal("instagram"), v.literal("tiktok"), v.literal("youtube"),
  v.literal("facebook"), v.literal("linkedin"), v.literal("bluesky"), v.literal("threads"),
  v.literal("reddit"), v.literal("pinterest"), v.literal("telegram"), v.literal("snapchat"),
  v.literal("googlebusiness"), v.literal("discord"),
);

async function owned(ctx: Parameters<typeof requireUser>[0] & { db: { get: (id: Id<"videos">) => Promise<Doc<"videos"> | null> } }, videoId: Id<"videos">) {
  const user = await requireUser(ctx);
  const video = await ctx.db.get(videoId);
  if (!video) throw new Error("Video not found");
  if (video.ownerId !== user.ownerId) throw new Error("Not authorized");
  return { user, video };
}

function cleanName(value: string, fallback: string, max = 120) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || fallback;
}

function cleanTags(input: string[]) {
  return [...new Set(input.map((tag) => tag.replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

function cleanDomains(input: string[]) {
  return [...new Set(input.map((domain) => domain.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").split("/")[0]).filter((domain) => /^[a-z0-9.-]+$/.test(domain)))].slice(0, 30);
}

function cleanEmail(value: string) {
  const email = value.trim().toLowerCase().slice(0, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid reviewer email");
  return email;
}

function safeUrl(input: string | undefined) {
  if (!input) return undefined;
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Links must use http or https");
  return url.toString();
}

function workerAuthorized(secret: string) {
  const expected = process.env.MEDIA_WORKER_SECRET;
  if (!expected || expected.length < 32 || secret.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ secret.charCodeAt(index);
  return mismatch === 0;
}

export const workspace = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const [folders, organization] = await Promise.all([
      ctx.db.query("videoFolders").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect(),
      ctx.db.query("videoOrganization").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect(),
    ]);
    return {
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      organization,
      tags: [...new Set(organization.flatMap((row) => row.tags))].sort(),
    };
  },
});

export const searchLibrary = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const needle = args.query.trim().toLowerCase().slice(0, 120);
    if (!needle) return [] as Id<"videos">[];
    const videos = await ctx.db.query("videos").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect();
    const matches: Id<"videos">[] = [];
    for (const video of videos.slice(0, 1_000)) {
      if (`${video.title}\n${video.description ?? ""}`.toLowerCase().includes(needle)) {
        matches.push(video._id);
        continue;
      }
      const transcript = await ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", video._id)).first();
      const captions = await ctx.db.query("videoCaptionTracks").withIndex("by_video", (q) => q.eq("videoId", video._id)).first();
      if (transcript?.fullText.toLowerCase().includes(needle) || captions?.cues.some((cue) => cue.text.toLowerCase().includes(needle))) matches.push(video._id);
      if (matches.length >= 100) break;
    }
    return matches;
  },
});

export const createFolder = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("videoFolders")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.ownerId !== user.ownerId) throw new Error("Parent folder not found");
    }
    const now = Date.now();
    return ctx.db.insert("videoFolders", { ownerId: user.ownerId, name: cleanName(args.name, "Untitled folder"), parentId: args.parentId, createdAt: now, updatedAt: now });
  },
});

export const renameFolder = mutation({
  args: { folderId: v.id("videoFolders"), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== user.ownerId) throw new Error("Folder not found");
    await ctx.db.patch(args.folderId, { name: cleanName(args.name, "Untitled folder"), updatedAt: Date.now() });
  },
});

export const removeFolder = mutation({
  args: { folderId: v.id("videoFolders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.ownerId !== user.ownerId) throw new Error("Folder not found");
    const children = await ctx.db.query("videoFolders").withIndex("by_owner_parent", (q) => q.eq("ownerId", user.ownerId).eq("parentId", args.folderId)).collect();
    if (children.length) throw new Error("Move or delete nested folders first");
    const rows = await ctx.db.query("videoOrganization").withIndex("by_owner_folder", (q) => q.eq("ownerId", user.ownerId).eq("folderId", args.folderId)).collect();
    for (const row of rows) await ctx.db.patch(row._id, { folderId: undefined, updatedAt: Date.now() });
    await ctx.db.delete(args.folderId);
  },
});

export const organizeVideos = mutation({
  args: {
    videoIds: v.array(v.id("videos")),
    folderId: v.optional(v.union(v.id("videoFolders"), v.null())),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!args.videoIds.length || args.videoIds.length > 100) throw new Error("Select between 1 and 100 videos");
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.ownerId !== user.ownerId) throw new Error("Folder not found");
    }
    const now = Date.now();
    for (const videoId of args.videoIds) {
      const video = await ctx.db.get(videoId);
      if (!video || video.ownerId !== user.ownerId) throw new Error("Not authorized");
      const existing = await ctx.db.query("videoOrganization").withIndex("by_video", (q) => q.eq("videoId", videoId)).first();
      const next = {
        folderId: args.folderId === null ? undefined : args.folderId ?? existing?.folderId,
        tags: args.tags ? cleanTags(args.tags) : existing?.tags ?? [],
        favorite: args.favorite ?? existing?.favorite ?? false,
        archivedAt: args.archived === undefined ? existing?.archivedAt : args.archived ? now : undefined,
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, next);
      else await ctx.db.insert("videoOrganization", { videoId, ownerId: user.ownerId, ...next });
    }
  },
});

export const listShareLinks = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoShareLinks").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(({ passwordHash, passwordSalt, ...row }) => ({ ...row, hasPassword: !!passwordHash || !!passwordSalt }));
  },
});

export const createShareLink = mutation({
  args: { videoId: v.id("videos"), name: v.string() },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    const existing = await ctx.db.query("videoShareLinks").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect();
    if (existing.length >= 25) throw new Error("A video can have up to 25 share links");
    const now = Date.now();
    return ctx.db.insert("videoShareLinks", {
      videoId: args.videoId, ownerId: user.ownerId, token: crypto.randomUUID().replaceAll("-", ""), name: cleanName(args.name, `Share link ${existing.length + 1}`), status: "active",
      viewCount: 0, requireEmail: false, allowedDomains: [], allowComments: video.allowComments, allowReactions: video.allowReactions,
      allowDownload: video.allowDownload, allowEmbed: false, embedDomains: [], cta: video.cta,
      createdAt: now, updatedAt: now,
    });
  },
});

export const listReviewRequests = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoReviewRequests").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return Promise.all(rows.sort((a, b) => b.createdAt - a.createdAt).map(async (row) => {
      const link = await ctx.db.get(row.shareLinkId);
      return {
        ...row,
        token: link?.token ?? null,
        linkStatus: link?.status ?? "revoked" as const,
        requireEmail: link?.requireEmail ?? false,
        hasPassword: !!link?.passwordHash || !!link?.passwordSalt,
      };
    }));
  },
});

export const workspaceReviewRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("videoReviewRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId))
      .collect();
    const requests = await Promise.all(rows.sort((a, b) => b.createdAt - a.createdAt).map(async (row) => {
      const [video, link] = await Promise.all([ctx.db.get(row.videoId), ctx.db.get(row.shareLinkId)]);
      if (!video || video.ownerId !== user.ownerId) return null;
      return {
        _id: row._id,
        videoId: row.videoId,
        videoTitle: video.title,
        recipientName: row.recipientName,
        recipientEmail: row.recipientEmail,
        message: row.message,
        dueAt: row.dueAt,
        status: row.status,
        responseName: row.responseName,
        responseNote: row.responseNote,
        respondedAt: row.respondedAt,
        canceledAt: row.canceledAt,
        lastRemindedAt: row.lastRemindedAt,
        reminderCount: row.reminderCount,
        createdAt: row.createdAt,
        token: link?.ownerId === user.ownerId ? link.token : null,
        linkStatus: link?.ownerId === user.ownerId ? link.status : "revoked" as const,
      };
    }));
    return requests.filter((request) => request !== null);
  },
});

export const createReviewRequest = mutation({
  args: {
    videoId: v.id("videos"),
    recipientName: v.string(),
    recipientEmail: v.string(),
    message: v.optional(v.string()),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    const existing = await ctx.db.query("videoShareLinks").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect();
    if (existing.length >= 25) throw new Error("A video can have up to 25 share and review links");
    const recipientName = cleanName(args.recipientName, "Reviewer");
    const recipientEmail = cleanEmail(args.recipientEmail);
    const message = args.message?.trim().slice(0, 2_000) || undefined;
    const dueAt = args.dueAt === undefined ? undefined : Math.max(Date.now() + 60_000, args.dueAt);
    const now = Date.now();
    const token = crypto.randomUUID().replaceAll("-", "");
    const shareLinkId = await ctx.db.insert("videoShareLinks", {
      videoId: args.videoId,
      ownerId: user.ownerId,
      token,
      name: `Review: ${recipientName}`.slice(0, 120),
      status: "active",
      viewCount: 0,
      requireEmail: false,
      allowedDomains: [],
      allowComments: true,
      allowReactions: false,
      allowDownload: false,
      allowEmbed: false,
      embedDomains: [],
      createdAt: now,
      updatedAt: now,
    });
    const reviewRequestId = await ctx.db.insert("videoReviewRequests", {
      videoId: args.videoId,
      shareLinkId,
      ownerId: user.ownerId,
      recipientName,
      recipientEmail,
      message,
      dueAt,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.videosPublic.sendReviewRequestNotification, {
      to: recipientEmail,
      reviewerName: recipientName,
      requesterName: video.ownerName,
      videoTitle: video.title,
      reviewUrl: `${process.env.APP_URL || "http://localhost:3000"}/v/${token}`,
      message,
      dueAt,
    });
    return { reviewRequestId, shareLinkId, token };
  },
});

export const remindReviewRequest = mutation({
  args: { reviewRequestId: v.id("videoReviewRequests") },
  handler: async (ctx, { reviewRequestId }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(reviewRequestId);
    if (!request || request.ownerId !== user.ownerId) throw new Error("Review request not found");
    if (request.status !== "pending") throw new Error("Only pending reviews can receive reminders");
    const [video, link] = await Promise.all([ctx.db.get(request.videoId), ctx.db.get(request.shareLinkId)]);
    if (!video || video.ownerId !== user.ownerId || !link || link.ownerId !== user.ownerId || link.status !== "active") {
      throw new Error("Activate the review link before sending a reminder");
    }
    const now = Date.now();
    if (request.lastRemindedAt && now - request.lastRemindedAt < 4 * 60 * 60 * 1_000) {
      throw new Error("A reminder was already sent in the last four hours");
    }
    const reminderCount = (request.reminderCount ?? 0) + 1;
    await ctx.db.patch(request._id, { lastRemindedAt: now, reminderCount, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.videosPublic.sendReviewRequestNotification, {
      to: request.recipientEmail,
      reviewerName: request.recipientName,
      requesterName: video.ownerName,
      videoTitle: video.title,
      reviewUrl: `${process.env.APP_URL || "http://localhost:3000"}/v/${link.token}`,
      message: request.message,
      dueAt: request.dueAt,
      reminder: true,
    });
    return true;
  },
});

export const cancelReviewRequest = mutation({
  args: { reviewRequestId: v.id("videoReviewRequests") },
  handler: async (ctx, { reviewRequestId }) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(reviewRequestId);
    if (!request || request.ownerId !== user.ownerId) throw new Error("Review request not found");
    if (request.status === "canceled") return true;
    if (request.status !== "pending") throw new Error("Only pending reviews can be canceled");
    const link = await ctx.db.get(request.shareLinkId);
    if (!link || link.ownerId !== user.ownerId) throw new Error("Review link not found");
    const now = Date.now();
    await ctx.db.patch(request._id, { status: "canceled", canceledAt: now, updatedAt: now });
    await ctx.db.patch(link._id, { status: "revoked", updatedAt: now });
    const sessions = await ctx.db.query("videoShareLinkSessions").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    return true;
  },
});

export const updateShareLink = mutation({
  args: {
    shareLinkId: v.id("videoShareLinks"),
    name: v.optional(v.string()), status: v.optional(v.union(v.literal("active"), v.literal("revoked"))),
    expiresAt: v.optional(v.union(v.number(), v.null())), maxViews: v.optional(v.union(v.number(), v.null())),
    requireEmail: v.optional(v.boolean()), allowedDomains: v.optional(v.array(v.string())),
    allowComments: v.optional(v.boolean()), allowReactions: v.optional(v.boolean()), allowDownload: v.optional(v.boolean()),
    allowEmbed: v.optional(v.boolean()), embedDomains: v.optional(v.array(v.string())),
    cta: v.optional(v.union(shareCta, v.null())), customTitle: v.optional(v.union(v.string(), v.null())), customDescription: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(args.shareLinkId);
    if (!link || link.ownerId !== user.ownerId) throw new Error("Share link not found");
    const { shareLinkId, ...input } = args;
    void shareLinkId;
    const patch: Partial<Doc<"videoShareLinks">> = { updatedAt: Date.now() };
    if (input.name !== undefined) patch.name = cleanName(input.name, "Share link");
    if (input.status !== undefined) patch.status = input.status;
    if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt === null ? undefined : Math.max(Date.now() + 60_000, input.expiresAt);
    if (input.maxViews !== undefined) patch.maxViews = input.maxViews === null ? undefined : Math.max(1, Math.min(1_000_000, Math.floor(input.maxViews)));
    if (input.requireEmail !== undefined) patch.requireEmail = input.requireEmail;
    if (input.allowedDomains !== undefined) patch.allowedDomains = cleanDomains(input.allowedDomains);
    if (input.allowComments !== undefined) patch.allowComments = input.allowComments;
    if (input.allowReactions !== undefined) patch.allowReactions = input.allowReactions;
    if (input.allowDownload !== undefined) patch.allowDownload = input.allowDownload;
    if (input.allowEmbed !== undefined) patch.allowEmbed = input.allowEmbed;
    if (input.embedDomains !== undefined) patch.embedDomains = cleanDomains(input.embedDomains);
    if (input.cta !== undefined) patch.cta = input.cta === null ? undefined : { label: cleanName(input.cta.label, "Learn more", 80), url: safeUrl(input.cta.url)! };
    if (input.customTitle !== undefined) patch.customTitle = input.customTitle === null ? undefined : cleanName(input.customTitle, "Untitled video", 200);
    if (input.customDescription !== undefined) patch.customDescription = input.customDescription === null ? undefined : input.customDescription.trim().slice(0, 5_000) || undefined;
    await ctx.db.patch(link._id, patch);
  },
});

export const rotateShareLink = mutation({
  args: { shareLinkId: v.id("videoShareLinks") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get(args.shareLinkId);
    if (!link || link.ownerId !== user.ownerId) throw new Error("Share link not found");
    const sessions = await ctx.db.query("videoShareLinkSessions").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    const token = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.patch(link._id, { token, updatedAt: Date.now() });
    return { token };
  },
});

export const shareLinkOwnerInfo = internalQuery({
  args: { shareLinkId: v.id("videoShareLinks") },
  handler: async (ctx, { shareLinkId }) => {
    const link = await ctx.db.get(shareLinkId);
    return link ? { ownerId: link.ownerId } : null;
  },
});

export const setShareLinkPasswordHash = internalMutation({
  args: { shareLinkId: v.id("videoShareLinks"), ownerId: v.string(), salt: v.optional(v.string()), hash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.shareLinkId);
    if (!link || link.ownerId !== args.ownerId) throw new Error("Not authorized");
    await ctx.db.patch(link._id, { passwordSalt: args.salt, passwordHash: args.hash, updatedAt: Date.now() });
    const sessions = await ctx.db.query("videoShareLinkSessions").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).collect();
    for (const session of sessions) await ctx.db.delete(session._id);
  },
});

export const shareLinkLockInfo = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db.query("videoShareLinks").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (!link || link.status !== "active" || (link.expiresAt !== undefined && link.expiresAt <= Date.now()) || (link.maxViews !== undefined && link.viewCount >= link.maxViews)) return null;
    const reviewRequest = await ctx.db.query("videoReviewRequests").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).first();
    return { shareLinkId: link._id, videoId: link.videoId, passwordSalt: link.passwordSalt, passwordHash: link.passwordHash, requireEmail: link.requireEmail, allowedDomains: link.allowedDomains, reviewerEmail: reviewRequest?.recipientEmail };
  },
});

export const createShareLinkSession = internalMutation({
  args: { shareLinkId: v.id("videoShareLinks"), tokenHash: v.string(), viewerEmail: v.optional(v.string()), expiresAt: v.number() },
  handler: async (ctx, args) => ctx.db.insert("videoShareLinkSessions", { ...args, createdAt: Date.now() }),
});

export const getCaptionTrack = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    return ctx.db.query("videoCaptionTracks").withIndex("by_video", (q) => q.eq("videoId", videoId)).first();
  },
});

export const saveCaptionTrack = mutation({
  args: { videoId: v.id("videos"), language: v.string(), cues: v.array(captionCue), style: captionStyle },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    if (args.cues.length > 2_000) throw new Error("A caption track can have up to 2,000 cues");
    const ids = new Set<string>();
    const cues = args.cues.map((cue) => {
      const id = cleanName(cue.id, "", 80);
      const text = cue.text.replace(/\s+/g, " ").trim().slice(0, 1_000);
      if (!id || ids.has(id) || !text) throw new Error("Caption cues require unique IDs and text");
      ids.add(id);
      const startMs = Math.max(0, Math.min(video.durationMs, cue.startMs));
      const endMs = Math.max(startMs + 50, Math.min(video.durationMs, cue.endMs));
      return { ...cue, id, text, startMs, endMs };
    }).sort((a, b) => a.startMs - b.startMs);
    const existing = await ctx.db.query("videoCaptionTracks").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).first();
    const now = Date.now();
    const revision = (existing?.revision ?? 0) + 1;
    const value = { ownerId: user.ownerId, language: cleanName(args.language, "en", 20).toLowerCase(), cues, style: args.style, revision, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("videoCaptionTracks", { videoId: args.videoId, ...value, createdAt: now });
    const editRevision = (video.editRevision ?? 0) + 1;
    await ctx.db.patch(video._id, { editRevision, finishedRenditionStatus: undefined, finishedRenditionError: undefined, updatedAt: now });
    return { revision, editRevision };
  },
});

export const listInteractiveElements = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoInteractiveElements").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return Promise.all(rows.sort((a, b) => a.startMs - b.startMs || a.createdAt - b.createdAt).map(async (row) => {
      const events = await ctx.db.query("videoInteractionEvents").withIndex("by_element", (q) => q.eq("elementId", row._id)).collect();
      return { ...row, analytics: { shown: events.filter((event) => event.event === "shown").length, clicked: events.filter((event) => event.event === "clicked").length, answered: events.filter((event) => event.event === "answered").length } };
    }));
  },
});

export const saveInteractiveElement = mutation({
  args: {
    videoId: v.id("videos"), elementId: v.optional(v.id("videoInteractiveElements")),
    kind: v.union(v.literal("chapter"), v.literal("hotspot"), v.literal("cta"), v.literal("poll")),
    startMs: v.number(), endMs: v.number(), label: v.string(), description: v.optional(v.string()),
    x: v.number(), y: v.number(), width: v.number(), height: v.number(), url: v.optional(v.string()), options: v.optional(v.array(v.string())), required: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    if (args.elementId) {
      const existing = await ctx.db.get(args.elementId);
      if (!existing || existing.ownerId !== user.ownerId || existing.videoId !== video._id) throw new Error("Interactive element not found");
    }
    const startMs = Math.max(0, Math.min(video.durationMs, args.startMs));
    const endMs = Math.max(startMs + 100, Math.min(video.durationMs, args.endMs));
    const now = Date.now();
    const value = {
      videoId: video._id, ownerId: user.ownerId, kind: args.kind, startMs, endMs, label: cleanName(args.label, "Untitled element", 120),
      description: args.description?.trim().slice(0, 500) || undefined,
      x: Math.max(0, Math.min(1, args.x)), y: Math.max(0, Math.min(1, args.y)), width: Math.max(.05, Math.min(1, args.width)), height: Math.max(.05, Math.min(1, args.height)),
      url: safeUrl(args.url), options: args.options?.map((option) => cleanName(option, "Option", 120)).slice(0, 10), required: args.required, updatedAt: now,
    };
    if (args.elementId) { await ctx.db.patch(args.elementId, value); return args.elementId; }
    return ctx.db.insert("videoInteractiveElements", { ...value, createdAt: now });
  },
});

export const removeInteractiveElement = mutation({
  args: { elementId: v.id("videoInteractiveElements") },
  handler: async (ctx, { elementId }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(elementId);
    if (!row || row.ownerId !== user.ownerId) throw new Error("Interactive element not found");
    await ctx.db.delete(elementId);
  },
});

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db.query("videoTemplates").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect();
  },
});

export const saveTemplate = mutation({
  args: {
    templateId: v.optional(v.id("videoTemplates")), name: v.string(), background: v.string(), screenPadding: v.number(), screenRadius: v.number(), screenShadow: v.boolean(),
    cameraPosition: v.union(v.literal("bottom_left"), v.literal("bottom_right"), v.literal("top_left"), v.literal("top_right")), captionPreset,
    introTitle: v.optional(v.string()), outroTitle: v.optional(v.string()), defaultCta: v.optional(shareCta),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.templateId) {
      const existing = await ctx.db.get(args.templateId);
      if (!existing || existing.ownerId !== user.ownerId) throw new Error("Template not found");
    }
    const { templateId, ...input } = args;
    const now = Date.now();
    const value = { ...input, ownerId: user.ownerId, name: cleanName(input.name, "Untitled template"), background: input.background.slice(0, 100), screenPadding: Math.max(0, Math.min(200, input.screenPadding)), screenRadius: Math.max(0, Math.min(100, input.screenRadius)), introTitle: input.introTitle?.trim().slice(0, 200) || undefined, outroTitle: input.outroTitle?.trim().slice(0, 200) || undefined, defaultCta: input.defaultCta ? { label: cleanName(input.defaultCta.label, "Learn more", 80), url: safeUrl(input.defaultCta.url)! } : undefined, updatedAt: now };
    if (templateId) { await ctx.db.patch(templateId, value); return templateId; }
    return ctx.db.insert("videoTemplates", { ...value, createdAt: now });
  },
});

export const listDocuments = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const documents = await ctx.db.query("videoDocuments").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const assets = await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const byAssetId = new Map(assets.map((asset) => [asset.assetId, asset]));
    return Promise.all(documents.map(async (document) => ({
      ...document,
      visuals: await Promise.all((document.visuals ?? []).flatMap((visual) => {
        const asset = byAssetId.get(visual.assetId);
        return asset ? [{ ...visual, url: r2.getUrl(asset.storageId, { expiresIn: 24 * 60 * 60 }) }] : [];
      }).map(async (visual) => ({ ...visual, url: await visual.url }))),
    })));
  },
});

export const attachDocumentVisuals = mutation({
  args: { documentId: v.id("videoDocuments"), visuals: v.array(documentVisual) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document || document.ownerId !== user.ownerId) throw new Error("Document not found");
    const video = await ctx.db.get(document.videoId);
    if (!video || video.ownerId !== user.ownerId) throw new Error("Video not found");
    const available = await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect();
    const allowed = new Set(available.filter((asset) => asset.ownerId === user.ownerId).map((asset) => asset.assetId));
    const visuals = args.visuals.slice(0, 6).map((visual) => {
      if (!allowed.has(visual.assetId)) throw new Error("A document image is unavailable");
      return {
        assetId: visual.assetId,
        timestampMs: Math.min(video.durationMs, Math.max(0, Number.isFinite(visual.timestampMs) ? visual.timestampMs : 0)),
        caption: cleanName(visual.caption, "Video step", 240),
      };
    });
    await ctx.db.patch(document._id, { visuals, updatedAt: Date.now() });
    return document._id;
  },
});

export const saveDocument = mutation({
  args: { videoId: v.id("videos"), kind: documentKind, title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { user } = await owned(ctx, args.videoId);
    const now = Date.now();
    return ctx.db.insert("videoDocuments", { videoId: args.videoId, ownerId: user.ownerId, kind: args.kind, title: cleanName(args.title, "Video document", 200), body: args.body.trim().slice(0, 100_000), status: "ready", createdAt: now, updatedAt: now });
  },
});

export const documentContext = internalQuery({
  args: { videoId: v.id("videos"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const transcript = await ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", video._id)).first();
    return { title: video.title, durationMs: video.durationMs, transcript };
  },
});

export const saveGeneratedDocument = internalMutation({
  args: { videoId: v.id("videos"), ownerId: v.string(), kind: documentKind, title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const now = Date.now();
    return ctx.db.insert("videoDocuments", { videoId: video._id, ownerId: args.ownerId, kind: args.kind, title: cleanName(args.title, "Video document", 200), body: args.body.trim().slice(0, 100_000), status: "ready", createdAt: now, updatedAt: now });
  },
});

export const listTaskProposals = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoTaskProposals").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows.sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt);
  },
});

export const listTasks = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoTasks").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt);
  },
});

export const taskContext = internalQuery({
  args: { videoId: v.id("videos"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const [transcript, comments, reviews] = await Promise.all([
      ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", video._id)).first(),
      ctx.db.query("videoComments").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect(),
      ctx.db.query("videoReviewRequests").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect(),
    ]);
    return {
      title: video.title,
      transcript: transcript?.segments ?? [],
      comments: comments.map((comment) => ({ id: String(comment._id), text: comment.bodyHtml.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " "), timestampMs: comment.timestampMs })),
      reviews: reviews.filter((review) => review.status === "changes_requested" && review.responseNote).map((review) => ({ id: String(review._id), text: review.responseNote! })),
    };
  },
});

export const saveTaskProposals = internalMutation({
  args: {
    videoId: v.id("videos"), ownerId: v.string(),
    proposals: v.array(v.object({
      fingerprint: v.string(), sourceKind: v.union(v.literal("transcript"), v.literal("comment"), v.literal("review")),
      sourceId: v.optional(v.string()), sourceTimestampMs: v.optional(v.number()), title: v.string(), description: v.optional(v.string()), confidence: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const ids: Id<"videoTaskProposals">[] = [];
    for (const proposal of args.proposals.slice(0, 50)) {
      const fingerprint = cleanName(proposal.fingerprint, "proposal", 240);
      const existing = await ctx.db.query("videoTaskProposals").withIndex("by_video_fingerprint", (q) => q.eq("videoId", video._id).eq("fingerprint", fingerprint)).first();
      if (existing) { ids.push(existing._id); continue; }
      const now = Date.now();
      ids.push(await ctx.db.insert("videoTaskProposals", {
        videoId: video._id, ownerId: args.ownerId, fingerprint, sourceKind: proposal.sourceKind,
        sourceId: proposal.sourceId?.slice(0, 200), sourceTimestampMs: proposal.sourceTimestampMs === undefined ? undefined : Math.min(video.durationMs, Math.max(0, proposal.sourceTimestampMs)),
        title: cleanName(proposal.title, "Video task", 180), description: proposal.description?.trim().slice(0, 2_000) || undefined,
        confidence: Math.min(1, Math.max(0, proposal.confidence)), status: "proposed", createdAt: now, updatedAt: now,
      }));
    }
    return ids;
  },
});

export const acceptTaskProposal = mutation({
  args: { proposalId: v.id("videoTaskProposals") },
  handler: async (ctx, { proposalId }) => {
    const user = await requireUser(ctx);
    const proposal = await ctx.db.get(proposalId);
    if (!proposal || proposal.ownerId !== user.ownerId) throw new Error("Task proposal not found");
    const video = await ctx.db.get(proposal.videoId);
    if (!video || video.ownerId !== user.ownerId) throw new Error("Video not found");
    const existing = await ctx.db.query("videoTasks").withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id)).first();
    if (existing) return existing._id;
    const now = Date.now();
    const taskId = await ctx.db.insert("videoTasks", {
      videoId: proposal.videoId, ownerId: user.ownerId, proposalId: proposal._id, sourceKind: proposal.sourceKind,
      sourceTimestampMs: proposal.sourceTimestampMs, title: proposal.title, description: proposal.description, status: "todo", createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(proposal._id, { status: "accepted", updatedAt: now });
    return taskId;
  },
});

export const rejectTaskProposal = mutation({
  args: { proposalId: v.id("videoTaskProposals") },
  handler: async (ctx, { proposalId }) => {
    const user = await requireUser(ctx);
    const proposal = await ctx.db.get(proposalId);
    if (!proposal || proposal.ownerId !== user.ownerId) throw new Error("Task proposal not found");
    await ctx.db.patch(proposal._id, { status: "rejected", updatedAt: Date.now() });
  },
});

export const createTask = mutation({
  args: { videoId: v.id("videos"), title: v.string(), description: v.optional(v.string()), sourceTimestampMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    const now = Date.now();
    return ctx.db.insert("videoTasks", {
      videoId: video._id, ownerId: user.ownerId, sourceKind: "manual",
      sourceTimestampMs: args.sourceTimestampMs === undefined ? undefined : Math.min(video.durationMs, Math.max(0, args.sourceTimestampMs)),
      title: cleanName(args.title, "Video task", 180), description: args.description?.trim().slice(0, 2_000) || undefined,
      status: "todo", createdAt: now, updatedAt: now,
    });
  },
});

export const createTaskFromComment = mutation({
  args: { commentId: v.id("videoComments"), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");
    const video = await ctx.db.get(comment.videoId);
    if (!video || video.ownerId !== user.ownerId) throw new Error("Comment not found");
    if (comment.taskId) {
      const existing = await ctx.db.get(comment.taskId);
      if (existing?.ownerId === user.ownerId) return existing._id;
    }
    const body = comment.bodyHtml.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const now = Date.now();
    const taskId = await ctx.db.insert("videoTasks", {
      videoId: video._id,
      ownerId: user.ownerId,
      sourceCommentId: comment._id,
      sourceKind: "comment",
      sourceTimestampMs: comment.timestampMs,
      title: cleanName(args.title ?? body, "Address reviewer feedback", 180),
      description: body.slice(0, 2_000) || undefined,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(comment._id, { taskId, resolvedAt: undefined });
    return taskId;
  },
});

export const updateTask = mutation({
  args: { taskId: v.id("videoTasks"), title: v.optional(v.string()), description: v.optional(v.union(v.string(), v.null())), status: v.optional(v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done"))) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.ownerId !== user.ownerId) throw new Error("Task not found");
    const status = args.status ?? task.status;
    const now = Date.now();
    await ctx.db.patch(task._id, {
      title: args.title === undefined ? task.title : cleanName(args.title, "Video task", 180),
      description: args.description === undefined ? task.description : args.description === null ? undefined : args.description.trim().slice(0, 2_000) || undefined,
      status,
      updatedAt: now,
    });
    if (task.sourceCommentId) {
      const comment = await ctx.db.get(task.sourceCommentId);
      if (comment?.videoId === task.videoId && comment.taskId === task._id) {
        await ctx.db.patch(comment._id, { resolvedAt: status === "done" ? now : undefined });
      }
    }
  },
});

export const listSocialConnections = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("socialConnections").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(({ workerBindingHash, ...connection }) => {
      void workerBindingHash;
      return connection;
    });
  },
});

export const createSocialConnection = mutation({
  args: { provider: socialProvider, name: v.string(), accountRef: v.optional(v.string()), targetPlatform: v.optional(zernioPlatform), workerBindingSecret: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.workerBindingSecret.length < 32 || args.workerBindingSecret.length > 256) throw new Error("Worker binding secret must be 32–256 characters");
    const existing = await ctx.db.query("socialConnections").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect();
    if (existing.length >= 25) throw new Error("An account can have up to 25 social connections");
    const accountRef = args.accountRef?.trim().slice(0, 300) || undefined;
    if (args.provider === "linkedin" && !accountRef?.startsWith("urn:li:")) throw new Error("LinkedIn connections require a member or organization URN");
    if (args.provider === "zernio" && (!accountRef || !args.targetPlatform)) throw new Error("Zernio connections require a target platform and account ID");
    const now = Date.now();
    return ctx.db.insert("socialConnections", {
      ownerId: user.ownerId, provider: args.provider, name: cleanName(args.name, args.provider === "youtube" ? "YouTube" : args.provider === "linkedin" ? "LinkedIn" : "Zernio"),
      accountRef, targetPlatform: args.provider === "zernio" ? args.targetPlatform : undefined,
      workerBindingHash: hashToken(args.workerBindingSecret), status: "active", createdAt: now, updatedAt: now,
    });
  },
});

export const updateSocialConnection = mutation({
  args: { connectionId: v.id("socialConnections"), status: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.ownerId !== user.ownerId) throw new Error("Social connection not found");
    await ctx.db.patch(connection._id, { status: args.status, updatedAt: Date.now() });
  },
});

export const enqueueSocialPublish = mutation({
  args: { videoId: v.id("videos"), connectionId: v.id("socialConnections"), title: v.string(), caption: v.string(), privacy: v.union(v.literal("private"), v.literal("unlisted"), v.literal("public")) },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.ownerId !== user.ownerId || connection.status !== "active") throw new Error("Social connection is unavailable");
    const revision = video.editRevision ?? 0;
    if (video.finishedRenditionStatus !== "ready" || video.finishedRenditionRevision !== revision || !video.finishedRenditionStorageId || !video.finishedRenditionMimeType?.startsWith("video/mp4") || !video.finishedRenditionSizeBytes) {
      throw new Error("Publish a current MP4 rendition before sending this video to social channels");
    }
    const idempotencyKey = `${args.videoId}:${revision}:${args.connectionId}`;
    const existing = await ctx.db.query("socialPublishJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).first();
    if (existing && !["failed", "canceled", "superseded"].includes(existing.status)) return existing._id;
    const now = Date.now();
    return ctx.db.insert("socialPublishJobs", {
      videoId: video._id, ownerId: user.ownerId, connectionId: connection._id, provider: connection.provider, editRevision: revision,
      title: cleanName(args.title, video.title, 200), caption: args.caption.trim().slice(0, 2_200), privacy: args.privacy,
      idempotencyKey: existing ? `${idempotencyKey}:${now}` : idempotencyKey, providerRequestId: crypto.randomUUID(),
      status: "queued", progress: 0, attempts: 0, availableAt: now, createdAt: now, updatedAt: now,
    });
  },
});

export const listSocialPublishJobs = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("socialPublishJobs").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
  },
});

export const cancelSocialPublish = mutation({
  args: { jobId: v.id("socialPublishJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireUser(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== user.ownerId) throw new Error("Social publish job not found");
    if (["published", "failed", "canceled", "superseded"].includes(job.status)) return;
    await ctx.db.patch(job._id, { status: "canceled", leaseExpiresAt: undefined, updatedAt: Date.now() });
  },
});

export const socialConnectionWorkerInfo = internalQuery({
  args: { connectionId: v.id("socialConnections") },
  handler: async (ctx, { connectionId }) => ctx.db.get(connectionId),
});

export const claimSocialPublishData = internalMutation({
  args: { connectionId: v.id("socialConnections"), workerId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [queued, retrying] = await Promise.all([
      ctx.db.query("socialPublishJobs").withIndex("by_connection_status_available", (q) => q.eq("connectionId", args.connectionId).eq("status", "queued").lte("availableAt", now)).take(20),
      ctx.db.query("socialPublishJobs").withIndex("by_connection_status_available", (q) => q.eq("connectionId", args.connectionId).eq("status", "retry_wait").lte("availableAt", now)).take(20),
    ]);
    const job = [...queued, ...retrying].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!job) return null;
    const video = await ctx.db.get(job.videoId);
    if (!video || (video.editRevision ?? 0) !== job.editRevision || video.finishedRenditionRevision !== job.editRevision || video.finishedRenditionStatus !== "ready" || !video.finishedRenditionStorageId || !video.finishedRenditionSizeBytes || !video.finishedRenditionMimeType?.startsWith("video/mp4")) {
      await ctx.db.patch(job._id, { status: "superseded", updatedAt: now });
      return null;
    }
    const workerId = args.workerId.slice(0, 100);
    await ctx.db.patch(job._id, { status: "leased", attempts: job.attempts + 1, leaseOwner: workerId, leaseExpiresAt: now + 60_000, progress: .01, updatedAt: now });
    return { job: { ...job, attempts: job.attempts + 1, leaseOwner: workerId }, video };
  },
});

export const claimSocialPublish = action({
  args: { workerSecret: v.string(), connectionId: v.id("socialConnections"), connectionSecret: v.string(), workerId: v.string() },
  handler: async (ctx, args): Promise<null | Record<string, unknown>> => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const connection = await ctx.runQuery(internal.videoFlowV2.socialConnectionWorkerInfo, { connectionId: args.connectionId });
    if (!connection || connection.status !== "active" || connection.workerBindingHash !== hashToken(args.connectionSecret)) throw new Error("Social connection authentication failed");
    const claimed = await ctx.runMutation(internal.videoFlowV2.claimSocialPublishData, { connectionId: connection._id, workerId: args.workerId });
    if (!claimed) return null;
    return {
      jobId: claimed.job._id, attempts: claimed.job.attempts, provider: claimed.job.provider, providerRequestId: claimed.job.providerRequestId,
      title: claimed.job.title, caption: claimed.job.caption, privacy: claimed.job.privacy,
      accountRef: connection.accountRef, targetPlatform: connection.targetPlatform, durationMs: claimed.video.finishedRenditionDurationMs ?? claimed.video.durationMs,
      source: { url: await r2.getUrl(claimed.video.finishedRenditionStorageId!, { expiresIn: 3_600 }), sizeBytes: claimed.video.finishedRenditionSizeBytes, mimeType: claimed.video.finishedRenditionMimeType },
    };
  },
});

export const updateSocialPublishData = internalMutation({
  args: { jobId: v.id("socialPublishJobs"), workerId: v.string(), status: v.union(v.literal("uploading"), v.literal("publishing"), v.literal("retry_wait"), v.literal("failed")), progress: v.number(), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || ["published", "canceled", "superseded"].includes(job.status)) throw new Error("Social worker lease is not valid");
    const now = Date.now();
    const retry = args.status === "retry_wait";
    const terminal = args.status === "failed";
    await ctx.db.patch(job._id, {
      status: args.status, progress: Math.min(1, Math.max(0, args.progress)), errorCode: args.errorCode?.slice(0, 100), errorMessage: args.errorMessage?.slice(0, 500),
      leaseExpiresAt: retry || terminal ? undefined : now + 60_000,
      availableAt: retry ? now + Math.min(300_000, 5_000 * 2 ** Math.max(0, job.attempts - 1)) : job.availableAt,
      updatedAt: now,
    });
  },
});

export const updateSocialPublish = action({
  args: { workerSecret: v.string(), jobId: v.id("socialPublishJobs"), workerId: v.string(), status: v.union(v.literal("uploading"), v.literal("publishing"), v.literal("retry_wait"), v.literal("failed")), progress: v.number(), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const { workerSecret, ...values } = args;
    void workerSecret;
    await ctx.runMutation(internal.videoFlowV2.updateSocialPublishData, values);
  },
});

export const completeSocialPublishData = internalMutation({
  args: { jobId: v.id("socialPublishJobs"), workerId: v.string(), providerPostId: v.string(), providerPostUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || ["published", "canceled", "superseded", "failed"].includes(job.status)) throw new Error("Social worker lease is not valid");
    const video = await ctx.db.get(job.videoId);
    if (!video || (video.editRevision ?? 0) !== job.editRevision) {
      await ctx.db.patch(job._id, { status: "superseded", updatedAt: Date.now() });
      throw new Error("The video changed during social publishing");
    }
    await ctx.db.patch(job._id, { status: "published", progress: 1, providerPostId: args.providerPostId.slice(0, 500), providerPostUrl: args.providerPostUrl?.slice(0, 2_000), leaseExpiresAt: undefined, updatedAt: Date.now() });
  },
});

export const completeSocialPublish = action({
  args: { workerSecret: v.string(), jobId: v.id("socialPublishJobs"), workerId: v.string(), providerPostId: v.string(), providerPostUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const { workerSecret, ...values } = args;
    void workerSecret;
    await ctx.runMutation(internal.videoFlowV2.completeSocialPublishData, values);
  },
});

export const enqueueRender = mutation({
  args: { videoId: v.id("videos"), preset: jobPreset, format: jobFormat },
  handler: async (ctx, args) => {
    const { user, video } = await owned(ctx, args.videoId);
    const revision = video.editRevision ?? 0;
    const existing = (await ctx.db.query("mediaJobs").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect()).find((job) => job.kind === "render" && job.editRevision === revision && job.preset === args.preset && job.format === args.format && !["failed", "canceled", "superseded"].includes(job.status));
    if (existing) return existing._id;
    const now = Date.now();
    const id = await ctx.db.insert("mediaJobs", { videoId: args.videoId, ownerId: user.ownerId, kind: "render", editRevision: revision, preset: args.preset, format: args.format, status: "queued", progress: 0, attempts: 0, availableAt: now, createdAt: now, updatedAt: now });
    await ctx.db.patch(video._id, { finishedRenditionRevision: revision, finishedRenditionStatus: "rendering", finishedRenditionError: undefined, finishedRenditionUpdatedAt: now, updatedAt: now });
    return id;
  },
});

export const listMediaJobs = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("mediaJobs").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
  },
});

export const cancelMediaJob = mutation({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireUser(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== user.ownerId) throw new Error("Media job not found");
    if (["ready", "failed", "canceled", "superseded"].includes(job.status)) return;
    await ctx.db.patch(jobId, { status: "canceled", updatedAt: Date.now() });
  },
});

export const claimWorkerJobData = internalMutation({
  args: { workerId: v.string() },
  handler: async (ctx, { workerId }) => {
    const now = Date.now();
    const [queued, retrying] = await Promise.all([
      ctx.db.query("mediaJobs").withIndex("by_status_available", (q) => q.eq("status", "queued").lte("availableAt", now)).take(20),
      ctx.db.query("mediaJobs").withIndex("by_status_available", (q) => q.eq("status", "retry_wait").lte("availableAt", now)).take(20),
    ]);
    const job = [...queued, ...retrying].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!job) return null;
    const video = await ctx.db.get(job.videoId);
    if (!video || (video.editRevision ?? 0) !== job.editRevision) {
      await ctx.db.patch(job._id, { status: "superseded", updatedAt: now });
      return null;
    }
    await ctx.db.patch(job._id, { status: "leased", attempts: job.attempts + 1, leaseOwner: workerId.slice(0, 100), leaseExpiresAt: now + 60_000, updatedAt: now });
    return { job: { ...job, attempts: job.attempts + 1, status: "leased" as const, leaseOwner: workerId.slice(0, 100), leaseExpiresAt: now + 60_000 }, video };
  },
});

export const workerJobAssets = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const video = await ctx.db.get(videoId);
    if (!video) return null;
    const [captions, graphics] = await Promise.all([
      ctx.db.query("videoCaptionTracks").withIndex("by_video", (q) => q.eq("videoId", videoId)).first(),
      ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect(),
    ]);
    return { captions, graphics };
  },
});

export const registerWorkerOutput = internalMutation({
  args: { jobId: v.id("mediaJobs"), workerId: v.string(), outputStorageId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || !["leased", "processing", "uploading"].includes(job.status)) throw new Error("Worker lease is not valid");
    await ctx.db.patch(job._id, { outputStorageId: args.outputStorageId, status: "processing", progress: Math.max(job.progress, .01), leaseExpiresAt: Date.now() + 60_000, updatedAt: Date.now() });
  },
});

export const claimWorkerJob = action({
  args: { workerSecret: v.string(), workerId: v.string() },
  handler: async (ctx, args): Promise<null | Record<string, unknown>> => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const claimed = await ctx.runMutation(internal.videoFlowV2.claimWorkerJobData, { workerId: args.workerId });
    if (!claimed) return null;
    const assets = await ctx.runQuery(internal.videoFlowV2.workerJobAssets, { videoId: claimed.video._id });
    const outputStorageId = `videos/${claimed.video._id}/derived/r${claimed.job.editRevision}/${claimed.job.preset}/playback.${claimed.job.format}`;
    const stagingStorageId = claimed.job.format === "mp4"
      ? `videos/${claimed.video._id}/derived/r${claimed.job.editRevision}/${claimed.job.preset}/job-${claimed.job._id}.webm`
      : outputStorageId;
    const [output, staging] = await Promise.all([
      r2.generateUploadUrl(outputStorageId),
      stagingStorageId === outputStorageId ? Promise.resolve(null) : r2.generateUploadUrl(stagingStorageId),
    ]);
    await ctx.runMutation(internal.videoFlowV2.registerWorkerOutput, { jobId: claimed.job._id, workerId: args.workerId, outputStorageId });
    const graphicAssets = await Promise.all((assets?.graphics ?? []).map(async (asset) => ({ assetId: asset.assetId, url: await r2.getUrl(asset.storageId, { expiresIn: 900 }) })));
    return {
      jobId: claimed.job._id, videoId: claimed.video._id, editRevision: claimed.job.editRevision, attempts: claimed.job.attempts, preset: claimed.job.preset, format: claimed.job.format,
      durationMs: claimed.video.durationMs, width: claimed.video.width, height: claimed.video.height, mode: claimed.video.mode,
      editState: claimed.video.editState, zoomEffects: claimed.video.zoomEffects ?? [], captions: assets?.captions ?? null, graphicAssets,
      sources: {
        primary: await r2.getUrl(claimed.video.storageId, { expiresIn: 900 }),
        screen: claimed.video.screenStorageId ? await r2.getUrl(claimed.video.screenStorageId, { expiresIn: 900 }) : null,
        camera: claimed.video.cameraStorageId ? await r2.getUrl(claimed.video.cameraStorageId, { expiresIn: 900 }) : null,
      },
      renderUpload: {
        url: staging?.url ?? output.url,
        key: stagingStorageId,
        readUrl: await r2.getUrl(stagingStorageId, { expiresIn: 3_600 }),
      },
      output: { url: output.url, key: outputStorageId },
    };
  },
});

export const updateWorkerJobData = internalMutation({
  args: { jobId: v.id("mediaJobs"), workerId: v.string(), status: v.union(v.literal("processing"), v.literal("uploading"), v.literal("verifying"), v.literal("retry_wait"), v.literal("failed")), progress: v.number(), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || ["ready", "canceled", "superseded"].includes(job.status)) throw new Error("Worker lease is not valid");
    const now = Date.now();
    const terminal = args.status === "failed";
    const retry = args.status === "retry_wait";
    await ctx.db.patch(job._id, { status: args.status, progress: Math.max(0, Math.min(1, args.progress)), errorCode: args.errorCode?.slice(0, 100), errorMessage: args.errorMessage?.slice(0, 500), leaseExpiresAt: terminal || retry ? undefined : now + 60_000, availableAt: retry ? now + Math.min(300_000, 5_000 * 2 ** Math.max(0, job.attempts - 1)) : job.availableAt, updatedAt: now });
    if (terminal) await ctx.db.patch(job.videoId, { finishedRenditionStatus: "error", finishedRenditionError: args.errorMessage?.slice(0, 500) || "Background publishing failed", finishedRenditionUpdatedAt: now, updatedAt: now });
  },
});

export const updateWorkerJob = action({
  args: { workerSecret: v.string(), jobId: v.id("mediaJobs"), workerId: v.string(), status: v.union(v.literal("processing"), v.literal("uploading"), v.literal("verifying"), v.literal("retry_wait"), v.literal("failed")), progress: v.number(), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const { workerSecret, ...values } = args;
    void workerSecret;
    await ctx.runMutation(internal.videoFlowV2.updateWorkerJobData, values);
  },
});

export const completeWorkerJobData = internalMutation({
  args: { jobId: v.id("mediaJobs"), workerId: v.string(), sizeBytes: v.number(), mimeType: v.string(), durationMs: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || !job.outputStorageId || ["ready", "canceled", "superseded", "failed"].includes(job.status)) throw new Error("Worker lease is not valid");
    const video = await ctx.db.get(job.videoId);
    if (!video || (video.editRevision ?? 0) !== job.editRevision) {
      await ctx.db.patch(job._id, { status: "superseded", updatedAt: Date.now() });
      throw new Error("The video changed while rendering");
    }
    const now = Date.now();
    const previousStorageId = video.finishedRenditionStorageId;
    await ctx.db.patch(job._id, { status: "ready", progress: 1, outputSizeBytes: args.sizeBytes, outputMimeType: args.mimeType, outputDurationMs: args.durationMs, leaseExpiresAt: undefined, updatedAt: now });
    await ctx.db.patch(video._id, { finishedRenditionStorageId: job.outputStorageId, finishedRenditionSizeBytes: args.sizeBytes, finishedRenditionMimeType: args.mimeType, finishedRenditionDurationMs: args.durationMs, finishedRenditionRevision: job.editRevision, finishedRenditionStatus: "ready", finishedRenditionError: undefined, finishedRenditionUpdatedAt: now, updatedAt: now });
    if (previousStorageId && previousStorageId !== job.outputStorageId) {
      try { await r2.deleteObject(ctx, previousStorageId); } catch { /* cleanup can retry */ }
    }
  },
});

export const completeWorkerJob = action({
  args: { workerSecret: v.string(), jobId: v.id("mediaJobs"), workerId: v.string(), durationMs: v.number() },
  handler: async (ctx, args) => {
    if (!workerAuthorized(args.workerSecret)) throw new Error("Worker authentication failed");
    const job = await ctx.runQuery(internal.videoFlowV2.workerJobForCompletion, { jobId: args.jobId, workerId: args.workerId });
    if (!job?.outputStorageId) throw new Error("Worker output is not registered");
    await r2.syncMetadata(ctx, job.outputStorageId);
    const metadata = await r2.getMetadata(ctx, job.outputStorageId);
    if (!metadata || typeof metadata.size !== "number" || metadata.size <= 0 || !metadata.contentType?.startsWith("video/")) throw new Error("Worker output is invalid");
    await ctx.runMutation(internal.videoFlowV2.completeWorkerJobData, { jobId: args.jobId, workerId: args.workerId, sizeBytes: metadata.size, mimeType: metadata.contentType, durationMs: Math.max(100, args.durationMs) });
    if (job.format === "mp4") {
      const stagingKey = `videos/${job.videoId}/derived/r${job.editRevision}/${job.preset}/job-${job._id}.webm`;
      try { await r2.deleteObject(ctx, stagingKey); } catch { /* cleanup retry can remove it later */ }
    }
  },
});

export const workerJobForCompletion = internalQuery({
  args: { jobId: v.id("mediaJobs"), workerId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    return job?.leaseOwner === args.workerId && !["ready", "canceled", "superseded", "failed"].includes(job.status) ? job : null;
  },
});
