import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const ownerShareInfo = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const video = await ctx.db.get(videoId);
    return video ? { ownerId: video.ownerId, shareToken: video.shareToken } : null;
  },
});

export const setVisibility = internalMutation({
  args: { videoId: v.id("videos"), ownerId: v.string(), visibility: v.union(v.literal("private"), v.literal("public")), shareToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found");
    if (video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const shareToken = args.visibility === "public" ? args.shareToken || video.shareToken : video.shareToken;
    if (args.visibility === "public" && !shareToken) throw new Error("Share token is required");
    await ctx.db.patch(args.videoId, { visibility: args.visibility, shareToken, updatedAt: Date.now() });
    return { shareToken };
  },
});

export const regenerate = internalMutation({
  args: { videoId: v.id("videos"), ownerId: v.string(), shareToken: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found");
    if (video.ownerId !== args.ownerId) throw new Error("Not authorized");
    await ctx.db.patch(args.videoId, { shareToken: args.shareToken, updatedAt: Date.now() });
    const sessions = await ctx.db.query("videoShareSessions").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    return { shareToken: args.shareToken };
  },
});
