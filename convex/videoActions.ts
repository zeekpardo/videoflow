import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";
import { r2 } from "./r2";
import type { Id } from "./_generated/dataModel";
import { normalizeGraphicAssetMetadata } from "../lib/graphic-assets";

const mode = v.union(v.literal("screen"), v.literal("screen_camera"), v.literal("camera"));
const DEFAULT_VIDEO_LIMIT = 500 * 1024 * 1024;

function isSupportedPrimaryVideo(contentType: string | undefined): contentType is string {
  return !!contentType && ["video/webm", "video/mp4", "video/quicktime"].some((type) => contentType.startsWith(type));
}

function isSupportedBrowserVideo(contentType: string | undefined): contentType is string {
  return !!contentType && ["video/webm", "video/mp4"].some((type) => contentType.startsWith(type));
}

export const create = action({
  args: {
    title: v.string(), storageId: v.string(), screenStorageId: v.optional(v.string()), cameraStorageId: v.optional(v.string()),
    audioStorageId: v.optional(v.string()), thumbnailStorageId: v.optional(v.string()),
    durationMs: v.number(), width: v.optional(v.number()), height: v.optional(v.number()), mode,
    mimeType: v.string(), sizeBytes: v.number(),
  },
  handler: async (ctx, args): Promise<{ videoId: Id<"videos"> }> => {
    const user = await requireUser(ctx);
    for (const key of [args.storageId, args.screenStorageId, args.cameraStorageId, args.audioStorageId, args.thumbnailStorageId]) if (key) await r2.syncMetadata(ctx, key);
    const video = await r2.getMetadata(ctx, args.storageId);
    const screen = args.screenStorageId ? await r2.getMetadata(ctx, args.screenStorageId) : null;
    const camera = args.cameraStorageId ? await r2.getMetadata(ctx, args.cameraStorageId) : null;
    const audio = args.audioStorageId ? await r2.getMetadata(ctx, args.audioStorageId) : null;
    const thumbnail = args.thumbnailStorageId ? await r2.getMetadata(ctx, args.thumbnailStorageId) : null;
    const videoLimit = Number(process.env.MAX_VIDEO_BYTES || DEFAULT_VIDEO_LIMIT);
    if (!video || typeof video.size !== "number") throw new Error("Recording upload is incomplete");
    const videoContentType = video.contentType ?? "";
    if (!isSupportedPrimaryVideo(videoContentType)) throw new Error("Recording must be a WebM, MP4, or QuickTime video");
    if (!isSupportedPrimaryVideo(args.mimeType) || args.mimeType.split(";")[0] !== videoContentType.split(";")[0]) {
      throw new Error("Recording type mismatch");
    }
    if (video.size !== args.sizeBytes) throw new Error("Recording size mismatch");
    if (video.size > videoLimit) throw new Error("Recording exceeds the configured upload limit");
    if (args.screenStorageId && (!screen || !isSupportedBrowserVideo(screen.contentType) || typeof screen.size !== "number" || !Number.isFinite(screen.size) || screen.size <= 0 || screen.size > videoLimit)) {
      throw new Error("Screen layer must be an MP4 or WebM video within the configured upload limit");
    }
    if (args.cameraStorageId && (!camera || !isSupportedBrowserVideo(camera.contentType) || typeof camera.size !== "number" || !Number.isFinite(camera.size) || camera.size <= 0 || camera.size > videoLimit)) {
      throw new Error("Camera layer must be an MP4 or WebM video within the configured upload limit");
    }
    if (audio && (!audio.contentType?.startsWith("audio/") || typeof audio.size !== "number")) throw new Error("Transcript source must be audio");
    if (thumbnail && (!thumbnail.contentType?.startsWith("image/") || typeof thumbnail.size !== "number" || thumbnail.size > 10 * 1024 * 1024)) throw new Error("Invalid thumbnail upload");
    return ctx.runMutation(internal.videos.createFromUploads, {
      ...args,
      mimeType: videoContentType,
      ownerId: user.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerImage: user.image,
      verifiedVideoSize: video.size,
      verifiedScreenSize: screen?.size,
      verifiedCameraSize: camera?.size,
      verifiedAudioSize: audio?.size,
    });
  },
});

export const replaceThumbnail = action({
  args: { videoId: v.id("videos"), storageId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireUser(ctx);
    await r2.syncMetadata(ctx, args.storageId);
    const thumbnail = await r2.getMetadata(ctx, args.storageId);
    if (!thumbnail || !thumbnail.contentType?.startsWith("image/") || typeof thumbnail.size !== "number" || thumbnail.size > 10 * 1024 * 1024) {
      throw new Error("Thumbnail must be a PNG, JPG, or WebP image under 10 MB");
    }
    await ctx.runMutation(internal.videos.replaceThumbnail, {
      videoId: args.videoId,
      storageId: args.storageId,
      ownerId: user.ownerId,
    });
  },
});

/**
 * Claims an already-uploaded browser render as the finished rendition for the
 * exact editor revision that produced it. Both the action and the internal
 * mutation verify ownership/revision so a slow or stale render cannot replace
 * a newer project.
 */
export const finalizeFinishedRendition = action({
  args: {
    videoId: v.id("videos"),
    storageId: v.string(),
    editRevision: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ editRevision: number; sizeBytes: number; mimeType: string; durationMs: number }> => {
    const user = await requireUser(ctx);
    await ctx.runQuery(internal.videos.assertFinishedRenditionOwner, {
      videoId: args.videoId,
      ownerId: user.ownerId,
      editRevision: args.editRevision,
    });

    await r2.syncMetadata(ctx, args.storageId);
    const rendition = await r2.getMetadata(ctx, args.storageId);
    const videoLimit = Number(process.env.MAX_VIDEO_BYTES || DEFAULT_VIDEO_LIMIT);
    if (
      !rendition ||
      !isSupportedBrowserVideo(rendition.contentType) ||
      typeof rendition.size !== "number" ||
      !Number.isFinite(rendition.size) ||
      rendition.size <= 0 ||
      rendition.size > videoLimit
    ) {
      throw new Error("Finished rendition must be an MP4 or WebM video within the configured upload limit");
    }

    return ctx.runMutation(internal.videos.finalizeFinishedRendition, {
      videoId: args.videoId,
      storageId: args.storageId,
      ownerId: user.ownerId,
      editRevision: args.editRevision,
      durationMs: args.durationMs,
      verifiedSizeBytes: rendition.size,
      mimeType: rendition.contentType,
    });
  },
});

export const uploadGraphicAsset = action({
  args: {
    videoId: v.id("videos"),
    assetId: v.string(),
    storageId: v.string(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args): Promise<{
    assetId: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    sizeBytes: number;
    width: number;
    height: number;
    createdAt: number;
    updatedAt: number;
  }> => {
    const user = await requireUser(ctx);
    await ctx.runQuery(internal.videoAssets.assertOwner, { videoId: args.videoId, ownerId: user.ownerId });
    await r2.syncMetadata(ctx, args.storageId);
    const uploaded = await r2.getMetadata(ctx, args.storageId);
    const metadata = normalizeGraphicAssetMetadata({
      assetId: args.assetId,
      mimeType: uploaded?.contentType ?? "",
      sizeBytes: uploaded?.size ?? 0,
      width: args.width,
      height: args.height,
    });
    return ctx.runMutation(internal.videoAssets.finalizeUpload, {
      videoId: args.videoId,
      ownerId: user.ownerId,
      assetId: metadata.assetId,
      storageId: args.storageId,
      mimeType: metadata.mimeType,
      verifiedSizeBytes: metadata.sizeBytes,
      width: metadata.width,
      height: metadata.height,
    });
  },
});
