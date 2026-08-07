import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { clearFinishedRenditionFields, currentFinishedRendition } from "./lib/finishedRendition";
import { r2 } from "./r2";

const URL_EXPIRY = 24 * 60 * 60;
const TRANSCRIPTION_LIMIT = 25 * 1024 * 1024;
const mode = v.union(v.literal("screen"), v.literal("screen_camera"), v.literal("camera"));
const zoomEffect = v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), scale: v.number() });
const editStateV1 = v.object({
  version: v.literal(1),
  cuts: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number() })),
  crop: v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() }),
  screen: v.object({ x: v.number(), y: v.number(), scale: v.number(), cornerRadius: v.number() }),
  camera: v.optional(v.object({
    x: v.number(),
    y: v.number(),
    size: v.number(),
    shape: v.union(v.literal("circle"), v.literal("rounded"), v.literal("square")),
    strokeWidth: v.optional(v.number()),
    strokeColor: v.optional(v.string()),
    mirror: v.boolean(),
    visible: v.boolean(),
  })),
  textOverlays: v.array(v.object({
    id: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    text: v.string(),
    x: v.number(),
    y: v.number(),
    fontSize: v.number(),
    color: v.string(),
    background: v.string(),
  })),
});
const timedObject = v.object({
  id: v.string(),
  kind: v.union(v.literal("rectangle"), v.literal("ellipse"), v.literal("arrow"), v.literal("callout"), v.literal("image")),
  startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), width: v.number(), height: v.number(),
  rotation: v.number(), opacity: v.number(), zIndex: v.number(), fill: v.string(), stroke: v.string(), strokeWidth: v.number(),
  text: v.optional(v.string()), textColor: v.optional(v.string()), fontSize: v.optional(v.number()), assetId: v.optional(v.string()),
});
const editStateV2 = v.object({
  version: v.literal(2),
  trim: v.object({ startMs: v.number(), endMs: v.number() }),
  cuts: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number() })),
  crop: v.object({ top: v.number(), right: v.number(), bottom: v.number(), left: v.number() }),
  screen: v.object({ x: v.number(), y: v.number(), scale: v.number(), cornerRadius: v.number() }),
  camera: v.optional(v.object({
    x: v.number(), y: v.number(), size: v.number(),
    shape: v.union(v.literal("circle"), v.literal("rounded"), v.literal("square")),
    strokeWidth: v.optional(v.number()), strokeColor: v.optional(v.string()), mirror: v.boolean(), visible: v.boolean(),
  })),
  textOverlays: v.array(v.object({
    id: v.string(), startMs: v.number(), endMs: v.number(), text: v.string(), x: v.number(), y: v.number(),
    fontSize: v.number(), color: v.string(), background: v.string(),
  })),
  audio: v.object({ muted: v.boolean(), gain: v.number(), fadeInMs: v.number(), fadeOutMs: v.number() }),
  objects: v.array(timedObject),
  interactions: v.object({
    clicksEnabled: v.boolean(), keysEnabled: v.boolean(),
    clicks: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), x: v.number(), y: v.number(), color: v.string(), size: v.number() })),
    keys: v.array(v.object({ id: v.string(), startMs: v.number(), endMs: v.number(), label: v.string(), x: v.number(), y: v.number() })),
  }),
});
const editState = v.union(editStateV1, editStateV2);

type EditState = NonNullable<Doc<"videos">["editState"]>;
type EditStateV2 = Extract<EditState, { version: 2 }>;

const MAX_CUTS = 100;
const MAX_TEXT_OVERLAYS = 100;
const MAX_OBJECTS = 100;
const MAX_INTERACTIONS = 200;
const MAX_OVERLAY_TEXT = 500;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function finite(value: number, field: string) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeId(value: string, kind: string, seen: Set<string>) {
  const id = value.trim().slice(0, 80);
  if (!id) throw new Error(`${kind} must have an ID`);
  if (seen.has(id)) throw new Error(`${kind} IDs must be unique`);
  seen.add(id);
  return id;
}

function safeColor(value: string, field: string, allowTransparent = false) {
  const color = value.trim().toLowerCase();
  if ((allowTransparent && color === "transparent") || HEX_COLOR.test(color)) return color;
  throw new Error(`${field} must be a hex color${allowTransparent ? " or transparent" : ""}`);
}

function capCropPair(first: number, second: number): [number, number] {
  const total = first + second;
  if (total <= 0.95) return [first, second];
  const ratio = 0.95 / total;
  return [first * ratio, second * ratio].map((value) => Math.round(value * 1_000_000) / 1_000_000) as [number, number];
}

function normalizedRange(startValue: number, endValue: number, durationMs: number, field: string) {
  const startMs = clamp(finite(startValue, `${field} start`), 0, Math.max(0, durationMs - 1));
  const endMs = clamp(finite(endValue, `${field} end`), startMs + 1, durationMs);
  return { startMs, endMs };
}

function normalizeEditState(value: EditState, durationMs: number): EditStateV2 {
  if (value.cuts.length > MAX_CUTS) throw new Error(`A video can have up to ${MAX_CUTS} cuts`);
  if (value.textOverlays.length > MAX_TEXT_OVERLAYS) throw new Error(`A video can have up to ${MAX_TEXT_OVERLAYS} text overlays`);
  if (value.version === 2 && value.objects.length > MAX_OBJECTS) throw new Error(`A video can have up to ${MAX_OBJECTS} objects`);
  if (value.version === 2 && (value.interactions.clicks.length > MAX_INTERACTIONS || value.interactions.keys.length > MAX_INTERACTIONS)) throw new Error(`A video can have up to ${MAX_INTERACTIONS} interactions of each kind`);

  const cutIds = new Set<string>();
  const cuts = value.cuts.map((cut) => ({
    id: safeId(cut.id, "Cut", cutIds),
    ...normalizedRange(cut.startMs, cut.endMs, durationMs, "Cut"),
  })).sort((a, b) => a.startMs - b.startMs);
  for (let index = 1; index < cuts.length; index += 1) {
    if (cuts[index].startMs < cuts[index - 1].endMs) throw new Error("Cuts cannot overlap");
  }

  let top = clamp(finite(value.crop.top, "Crop top"), 0, 0.95);
  let right = clamp(finite(value.crop.right, "Crop right"), 0, 0.95);
  let bottom = clamp(finite(value.crop.bottom, "Crop bottom"), 0, 0.95);
  let left = clamp(finite(value.crop.left, "Crop left"), 0, 0.95);
  [top, bottom] = capCropPair(top, bottom);
  [left, right] = capCropPair(left, right);

  const textIds = new Set<string>();
  const textOverlays = value.textOverlays.map((overlay) => {
    const text = overlay.text.trim().slice(0, MAX_OVERLAY_TEXT);
    if (!text) throw new Error("Text overlays cannot be empty");
    return {
      id: safeId(overlay.id, "Text overlay", textIds),
      ...normalizedRange(overlay.startMs, overlay.endMs, durationMs, "Text overlay"),
      text,
      x: clamp(finite(overlay.x, "Text overlay x"), 0, 1),
      y: clamp(finite(overlay.y, "Text overlay y"), 0, 1),
      fontSize: clamp(finite(overlay.fontSize, "Text overlay font size"), 10, 200),
      color: safeColor(overlay.color, "Text color"),
      background: safeColor(overlay.background, "Text background", true),
    };
  });

  const trim = value.version === 2
    ? normalizedRange(value.trim.startMs, value.trim.endMs, durationMs, "Trim")
    : { startMs: 0, endMs: durationMs };
  const removedInsideTrim = cuts.reduce((sum, cut) => {
    const startMs = Math.max(trim.startMs, cut.startMs);
    const endMs = Math.min(trim.endMs, cut.endMs);
    return sum + Math.max(0, endMs - startMs);
  }, 0);
  const editedDurationMs = Math.max(0, trim.endMs - trim.startMs - removedInsideTrim);
  const maxFadeMs = Math.min(10_000, editedDurationMs);

  const objectIds = new Set<string>();
  const objects = value.version === 2 ? value.objects.map((item, index) => {
    const text = item.text?.trim().slice(0, MAX_OVERLAY_TEXT) || undefined;
    const assetId = item.assetId?.trim().slice(0, 80) || undefined;
    if (item.kind === "image" && !assetId) throw new Error("Image objects require an asset ID");
    return {
      id: safeId(item.id, "Object", objectIds),
      kind: item.kind,
      ...normalizedRange(item.startMs, item.endMs, durationMs, "Object"),
      x: clamp(finite(item.x, "Object x"), 0, 1),
      y: clamp(finite(item.y, "Object y"), 0, 1),
      width: clamp(finite(item.width, "Object width"), 0.01, 1),
      height: clamp(finite(item.height, "Object height"), 0.01, 1),
      rotation: clamp(finite(item.rotation, "Object rotation"), -360, 360),
      opacity: clamp(finite(item.opacity, "Object opacity"), 0, 1),
      zIndex: Math.round(clamp(finite(item.zIndex, "Object layer"), -100, 100)),
      fill: safeColor(item.fill, "Object fill", true),
      stroke: safeColor(item.stroke, "Object stroke", true),
      strokeWidth: clamp(finite(item.strokeWidth, "Object stroke width"), 0, 32),
      ...(text ? { text } : {}),
      ...(item.textColor ? { textColor: safeColor(item.textColor, "Object text color") } : {}),
      ...(item.fontSize !== undefined ? { fontSize: clamp(finite(item.fontSize, "Object font size"), 10, 200) } : {}),
      ...(assetId ? { assetId } : {}),
      _order: index,
    };
  }).sort((a, b) => a.zIndex - b.zIndex || a._order - b._order).map(({ _order, ...item }) => {
    void _order;
    return item;
  }) : [];

  const clickIds = new Set<string>();
  const clicks = value.version === 2 ? value.interactions.clicks.map((item) => ({
    id: safeId(item.id, "Click interaction", clickIds),
    ...normalizedRange(item.startMs, item.endMs, durationMs, "Click interaction"),
    x: clamp(finite(item.x, "Click interaction x"), 0, 1),
    y: clamp(finite(item.y, "Click interaction y"), 0, 1),
    color: safeColor(item.color, "Click interaction color"),
    size: clamp(finite(item.size, "Click interaction size"), 4, 240),
  })) : [];
  const keyIds = new Set<string>();
  const keys = value.version === 2 ? value.interactions.keys.map((item) => {
    const label = item.label.trim().slice(0, 80);
    if (!label) throw new Error("Key interactions require a label");
    return {
      id: safeId(item.id, "Key interaction", keyIds),
      ...normalizedRange(item.startMs, item.endMs, durationMs, "Key interaction"),
      label,
      x: clamp(finite(item.x, "Key interaction x"), 0, 1),
      y: clamp(finite(item.y, "Key interaction y"), 0, 1),
    };
  }) : [];

  return {
    version: 2,
    trim,
    cuts,
    crop: { top, right, bottom, left },
    screen: {
      x: clamp(finite(value.screen.x, "Screen x"), 0, 1),
      y: clamp(finite(value.screen.y, "Screen y"), 0, 1),
      scale: clamp(finite(value.screen.scale, "Screen scale"), 0.25, 4),
      cornerRadius: clamp(finite(value.screen.cornerRadius, "Screen corner radius"), 0, 100),
    },
    camera: value.camera ? {
      x: clamp(finite(value.camera.x, "Camera x"), 0, 1),
      y: clamp(finite(value.camera.y, "Camera y"), 0, 1),
      size: clamp(finite(value.camera.size, "Camera size"), 0.05, 1),
      shape: value.camera.shape,
      strokeWidth: clamp(finite(value.camera.strokeWidth ?? 3, "Camera stroke width"), 0, 12),
      strokeColor: safeColor(value.camera.strokeColor ?? "#ffffff", "Camera stroke color"),
      mirror: value.camera.mirror,
      visible: value.camera.visible,
    } : undefined,
    textOverlays,
    audio: value.version === 2 ? {
      muted: value.audio.muted,
      gain: clamp(finite(value.audio.gain, "Audio gain"), 0, 1),
      fadeInMs: clamp(finite(value.audio.fadeInMs, "Audio fade in"), 0, maxFadeMs),
      fadeOutMs: clamp(finite(value.audio.fadeOutMs, "Audio fade out"), 0, maxFadeMs),
    } : { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
    objects,
    interactions: value.version === 2 ? {
      clicksEnabled: value.interactions.clicksEnabled,
      keysEnabled: value.interactions.keysEnabled,
      clicks,
      keys,
    } : { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
  };
}

function transcriptionConfigured() {
  const provider = process.env.TRANSCRIPTION_PROVIDER;
  if (provider === "none") return false;
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  return !!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_API_KEY;
}

async function owned(ctx: Parameters<typeof requireUser>[0] & { db: { get: (id: Id<"videos">) => Promise<Doc<"videos"> | null> } }, videoId: Id<"videos">) {
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

function normalizeZoomEffects(video: Doc<"videos">, effects: Array<{ id: string; startMs: number; endMs: number; x: number; y: number; scale: number }>) {
  if (effects.length > 50) throw new Error("A video can have up to 50 zoom effects");
  const seen = new Set<string>();
  return effects.map((effect) => {
    const id = effect.id.trim().slice(0, 80);
    if (!id || seen.has(id)) throw new Error("Zoom effects must have unique IDs");
    seen.add(id);
    const startMs = Math.min(video.durationMs, Math.max(0, effect.startMs));
    const endMs = Math.min(video.durationMs, Math.max(startMs + 100, effect.endMs));
    return {
      id,
      startMs,
      endMs,
      x: Math.min(.95, Math.max(.05, effect.x)),
      y: Math.min(.95, Math.max(.05, effect.y)),
      scale: Math.min(3, Math.max(1.2, effect.scale)),
    };
  }).filter((effect) => effect.endMs > effect.startMs);
}

async function deleteObjectQuietly(ctx: MutationCtx, key?: string) {
  if (!key) return;
  try { await r2.deleteObject(ctx, key); } catch { /* object may already have expired or been removed */ }
}

async function card(video: Doc<"videos">) {
  return {
    _id: video._id,
    title: video.title,
    durationMs: video.durationMs,
    mode: video.mode,
    visibility: video.visibility,
    shareToken: video.shareToken,
    viewCount: video.viewCount,
    transcriptStatus: video.transcriptStatus,
    finishedRenditionStatus: video.finishedRenditionStatus,
    finishedRenditionRevision: video.finishedRenditionRevision,
    finishedRenditionCurrent: !!currentFinishedRendition(video),
    createdAt: video.createdAt,
    thumbnailUrl: video.thumbnailStorageId ? await r2.getUrl(video.thumbnailStorageId, { expiresIn: URL_EXPIRY }) : null,
  };
}

export const createFromUploads = internalMutation({
  args: {
    ownerId: v.string(), ownerName: v.string(), ownerEmail: v.optional(v.string()), ownerImage: v.optional(v.string()),
    title: v.string(), storageId: v.string(), screenStorageId: v.optional(v.string()), cameraStorageId: v.optional(v.string()),
    audioStorageId: v.optional(v.string()), thumbnailStorageId: v.optional(v.string()),
    durationMs: v.number(), width: v.optional(v.number()), height: v.optional(v.number()), mode,
    mimeType: v.string(), sizeBytes: v.number(), verifiedVideoSize: v.number(),
    verifiedScreenSize: v.optional(v.number()), verifiedCameraSize: v.optional(v.number()), verifiedAudioSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.durationMs) || args.durationMs <= 0 || args.durationMs > 24 * 60 * 60 * 1000) throw new Error("Invalid recording duration");
    if (args.sizeBytes !== args.verifiedVideoSize) throw new Error("Recording size mismatch");
    const uploadKeys = [args.storageId, args.screenStorageId, args.cameraStorageId, args.audioStorageId, args.thumbnailStorageId].filter((key): key is string => !!key);
    if (new Set(uploadKeys).size !== uploadKeys.length) throw new Error("Recording assets must use distinct upload keys");
    const videoUpload = await pendingUpload(ctx, args.storageId, args.ownerId);
    const screenUpload = args.screenStorageId ? await pendingUpload(ctx, args.screenStorageId, args.ownerId) : null;
    const cameraUpload = args.cameraStorageId ? await pendingUpload(ctx, args.cameraStorageId, args.ownerId) : null;
    const audioUpload = args.audioStorageId ? await pendingUpload(ctx, args.audioStorageId, args.ownerId) : null;
    const thumbnailUpload = args.thumbnailStorageId ? await pendingUpload(ctx, args.thumbnailStorageId, args.ownerId) : null;
    if (args.screenStorageId ? args.verifiedScreenSize === undefined || !Number.isFinite(args.verifiedScreenSize) || args.verifiedScreenSize <= 0 : args.verifiedScreenSize !== undefined) {
      throw new Error("Screen layer upload is incomplete");
    }
    if (args.cameraStorageId ? args.verifiedCameraSize === undefined || !Number.isFinite(args.verifiedCameraSize) || args.verifiedCameraSize <= 0 : args.verifiedCameraSize !== undefined) {
      throw new Error("Camera layer upload is incomplete");
    }
    const audioSize = args.verifiedAudioSize;
    const canTranscribe = !!audioUpload && audioSize !== undefined && transcriptionConfigured() && audioSize < TRANSCRIPTION_LIMIT;
    const status = !audioUpload ? "none" : (audioSize || 0) >= TRANSCRIPTION_LIMIT ? "too_large" : canTranscribe ? "pending" : "none";
    const now = Date.now();
    const videoId = await ctx.db.insert("videos", {
      ownerId: args.ownerId, ownerName: args.ownerName, ownerEmail: args.ownerEmail, ownerImage: args.ownerImage,
      title: args.title.trim().slice(0, 200) || "Untitled recording", storageId: args.storageId,
      screenStorageId: args.screenStorageId, screenSizeBytes: args.verifiedScreenSize,
      cameraStorageId: args.cameraStorageId, cameraSizeBytes: args.verifiedCameraSize,
      audioStorageId: args.audioStorageId, audioSizeBytes: audioSize,
      thumbnailStorageId: args.thumbnailStorageId, durationMs: args.durationMs, width: args.width, height: args.height,
      mode: args.mode, mimeType: args.mimeType, sizeBytes: args.verifiedVideoSize,
      visibility: "private", allowComments: true, allowReactions: true, allowDownload: false,
      transcriptStatus: status, viewCount: 0, editRevision: 0, createdAt: now, updatedAt: now,
    });
    for (const upload of [videoUpload, screenUpload, cameraUpload, audioUpload, thumbnailUpload]) if (upload) await ctx.db.delete(upload._id);
    if (canTranscribe) await ctx.scheduler.runAfter(0, internal.videoTranscription.start, { videoId });
    return { videoId };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("videos").withIndex("by_owner", (q) => q.eq("ownerId", user.ownerId)).collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(rows.map(card));
  },
});

export const get = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const { video } = await owned(ctx, videoId);
    const transcript = await ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", videoId)).first();
    const { passwordHash, passwordSalt, ownerEmail, screenStorageId, cameraStorageId, finishedRenditionStorageId, ...safe } = video;
    void passwordHash; void passwordSalt; void ownerEmail;
    const currentRendition = currentFinishedRendition(video);
    return {
      ...safe,
      hasPassword: !!video.passwordHash,
      editRevision: video.editRevision ?? 0,
      url: await r2.getUrl(video.storageId, { expiresIn: URL_EXPIRY }),
      screenUrl: screenStorageId ? await r2.getUrl(screenStorageId, { expiresIn: URL_EXPIRY }) : null,
      cameraUrl: cameraStorageId ? await r2.getUrl(cameraStorageId, { expiresIn: URL_EXPIRY }) : null,
      thumbnailUrl: video.thumbnailStorageId ? await r2.getUrl(video.thumbnailStorageId, { expiresIn: URL_EXPIRY }) : null,
      finishedRendition: video.finishedRenditionStatus || finishedRenditionStorageId ? {
        status: video.finishedRenditionStatus,
        editRevision: video.finishedRenditionRevision,
        current: !!currentRendition,
        durationMs: video.finishedRenditionDurationMs,
        mimeType: video.finishedRenditionMimeType,
        sizeBytes: video.finishedRenditionSizeBytes,
        error: video.finishedRenditionError,
        updatedAt: video.finishedRenditionUpdatedAt,
        url: currentRendition ? await r2.getUrl(currentRendition.storageId, { expiresIn: URL_EXPIRY }) : null,
      } : null,
      transcript: transcript ? { fullText: transcript.fullText, segments: transcript.segments } : null,
    };
  },
});

export const update = mutation({
  args: {
    videoId: v.id("videos"), title: v.optional(v.string()), description: v.optional(v.string()),
    cta: v.optional(v.union(v.object({ label: v.string(), url: v.string() }), v.null())),
    allowComments: v.optional(v.boolean()), allowReactions: v.optional(v.boolean()), allowDownload: v.optional(v.boolean()),
    zoomEffects: v.optional(v.array(zoomEffect)),
  },
  handler: async (ctx, args) => {
    const { video } = await owned(ctx, args.videoId);
    const { videoId, cta, ...values } = args;
    const patch: Partial<Doc<"videos">> = { updatedAt: Date.now() };
    let staleRenditionKey: string | undefined;
    if (values.title !== undefined) patch.title = values.title.trim().slice(0, 200) || "Untitled recording";
    if (values.description !== undefined) patch.description = values.description.trim().slice(0, 5000) || undefined;
    if (values.allowComments !== undefined) patch.allowComments = values.allowComments;
    if (values.allowReactions !== undefined) patch.allowReactions = values.allowReactions;
    if (values.allowDownload !== undefined) patch.allowDownload = values.allowDownload;
    if (values.zoomEffects !== undefined) {
      patch.zoomEffects = normalizeZoomEffects(video, values.zoomEffects);
      patch.editRevision = (video.editRevision ?? 0) + 1;
      Object.assign(patch, clearFinishedRenditionFields());
      staleRenditionKey = video.finishedRenditionStorageId;
    }
    if (cta !== undefined) {
      if (cta === null || !cta.label.trim()) patch.cta = undefined;
      else {
        const url = new URL(cta.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("CTA must use http or https");
        patch.cta = { label: cta.label.trim().slice(0, 80), url: url.toString() };
      }
    }
    await ctx.db.patch(videoId, patch);
    await deleteObjectQuietly(ctx, staleRenditionKey);
  },
});

export const saveEdits = mutation({
  args: { videoId: v.id("videos"), editState },
  handler: async (ctx, { videoId, editState: requested }) => {
    const { video } = await owned(ctx, videoId);
    const normalized = normalizeEditState(requested, video.durationMs);
    const editRevision = (video.editRevision ?? 0) + 1;
    await ctx.db.patch(videoId, {
      editState: normalized,
      editRevision,
      updatedAt: Date.now(),
      ...clearFinishedRenditionFields(),
    });
    await deleteObjectQuietly(ctx, video.finishedRenditionStorageId);
    return { editState: normalized, editRevision };
  },
});

/**
 * Preferred editor persistence API. It versions every rendering-affecting
 * field together so a rendition can never be current for only half a project.
 */
export const saveEditorProject = mutation({
  args: { videoId: v.id("videos"), editState, zoomEffects: v.array(zoomEffect) },
  handler: async (ctx, { videoId, editState: requested, zoomEffects: requestedZooms }) => {
    const { video } = await owned(ctx, videoId);
    const normalized = normalizeEditState(requested, video.durationMs);
    const zoomEffects = normalizeZoomEffects(video, requestedZooms);
    const editRevision = (video.editRevision ?? 0) + 1;
    await ctx.db.patch(videoId, {
      editState: normalized,
      zoomEffects,
      editRevision,
      updatedAt: Date.now(),
      ...clearFinishedRenditionFields(),
    });
    await deleteObjectQuietly(ctx, video.finishedRenditionStorageId);
    return { editState: normalized, zoomEffects, editRevision };
  },
});

export const beginFinishedRendition = mutation({
  args: { videoId: v.id("videos"), editRevision: v.number() },
  handler: async (ctx, { videoId, editRevision }) => {
    const { video } = await owned(ctx, videoId);
    const currentRevision = video.editRevision ?? 0;
    if (!Number.isInteger(editRevision) || editRevision !== currentRevision) throw new Error("The video changed before rendering began");
    await ctx.db.patch(videoId, {
      finishedRenditionRevision: editRevision,
      finishedRenditionStatus: "rendering",
      finishedRenditionError: undefined,
      finishedRenditionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { editRevision };
  },
});

export const failFinishedRendition = mutation({
  args: { videoId: v.id("videos"), editRevision: v.number(), message: v.string() },
  handler: async (ctx, { videoId, editRevision, message }) => {
    const { video } = await owned(ctx, videoId);
    if (
      !Number.isInteger(editRevision) ||
      editRevision !== (video.editRevision ?? 0) ||
      editRevision !== video.finishedRenditionRevision
    ) throw new Error("The video changed while the rendition was rendering");
    await ctx.db.patch(videoId, {
      finishedRenditionStatus: "error",
      finishedRenditionError: message.trim().slice(0, 500) || "Rendition failed",
      finishedRenditionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const removeFinishedRendition = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const { video } = await owned(ctx, videoId);
    await ctx.db.patch(videoId, { ...clearFinishedRenditionFields(), updatedAt: Date.now() });
    await deleteObjectQuietly(ctx, video.finishedRenditionStorageId);
  },
});

export const assertFinishedRenditionOwner = internalQuery({
  args: { videoId: v.id("videos"), ownerId: v.string(), editRevision: v.number() },
  handler: async (ctx, { videoId, ownerId, editRevision }) => {
    const video = await ctx.db.get(videoId);
    if (!video || video.ownerId !== ownerId) throw new Error("Not authorized");
    if (!Number.isInteger(editRevision) || editRevision !== (video.editRevision ?? 0)) throw new Error("The video changed while the rendition was rendering");
    return { durationMs: video.durationMs };
  },
});

export const finalizeFinishedRendition = internalMutation({
  args: {
    videoId: v.id("videos"),
    storageId: v.string(),
    ownerId: v.string(),
    editRevision: v.number(),
    durationMs: v.number(),
    verifiedSizeBytes: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    if (!Number.isInteger(args.editRevision) || args.editRevision !== (video.editRevision ?? 0)) throw new Error("The video changed while the rendition was rendering");
    if (!Number.isFinite(args.durationMs) || args.durationMs <= 0 || args.durationMs > video.durationMs) throw new Error("Finished rendition duration is invalid");
    if (!Number.isFinite(args.verifiedSizeBytes) || args.verifiedSizeBytes <= 0) throw new Error("Finished rendition upload is incomplete");
    if (!["video/webm", "video/mp4"].some((type) => args.mimeType.startsWith(type))) throw new Error("Finished rendition must be an MP4 or WebM video");
    const upload = await pendingUpload(ctx, args.storageId, args.ownerId);
    const previousStorageId = video.finishedRenditionStorageId;
    await ctx.db.patch(args.videoId, {
      finishedRenditionStorageId: args.storageId,
      finishedRenditionSizeBytes: args.verifiedSizeBytes,
      finishedRenditionMimeType: args.mimeType.slice(0, 200),
      finishedRenditionDurationMs: args.durationMs,
      finishedRenditionRevision: args.editRevision,
      finishedRenditionStatus: "ready",
      finishedRenditionError: undefined,
      finishedRenditionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.delete(upload._id);
    if (previousStorageId && previousStorageId !== args.storageId) await deleteObjectQuietly(ctx, previousStorageId);
    return {
      editRevision: args.editRevision,
      sizeBytes: args.verifiedSizeBytes,
      mimeType: args.mimeType.slice(0, 200),
      durationMs: args.durationMs,
    };
  },
});

export const remove = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const { video } = await owned(ctx, videoId);
    for (const key of [video.storageId, video.screenStorageId, video.cameraStorageId, video.audioStorageId, video.thumbnailStorageId, video.finishedRenditionStorageId]) {
      if (!key) continue;
      try { await r2.deleteObject(ctx, key); } catch { /* already removed */ }
    }
    const graphicAssets = await ctx.db.query("videoAssets").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    for (const asset of graphicAssets) {
      try { await r2.deleteObject(ctx, asset.storageId); } catch { /* already removed */ }
      await ctx.db.delete(asset._id);
    }
    for (const table of ["videoTranscripts", "videoComments", "videoReactions", "videoViews", "videoShareSessions"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    const shareLinks = await ctx.db.query("videoShareLinks").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    for (const link of shareLinks) {
      const reviewRequests = await ctx.db.query("videoReviewRequests").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).collect();
      for (const request of reviewRequests) await ctx.db.delete(request._id);
      const sessions = await ctx.db.query("videoShareLinkSessions").withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id)).collect();
      for (const session of sessions) await ctx.db.delete(session._id);
      await ctx.db.delete(link._id);
    }
    const interactive = await ctx.db.query("videoInteractiveElements").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    for (const element of interactive) {
      const events = await ctx.db.query("videoInteractionEvents").withIndex("by_element", (q) => q.eq("elementId", element._id)).collect();
      for (const event of events) await ctx.db.delete(event._id);
      await ctx.db.delete(element._id);
    }
    for (const table of ["videoOrganization", "videoCaptionTracks", "videoDocuments", "videoTaskProposals", "videoTasks"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    const mediaJobs = await ctx.db.query("mediaJobs").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    for (const job of mediaJobs) {
      if (job.outputStorageId) {
        try { await r2.deleteObject(ctx, job.outputStorageId); } catch { /* already removed */ }
      }
      await ctx.db.delete(job._id);
    }
    const socialJobs = await ctx.db.query("socialPublishJobs").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    for (const job of socialJobs) await ctx.db.delete(job._id);
    await ctx.db.delete(videoId);
  },
});

export const analytics = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const views = await ctx.db.query("videoViews").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const totalViews = views.length;
    const completed = views.filter((view) => view.completed).length;
    return {
      totalViews,
      uniqueViewers: totalViews,
      completionRate: totalViews ? Math.round(completed / totalViews * 100) : 0,
      avgPercentWatched: totalViews ? Math.round(views.reduce((sum, view) => sum + view.percentWatched, 0) / totalViews) : 0,
      recent: [...views].sort((a, b) => b.lastAt - a.lastAt).slice(0, 25).map((view) => ({
        _id: view._id, percentWatched: view.percentWatched, completed: view.completed,
        lastAt: view.lastAt, userAgent: view.userAgent,
      })),
    };
  },
});

export const ownerComments = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const comments = await ctx.db.query("videoComments").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    comments.sort((a, b) => a.createdAt - b.createdAt);
    return comments.map((comment) => ({
      _id: comment._id, bodyHtml: comment.bodyHtml, timestampMs: comment.timestampMs,
      createdAt: comment.createdAt, authorName: comment.guestName, authorImage: undefined, isGuest: true,
      taskId: comment.taskId, resolvedAt: comment.resolvedAt,
    }));
  },
});

export const ownerReactions = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await owned(ctx, videoId);
    const rows = await ctx.db.query("videoReactions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return rows
      .filter((row) => row.timestampMs !== undefined)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
      .map((row) => ({ _id: row._id, emoji: row.emoji, timestampMs: row.timestampMs!, createdAt: row.createdAt }));
  },
});

export const replaceThumbnail = internalMutation({
  args: { videoId: v.id("videos"), storageId: v.string(), ownerId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.ownerId !== args.ownerId) throw new Error("Not authorized");
    const upload = await pendingUpload(ctx, args.storageId, args.ownerId);
    const previousStorageId = video.thumbnailStorageId;
    await ctx.db.patch(args.videoId, { thumbnailStorageId: args.storageId, updatedAt: Date.now() });
    await ctx.db.delete(upload._id);
    if (previousStorageId && previousStorageId !== args.storageId) {
      try { await r2.deleteObject(ctx, previousStorageId); } catch { /* old thumbnail may already be gone */ }
    }
  },
});

export const setTranscriptStatus = internalMutation({
  args: { videoId: v.id("videos"), status: v.union(v.literal("none"), v.literal("pending"), v.literal("done"), v.literal("error"), v.literal("too_large")) },
  handler: async (ctx, args) => { await ctx.db.patch(args.videoId, { transcriptStatus: args.status }); },
});

export const saveTranscript = internalMutation({
  args: { videoId: v.id("videos"), language: v.optional(v.string()), fullText: v.string(), segments: v.array(v.object({ start: v.number(), end: v.number(), text: v.string() })) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("videoTranscripts").withIndex("by_video", (q) => q.eq("videoId", args.videoId)).collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("videoTranscripts", { ...args, createdAt: Date.now() });
    await ctx.db.patch(args.videoId, { transcriptStatus: "done" });
  },
});

export const getAudioUrl = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const video = await ctx.db.get(videoId);
    if (!video?.audioStorageId || (video.audioSizeBytes || 0) >= TRANSCRIPTION_LIMIT) return null;
    return {
      url: await r2.getUrl(video.audioStorageId, { expiresIn: 30 * 60 }),
      durationMs: video.durationMs,
    };
  },
});
