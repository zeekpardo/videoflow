import { normalizeVideoEditState, type VideoEditState } from "@/lib/video-edits";
import { MAX_GRAPHIC_ASSETS_PER_VIDEO, normalizeGraphicAssetId, normalizeGraphicAssetMetadata } from "@/lib/graphic-assets";
import { isSupportedVideoContainer } from "@/lib/media-format";

export interface LocalVideoView {
  viewerKey: string;
  startedAt: number;
  lastAt: number;
  maxPositionMs: number;
  percentWatched: number;
  completed: boolean;
}

export interface LocalVideoComment {
  id: string;
  guestName: string;
  body: string;
  timestampMs?: number;
  createdAt: number;
}

export interface LocalVideoReaction {
  viewerKey: string;
  emoji: string;
  timestampMs?: number;
  createdAt: number;
}

export interface LocalVideoZoomEffect {
  id: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  scale: number;
}

export type LocalFinishedRenditionStatus = "rendering" | "ready" | "error";

export interface CurrentLocalFinishedRendition {
  blob: Blob;
  editRevision: number;
  durationMs: number;
  mimeType: string;
}

export interface LocalVideoGraphicAsset {
  videoId: string;
  assetId: string;
  blob: Blob;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

interface LocalVideoGraphicAssetRow extends LocalVideoGraphicAsset {
  key: string;
}

export interface LocalVideo {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  durationMs: number;
  mode: "screen" | "screen_camera" | "camera";
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  videoBlob: Blob;
  /** Optional raw layers retained by new screen + camera recordings. */
  screenBlob?: Blob;
  cameraBlob?: Blob;
  thumbnailBlob?: Blob;
  zoomEffects?: LocalVideoZoomEffect[];
  editState?: VideoEditState;
  /** Revision of every rendering-affecting edit saved in this browser. */
  editRevision?: number;
  /** Optional flattened output. It is usable only when its revision is current. */
  finishedRenditionBlob?: Blob;
  finishedRenditionRevision?: number;
  finishedRenditionStatus?: LocalFinishedRenditionStatus;
  finishedRenditionDurationMs?: number;
  finishedRenditionMimeType?: string;
  finishedRenditionError?: string;
  finishedRenditionUpdatedAt?: number;
  shareToken?: string;
  sharedAt?: number;
  allowComments?: boolean;
  allowReactions?: boolean;
  allowDownload?: boolean;
  cta?: { label: string; url: string };
  passwordHash?: string;
  passwordSalt?: string;
  views?: LocalVideoView[];
  comments?: LocalVideoComment[];
  reactions?: LocalVideoReaction[];
}

const DATABASE = "videoflow-local-test";
const STORE = "videos";
const GRAPHIC_ASSET_STORE = "graphicAssets";
const GRAPHIC_ASSET_VIDEO_INDEX = "by_video";
const VERSION = 2;

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("Local browser storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      const assetStore = request.result.objectStoreNames.contains(GRAPHIC_ASSET_STORE)
        ? request.transaction!.objectStore(GRAPHIC_ASSET_STORE)
        : request.result.createObjectStore(GRAPHIC_ASSET_STORE, { keyPath: "key" });
      if (!assetStore.indexNames.contains(GRAPHIC_ASSET_VIDEO_INDEX)) assetStore.createIndex(GRAPHIC_ASSET_VIDEO_INDEX, "videoId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local video storage"));
  });
}

async function request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const operationRequest = operation(tx.objectStore(STORE));
    operationRequest.onsuccess = () => resolve(operationRequest.result);
    operationRequest.onerror = () => reject(operationRequest.error || new Error("Local video operation failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error("Local video transaction failed"));
  });
}

async function graphicAssetRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GRAPHIC_ASSET_STORE, mode);
    const operationRequest = operation(tx.objectStore(GRAPHIC_ASSET_STORE));
    operationRequest.onsuccess = () => resolve(operationRequest.result);
    operationRequest.onerror = () => reject(operationRequest.error || new Error("Local graphic asset operation failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error("Local graphic asset transaction failed"));
  });
}

function normalized(video: LocalVideo): LocalVideo {
  let cta: LocalVideo["cta"];
  if (video.cta?.label.trim() && video.cta.url.trim()) {
    try {
      const url = new URL(video.cta.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        cta = { label: video.cta.label.trim().slice(0, 80), url: url.toString() };
      }
    } catch {
      // Imported or legacy local projects cannot inject unsafe CTA schemes.
    }
  }
  const editRevision = Number.isInteger(video.editRevision) && (video.editRevision ?? 0) >= 0
    ? video.editRevision!
    : 0;
  const finishedRenditionRevision = Number.isInteger(video.finishedRenditionRevision) && (video.finishedRenditionRevision ?? -1) >= 0
    ? video.finishedRenditionRevision
    : undefined;
  const finishedRenditionDurationMs = typeof video.finishedRenditionDurationMs === "number" && Number.isFinite(video.finishedRenditionDurationMs)
    ? Math.min(video.durationMs, Math.max(1, video.finishedRenditionDurationMs))
    : undefined;
  const finishedBlobMimeType = video.finishedRenditionBlob?.type;
  const finishedRenditionMimeType = isSupportedVideoContainer(finishedBlobMimeType)
    ? finishedBlobMimeType
    : isSupportedVideoContainer(video.finishedRenditionMimeType)
      ? video.finishedRenditionMimeType
      : undefined;
  const hasReadyRendition = !!video.finishedRenditionBlob?.size && finishedRenditionRevision !== undefined && !!finishedRenditionDurationMs && !!finishedRenditionMimeType;
  const requestedStatus = video.finishedRenditionStatus;
  const finishedRenditionStatus = requestedStatus === "rendering" || requestedStatus === "error"
    ? requestedStatus
    : hasReadyRendition
      ? "ready" as const
      : undefined;

  return {
    ...video,
    cta,
    editRevision,
    finishedRenditionRevision,
    finishedRenditionStatus,
    finishedRenditionDurationMs,
    finishedRenditionMimeType,
    finishedRenditionError: finishedRenditionStatus === "error" ? video.finishedRenditionError?.trim().slice(0, 500) : undefined,
    allowComments: video.allowComments ?? true,
    allowReactions: video.allowReactions ?? true,
    allowDownload: video.allowDownload ?? false,
    views: video.views ?? [],
    comments: video.comments ?? [],
    reactions: video.reactions ?? [],
    zoomEffects: video.zoomEffects ?? [],
    editState: normalizeVideoEditState(video.editState, video.durationMs, !!video.screenBlob && !!video.cameraBlob),
  };
}

export async function listLocalVideos(): Promise<LocalVideo[]> {
  const rows = await request<LocalVideo[]>("readonly", (store) => store.getAll());
  return rows.map(normalized).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLocalVideo(id: string): Promise<LocalVideo | null> {
  const row = await request<LocalVideo | undefined>("readonly", (store) => store.get(id));
  return row ? normalized(row) : null;
}

export async function getLocalVideoByShareToken(token: string): Promise<LocalVideo | null> {
  const rows = await listLocalVideos();
  return rows.find((video) => video.shareToken === token) ?? null;
}

export async function saveLocalVideo(video: LocalVideo): Promise<void> {
  await request<IDBValidKey>("readwrite", (store) => store.put(normalized(video)));
}

async function mutateLocalVideo(id: string, create: (video: LocalVideo) => LocalVideo): Promise<LocalVideo> {
  const db = await database();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getRequest = store.get(id) as IDBRequest<LocalVideo | undefined>;
    let updated: LocalVideo | undefined;
    let failure: Error | DOMException | null = null;

    const closeAndReject = () => {
      db.close();
      reject(failure || tx.error || new Error("Local video transaction failed"));
    };

    getRequest.onerror = () => {
      failure = getRequest.error || new Error("Local video operation failed");
    };
    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        failure = new Error("Local video not found");
        tx.abort();
        return;
      }

      try {
        const video = normalized(getRequest.result);
        updated = normalized({ ...create(video), id: video.id, videoBlob: video.videoBlob });
        const putRequest = store.put(updated);
        putRequest.onerror = () => {
          failure = putRequest.error || new Error("Local video operation failed");
        };
      } catch (error) {
        failure = error instanceof Error || error instanceof DOMException
          ? error
          : new Error("Local video operation failed");
        tx.abort();
      }
    };

    tx.oncomplete = () => {
      db.close();
      if (!updated) {
        reject(new Error("Local video operation failed"));
        return;
      }
      resolve(updated);
    };
    tx.onerror = closeAndReject;
    tx.onabort = closeAndReject;
  });
}

function clearsFinishedRendition() {
  return {
    finishedRenditionBlob: undefined,
    finishedRenditionRevision: undefined,
    finishedRenditionStatus: undefined,
    finishedRenditionDurationMs: undefined,
    finishedRenditionMimeType: undefined,
    finishedRenditionError: undefined,
    finishedRenditionUpdatedAt: undefined,
  } satisfies Partial<LocalVideo>;
}

export async function patchLocalVideo(id: string, patch: Partial<LocalVideo>): Promise<LocalVideo> {
  const changesRendering = Object.prototype.hasOwnProperty.call(patch, "editState") || Object.prototype.hasOwnProperty.call(patch, "zoomEffects");
  return mutateLocalVideo(id, (video) => ({
    ...video,
    ...patch,
    ...(changesRendering ? {
      editRevision: (video.editRevision ?? 0) + 1,
      ...clearsFinishedRendition(),
    } : {}),
  }));
}

/** Atomically saves the editor project and advances the rendition revision once. */
export async function saveLocalEditorProject(
  id: string,
  project: Pick<LocalVideo, "editState" | "zoomEffects">
): Promise<LocalVideo> {
  return patchLocalVideo(id, project);
}

export function currentLocalFinishedRendition(video: LocalVideo): CurrentLocalFinishedRendition | null {
  const current = normalized(video);
  if (
    current.finishedRenditionStatus !== "ready" ||
    !current.finishedRenditionBlob?.size ||
    current.finishedRenditionRevision === undefined ||
    current.finishedRenditionRevision !== current.editRevision ||
    !current.finishedRenditionDurationMs ||
    !current.finishedRenditionMimeType
  ) return null;
  return {
    blob: current.finishedRenditionBlob,
    editRevision: current.finishedRenditionRevision,
    durationMs: current.finishedRenditionDurationMs,
    mimeType: current.finishedRenditionMimeType,
  };
}

export async function beginLocalFinishedRendition(id: string, editRevision: number): Promise<LocalVideo> {
  return mutateLocalVideo(id, (video) => {
    if (!Number.isInteger(editRevision) || editRevision !== video.editRevision) throw new Error("The video changed before rendering began");
    return {
      ...video,
      finishedRenditionRevision: editRevision,
      finishedRenditionStatus: "rendering",
      finishedRenditionError: undefined,
      finishedRenditionUpdatedAt: Date.now(),
    };
  });
}

export async function finalizeLocalFinishedRendition(
  id: string,
  input: { blob: Blob; editRevision: number; durationMs: number }
): Promise<LocalVideo> {
  if (!input.blob.size || !isSupportedVideoContainer(input.blob.type)) throw new Error("Finished rendition must be an MP4 or WebM video");
  return mutateLocalVideo(id, (video) => {
    if (!Number.isInteger(input.editRevision) || input.editRevision !== video.editRevision) throw new Error("The video changed while the rendition was rendering");
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0 || input.durationMs > video.durationMs) throw new Error("Finished rendition duration is invalid");
    return {
      ...video,
      finishedRenditionBlob: input.blob,
      finishedRenditionRevision: input.editRevision,
      finishedRenditionStatus: "ready",
      finishedRenditionDurationMs: input.durationMs,
      finishedRenditionMimeType: input.blob.type,
      finishedRenditionError: undefined,
      finishedRenditionUpdatedAt: Date.now(),
    };
  });
}

export async function failLocalFinishedRendition(id: string, editRevision: number, message: string): Promise<LocalVideo> {
  return mutateLocalVideo(id, (video) => {
    if (!Number.isInteger(editRevision) || editRevision !== video.editRevision || video.finishedRenditionRevision !== editRevision) {
      throw new Error("The video changed while the rendition was rendering");
    }
    return {
      ...video,
      finishedRenditionStatus: "error",
      finishedRenditionError: message.trim().slice(0, 500) || "Rendition failed",
      finishedRenditionUpdatedAt: Date.now(),
    };
  });
}

export async function removeLocalFinishedRendition(id: string): Promise<LocalVideo> {
  return mutateLocalVideo(id, (video) => ({ ...video, ...clearsFinishedRendition() }));
}

export async function enableLocalShare(id: string): Promise<LocalVideo> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return patchLocalVideo(id, { shareToken: token, sharedAt: Date.now() });
}

export async function disableLocalShare(id: string): Promise<LocalVideo> {
  return patchLocalVideo(id, { shareToken: undefined, sharedAt: undefined });
}

export async function recordLocalView(token: string, viewerKey: string): Promise<LocalVideo | null> {
  const video = await getLocalVideoByShareToken(token);
  if (!video) return null;
  const views = [...(video.views ?? [])];
  const existing = views.find((view) => view.viewerKey === viewerKey);
  if (existing) existing.lastAt = Date.now();
  else views.push({ viewerKey, startedAt: Date.now(), lastAt: Date.now(), maxPositionMs: 0, percentWatched: 0, completed: false });
  return patchLocalVideo(video.id, { views });
}

export async function updateLocalViewProgress(token: string, viewerKey: string, positionMs: number): Promise<void> {
  const video = await getLocalVideoByShareToken(token);
  if (!video) return;
  const views = [...(video.views ?? [])];
  const view = views.find((row) => row.viewerKey === viewerKey);
  if (!view) return;
  const durationMs = currentLocalFinishedRendition(video)?.durationMs ?? video.durationMs;
  const safePositionMs = Number.isFinite(positionMs) ? positionMs : 0;
  view.maxPositionMs = Math.min(durationMs, Math.max(view.maxPositionMs, Math.min(durationMs, Math.max(0, safePositionMs))));
  view.percentWatched = durationMs ? Math.min(100, Math.round(view.maxPositionMs / durationMs * 100)) : 0;
  view.completed = view.completed || view.percentWatched >= 90;
  view.lastAt = Date.now();
  await patchLocalVideo(video.id, { views });
}

export async function addLocalReaction(token: string, viewerKey: string, emoji: string, timestampMs?: number): Promise<LocalVideo> {
  const video = await getLocalVideoByShareToken(token);
  if (!video || !video.allowReactions) throw new Error("Reactions are disabled");
  const reactions = [...(video.reactions ?? [])];
  if (!reactions.some((reaction) => reaction.viewerKey === viewerKey && reaction.emoji === emoji)) {
    reactions.push({
      viewerKey,
      emoji,
      timestampMs: timestampMs === undefined ? undefined : Math.min(video.durationMs, Math.max(0, timestampMs)),
      createdAt: Date.now(),
    });
  }
  return patchLocalVideo(video.id, { reactions });
}

export async function addLocalComment(token: string, guestName: string, body: string, timestampMs?: number): Promise<LocalVideo> {
  const video = await getLocalVideoByShareToken(token);
  if (!video || !video.allowComments) throw new Error("Comments are disabled");
  const safeName = guestName.trim().slice(0, 120);
  const safeBody = body.trim().slice(0, 5000);
  if (!safeName || !safeBody) throw new Error("Enter your name and comment");
  const comments = [...(video.comments ?? []), {
    id: crypto.randomUUID(),
    guestName: safeName,
    body: safeBody,
    timestampMs: timestampMs === undefined ? undefined : Math.min(video.durationMs, Math.max(0, timestampMs)),
    createdAt: Date.now(),
  }];
  return patchLocalVideo(video.id, { comments });
}

function localGraphicAssetKey(videoId: string, assetId: string) {
  return `${videoId}:${assetId}`;
}

function localGraphicAsset(row: LocalVideoGraphicAssetRow): LocalVideoGraphicAsset {
  const { key, ...asset } = row;
  void key;
  return asset;
}

export async function saveLocalGraphicAsset(
  videoId: string,
  input: { assetId: string; blob: Blob; width: number; height: number }
): Promise<LocalVideoGraphicAsset> {
  if (!await getLocalVideo(videoId)) throw new Error("Local video not found");
  const metadata = normalizeGraphicAssetMetadata({
    assetId: input.assetId,
    mimeType: input.blob.type,
    sizeBytes: input.blob.size,
    width: input.width,
    height: input.height,
  });
  const key = localGraphicAssetKey(videoId, metadata.assetId);
  const existing = await graphicAssetRequest<LocalVideoGraphicAssetRow | undefined>("readonly", (store) => store.get(key));
  if (!existing && (await listLocalGraphicAssets(videoId)).length >= MAX_GRAPHIC_ASSETS_PER_VIDEO) {
    throw new Error(`A video can have up to ${MAX_GRAPHIC_ASSETS_PER_VIDEO} graphic assets`);
  }
  const now = Date.now();
  const row: LocalVideoGraphicAssetRow = {
    key,
    videoId,
    assetId: metadata.assetId,
    blob: input.blob,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    width: metadata.width,
    height: metadata.height,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await graphicAssetRequest<IDBValidKey>("readwrite", (store) => store.put(row));
  return localGraphicAsset(row);
}

export async function listLocalGraphicAssets(videoId: string): Promise<LocalVideoGraphicAsset[]> {
  const rows = await graphicAssetRequest<LocalVideoGraphicAssetRow[]>("readonly", (store) => store.index(GRAPHIC_ASSET_VIDEO_INDEX).getAll(videoId));
  return rows.map(localGraphicAsset).sort((a, b) => a.createdAt - b.createdAt || a.assetId.localeCompare(b.assetId));
}

export async function getLocalGraphicAsset(videoId: string, requestedId: string): Promise<LocalVideoGraphicAsset | null> {
  const assetId = normalizeGraphicAssetId(requestedId);
  const row = await graphicAssetRequest<LocalVideoGraphicAssetRow | undefined>("readonly", (store) => store.get(localGraphicAssetKey(videoId, assetId)));
  return row ? localGraphicAsset(row) : null;
}

export async function deleteLocalGraphicAsset(videoId: string, requestedId: string): Promise<void> {
  const assetId = normalizeGraphicAssetId(requestedId);
  await graphicAssetRequest<undefined>("readwrite", (store) => store.delete(localGraphicAssetKey(videoId, assetId)));
}

export async function deleteLocalVideo(id: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, GRAPHIC_ASSET_STORE], "readwrite");
    tx.objectStore(STORE).delete(id);
    const cursorRequest = tx.objectStore(GRAPHIC_ASSET_STORE).index(GRAPHIC_ASSET_VIDEO_INDEX).openCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error("Could not delete local graphic assets"));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not delete local video")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Could not delete local video")); };
  });
}

export async function clearLocalVideos(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, GRAPHIC_ASSET_STORE], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(GRAPHIC_ASSET_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not clear local video storage")); };
  });
}
