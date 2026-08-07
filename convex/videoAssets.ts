import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { r2 } from "./r2";
import {
  MAX_GRAPHIC_ASSETS_PER_VIDEO,
  normalizeGraphicAssetId,
  normalizeGraphicAssetMetadata,
} from "../lib/graphic-assets";

const URL_EXPIRY = 24 * 60 * 60;

async function owned(
  ctx: Parameters<typeof requireUser>[0] & { db: { get: (id: Id<"videos">) => Promise<Doc<"videos"> | null> } },
  videoId: Id<"videos">
) {
  const user = await requireUser(ctx);
  const video = await ctx.db.get(videoId);
  if (!video) throw new Error("Video not found");
  if (video.ownerId !== user.ownerId) throw new Error("Not authorized");
  return { user, video };
}

async function pendingUpload(ctx: MutationCtx, key: string, ownerId: string) {
  const pending = await ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", key)).first();
  if (!pending || pending.ownerId !== ownerId) throw new Error("Upload does not belong to this user");
  return pending;
}

export const list = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const assets = await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    assets.sort((a, b) => a.createdAt - b.createdAt || a.assetId.localeCompare(b.assetId));
    return Promise.all(assets.map(async (asset) => ({
      assetId: asset.assetId,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      url: await r2.getUrl(asset.storageId, { expiresIn: URL_EXPIRY }),
    })));
  },
});

export const remove = mutation({
  args: { videoId: v.id("videos"), assetId: v.string() },
  handler: async (ctx, { videoId, assetId: requestedId }) => {
    await owned(ctx, videoId);
    const assetId = normalizeGraphicAssetId(requestedId);
    const asset = await ctx.db.query("videoAssets").withIndex("by_video_asset", (q) => q.eq("videoId", videoId).eq("assetId", assetId)).first();
    if (!asset) return;
    await ctx.db.delete(asset._id);
    try { await r2.deleteObject(ctx, asset.storageId); } catch { /* object may already be gone */ }
  },
});

export const assertOwner = internalQuery({
  args: { videoId: v.id("videos"), ownerId: v.string() },
  handler: async (ctx, { videoId, ownerId }) => {
    const video = await ctx.db.get(videoId);
    if (!video || video.ownerId !== ownerId) throw new Error("Not authorized");
    return { videoId };
  },
});

export const finalizeUpload = internalMutation({
  args: {
    videoId: v.id("videos"),
    ownerId: v.string(),
    assetId: v.string(),
    storageId: v.string(),
    mimeType: v.string(),
    verifiedSizeBytes: v.number(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const metadata = normalizeGraphicAssetMetadata({
      assetId: args.assetId,
      mimeType: args.mimeType,
      sizeBytes: args.verifiedSizeBytes,
      width: args.width,
      height: args.height,
    });
    const upload = await pendingUpload(ctx, args.storageId, args.ownerId);
    const existing = await ctx.db.query("videoAssets")
      .withIndex("by_video_asset", (q) => q.eq("videoId", args.videoId).eq("assetId", metadata.assetId))
      .first();
    if (!existing) {
      const count = (await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect()).length;
      if (count >= MAX_GRAPHIC_ASSETS_PER_VIDEO) throw new Error(`A video can have up to ${MAX_GRAPHIC_ASSETS_PER_VIDEO} graphic assets`);
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerId: args.ownerId,
        storageId: args.storageId,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        width: metadata.width,
        height: metadata.height,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("videoAssets", {
        videoId: args.videoId,
        ownerId: args.ownerId,
        assetId: metadata.assetId,
        storageId: args.storageId,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        width: metadata.width,
        height: metadata.height,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.delete(upload._id);
    if (existing?.storageId && existing.storageId !== args.storageId) {
      try { await r2.deleteObject(ctx, existing.storageId); } catch { /* old object may already be gone */ }
    }
    return { ...metadata, createdAt: existing?.createdAt ?? now, updatedAt: now };
  },
});
