import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const lockInfo = internalQuery({
  args: { shareToken: v.string() },
  handler: async (ctx, { shareToken }) => {
    const video = await ctx.db.query("videos").withIndex("by_share_token", (q) => q.eq("shareToken", shareToken)).first();
    if (!video || video.visibility !== "public") return null;
    return { videoId: video._id, passwordSalt: video.passwordSalt, passwordHash: video.passwordHash };
  },
});

export const ownerInfo = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const video = await ctx.db.get(videoId);
    return video ? { ownerId: video.ownerId } : null;
  },
});

export const setHash = internalMutation({
  args: { videoId: v.id("videos"), ownerId: v.string(), salt: v.optional(v.string()), hash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found");
    if (video.ownerId !== args.ownerId) throw new Error("Not authorized");
    await ctx.db.patch(args.videoId, { passwordSalt: args.salt, passwordHash: args.hash, updatedAt: Date.now() });
    const sessions = await ctx.db.query("videoShareSessions").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect();
    for (const session of sessions) await ctx.db.delete(session._id);
  },
});

export const createSession = internalMutation({
  args: { videoId: v.id("videos"), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("videoShareSessions", { ...args, createdAt: Date.now() });
  },
});

export const checkUnlockRate = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const action = "unlock";
    const safeKey = key.slice(0, 300);
    const row = await ctx.db.query("publicRateLimits").withIndex("by_key_action", (q) => q.eq("key", safeKey).eq("action", action)).first();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("publicRateLimits", { key: safeKey, action, count: 1, windowStart: now });
      return;
    }
    if (now - row.windowStart >= 5 * 60_000) {
      await ctx.db.patch(row._id, { count: 1, windowStart: now });
      return;
    }
    if (row.count >= 8) throw new Error("Too many password attempts. Wait a few minutes and try again.");
    await ctx.db.patch(row._id, { count: row.count + 1 });
  },
});
