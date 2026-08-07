import {
  defaultVideoEditState,
  normalizeVideoEditState,
  type VideoEditState,
  type VideoEditStateV2,
  type VideoZoomEffect,
} from "@/lib/video-edits";
import {
  MAX_GRAPHIC_ASSETS_PER_VIDEO,
  normalizeGraphicAssetId,
  normalizeGraphicAssetMetadata,
  referencedGraphicAssetIds,
} from "@/lib/graphic-assets";
import { demoConfig } from "@/lib/config";
import type { VideoCaptionTrack } from "@/lib/video-v2";

export const DEMO_MEDIA_DATABASE = "videoflow-sales-demo";
export const DEMO_MEDIA_SESSION_STORAGE_KEY = "videoflow-sales-demo:session";
export const DEMO_MEDIA_STORAGE_PREFIX = "videoflow-sales-demo:";

const DATABASE_VERSION = 1;
const VIDEO_STORE = "videos";
const GRAPHIC_STORE = "graphicAssets";
const GRAPHIC_VIDEO_INDEX = "by_video";
const MAX_TIMER_MS = 2_147_000_000;

export interface DemoVideo {
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
  screenBlob?: Blob;
  cameraBlob?: Blob;
  thumbnailBlob?: Blob;
  zoomEffects: VideoZoomEffect[];
  editState: VideoEditStateV2;
  editRevision: number;
  captionTrack?: VideoCaptionTrack;
  interactiveElements?: DemoInteractiveElement[];
  templateName?: string;
  generatedDocuments?: Array<{ id: string; title: string; body: string; createdAt?: number; visuals?: Array<{ timestampMs: number; caption: string; image: Blob }> }>;
  demoPublishStatus?: "queued" | "processing" | "ready";
}

export interface DemoInteractiveElement {
  id: string;
  kind: "chapter" | "hotspot" | "cta" | "poll";
  startMs: number;
  endMs: number;
  label: string;
  url?: string;
  options?: string[];
}

export type NewDemoVideo = Omit<DemoVideo, "zoomEffects" | "editState" | "editRevision"> & {
  zoomEffects?: VideoZoomEffect[];
  editState?: VideoEditState;
  editRevision?: number;
};

export interface DemoGraphicAsset {
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

export interface OpenDemoMediaStoreOptions {
  sessionId: string;
  expiresAt: number;
  onExpired?: () => void;
}

export interface DemoMediaStore {
  readonly sessionId: string;
  readonly expiresAt: number;
  listVideos(): Promise<DemoVideo[]>;
  getVideo(id: string): Promise<DemoVideo | null>;
  saveVideo(video: NewDemoVideo): Promise<DemoVideo>;
  patchVideo(id: string, patch: Partial<DemoVideo>): Promise<DemoVideo>;
  saveEditorProject(id: string, project: { editState: VideoEditState; zoomEffects: VideoZoomEffect[] }): Promise<DemoVideo>;
  deleteVideo(id: string): Promise<void>;
  saveGraphicAsset(videoId: string, input: { assetId: string; blob: Blob; width: number; height: number }): Promise<DemoGraphicAsset>;
  listGraphicAssets(videoId: string): Promise<DemoGraphicAsset[]>;
  getGraphicAsset(videoId: string, assetId: string): Promise<DemoGraphicAsset | null>;
  deleteGraphicAsset(videoId: string, assetId: string): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}

interface DemoSessionRecord {
  sessionId: string;
  expiresAt: number;
}

interface DemoVideoRow extends DemoVideo, DemoSessionRecord {}

interface DemoGraphicAssetRow extends DemoGraphicAsset, DemoSessionRecord {
  key: string;
}

function browserStorage() {
  if (typeof localStorage === "undefined") throw new Error("Demo browser storage is unavailable");
  return localStorage;
}

function validateSession(sessionId: string, expiresAt: number): DemoSessionRecord {
  const normalizedId = sessionId.trim();
  if (!normalizedId || normalizedId.length > 256 || /[\u0000-\u001f\u007f]/.test(normalizedId)) throw new Error("Demo session ID is invalid");
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) throw new Error("Demo session expiration is invalid");
  return { sessionId: normalizedId, expiresAt: Math.floor(expiresAt) };
}

function readSession(): DemoSessionRecord | null {
  let parsed: unknown;
  try {
    const value = browserStorage().getItem(DEMO_MEDIA_SESSION_STORAGE_KEY);
    if (!value) return null;
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Partial<DemoSessionRecord>;
  if (typeof value.sessionId !== "string" || typeof value.expiresAt !== "number") return null;
  try { return validateSession(value.sessionId, value.expiresAt); } catch { return null; }
}

function writeSession(session: DemoSessionRecord) {
  browserStorage().setItem(DEMO_MEDIA_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearDemoLocalKeys() {
  const storage = browserStorage();
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(DEMO_MEDIA_STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("Demo browser storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEMO_MEDIA_DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(VIDEO_STORE)) request.result.createObjectStore(VIDEO_STORE, { keyPath: "id" });
      const graphicStore = request.result.objectStoreNames.contains(GRAPHIC_STORE)
        ? request.transaction!.objectStore(GRAPHIC_STORE)
        : request.result.createObjectStore(GRAPHIC_STORE, { keyPath: "key" });
      if (!graphicStore.indexNames.contains(GRAPHIC_VIDEO_INDEX)) graphicStore.createIndex(GRAPHIC_VIDEO_INDEX, "videoId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open demo media storage"));
  });
}

async function clearDemoDatabase() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([VIDEO_STORE, GRAPHIC_STORE], "readwrite");
    tx.objectStore(VIDEO_STORE).clear();
    tx.objectStore(GRAPHIC_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not clear demo media storage")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Could not clear demo media storage")); };
  });
}

export async function clearDemoMediaStorage(): Promise<void> {
  await clearDemoDatabase();
  clearDemoLocalKeys();
}

export async function clearExpiredDemoMediaStorage(now = Date.now()): Promise<boolean> {
  const hasSessionRecord = browserStorage().getItem(DEMO_MEDIA_SESSION_STORAGE_KEY) !== null;
  if (!hasSessionRecord) return false;
  const existing = readSession();
  if (existing && existing.expiresAt > now) return false;
  await clearDemoMediaStorage();
  return true;
}

async function storeRequest<T>(
  storeName: typeof VIDEO_STORE | typeof GRAPHIC_STORE,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Demo media operation failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Demo media transaction failed")); };
  });
}

function normalizedVideo(video: NewDemoVideo | DemoVideo): DemoVideo {
  const editRevision = Number.isInteger(video.editRevision) && (video.editRevision ?? 0) >= 0 ? video.editRevision! : 0;
  return {
    ...video,
    title: video.title.trim().slice(0, 200) || "Untitled recording",
    description: video.description?.trim().slice(0, 5_000) || undefined,
    zoomEffects: (video.zoomEffects ?? []).map((effect) => ({ ...effect })),
    editState: normalizeVideoEditState(
      video.editState ?? defaultVideoEditState(video.mode),
      video.durationMs,
      !!video.screenBlob && !!video.cameraBlob
    ),
    editRevision,
  };
}

function validatedVideo(video: NewDemoVideo | DemoVideo): DemoVideo {
  const normalized = normalizedVideo(video);
  if (!normalized.id.trim() || normalized.id.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized.id)) {
    throw new Error("Demo video ID is invalid");
  }
  if (!Number.isFinite(normalized.durationMs) || normalized.durationMs <= 0 || normalized.durationMs > demoConfig.maxRecordingMinutes * 60_000 + 5_000) {
    throw new Error(`Demo recordings can be up to ${demoConfig.maxRecordingMinutes} minutes`);
  }
  if (!normalized.videoBlob.size || !normalized.videoBlob.type.startsWith("video/") || normalized.videoBlob.size > demoConfig.maxVideoBytes) {
    throw new Error("Demo recording is empty, invalid, or too large");
  }
  if (normalized.sizeBytes !== normalized.videoBlob.size) throw new Error("Demo recording size does not match its media");
  for (const layer of [normalized.screenBlob, normalized.cameraBlob]) {
    if (layer && (!layer.size || !layer.type.startsWith("video/") || layer.size > demoConfig.maxVideoBytes)) {
      throw new Error("A demo source layer is empty, invalid, or too large");
    }
  }
  if (normalized.thumbnailBlob && (
    !normalized.thumbnailBlob.size
    || !["image/png", "image/jpeg", "image/webp"].includes(normalized.thumbnailBlob.type)
    || normalized.thumbnailBlob.size > 10 * 1024 * 1024
  )) throw new Error("Demo thumbnail must be a PNG, JPG, or WebP under 10 MB");
  return normalized;
}

function videoStorageBytes(video: DemoVideo) {
  return video.videoBlob.size
    + (video.screenBlob?.size ?? 0)
    + (video.cameraBlob?.size ?? 0)
    + (video.thumbnailBlob?.size ?? 0);
}

async function ensureDemoStorageCapacity(video: DemoVideo) {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== "number" || typeof estimate.usage !== "number") return;
    const available = Math.max(0, estimate.quota - estimate.usage);
    const required = Math.ceil(videoStorageBytes(video) * 1.1) + 2 * 1024 * 1024;
    if (required > available) {
      throw new Error(
        "This device does not have enough browser storage for the recording. Free some space, shorten the recording, or use the desktop demo.",
      );
    }
  } catch (error) {
    if (error instanceof Error && /does not have enough browser storage/i.test(error.message)) throw error;
    // Storage estimates are advisory and unavailable in some private modes.
  }
}

function friendlyDemoStorageError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (
    ["QuotaExceededError", "DataCloneError", "UnknownError"].includes(name)
    || /quota|blob|storage|disk/i.test(message)
  ) {
    return new Error(
      "This browser could not store the recording on this device. Try a shorter recording or use desktop Chrome or Edge.",
    );
  }
  return error instanceof Error ? error : new Error("Could not save the demo recording");
}

function videoFromRow(row: DemoVideoRow): DemoVideo {
  const { sessionId, expiresAt, ...video } = row;
  void sessionId; void expiresAt;
  return normalizedVideo(video);
}

function graphicKey(videoId: string, assetId: string) {
  return `${videoId}:${assetId}`;
}

function graphicFromRow(row: DemoGraphicAssetRow): DemoGraphicAsset {
  const { key, sessionId, expiresAt, ...asset } = row;
  void key; void sessionId; void expiresAt;
  return asset;
}

class BrowserDemoMediaStore implements DemoMediaStore {
  readonly sessionId: string;
  readonly expiresAt: number;
  private active = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onExpired?: () => void;

  constructor(session: DemoSessionRecord, onExpired?: () => void) {
    this.sessionId = session.sessionId;
    this.expiresAt = session.expiresAt;
    this.onExpired = onExpired;
    this.scheduleExpiry();
  }

  private matches(row: DemoSessionRecord) {
    return row.sessionId === this.sessionId && row.expiresAt === this.expiresAt;
  }

  private scheduleExpiry() {
    if (!this.active) return;
    const remaining = this.expiresAt - Date.now();
    if (remaining <= 0) {
      void this.expire();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.expiresAt > Date.now()) this.scheduleExpiry();
      else void this.expire();
    }, Math.min(remaining, MAX_TIMER_MS));
  }

  private async expire() {
    if (!this.active) return;
    this.active = false;
    const current = readSession();
    if (current && this.matches(current)) {
      try {
        await clearDemoMediaStorage();
      } finally {
        // Access must end even if a browser storage transaction is unavailable.
        // The next visit will make another cleanup attempt before opening media.
        this.onExpired?.();
      }
    }
  }

  private async assertActive() {
    if (!this.active) throw new Error("Demo session is no longer active");
    const current = readSession();
    if (!current || !this.matches(current)) {
      this.active = false;
      this.dispose();
      throw new Error("Demo session changed");
    }
    if (Date.now() >= this.expiresAt) {
      await this.expire();
      throw new Error("Demo session expired");
    }
  }

  private row(video: DemoVideo): DemoVideoRow {
    return { ...video, sessionId: this.sessionId, expiresAt: this.expiresAt };
  }

  async listVideos() {
    await this.assertActive();
    const rows = await storeRequest<DemoVideoRow[]>(VIDEO_STORE, "readonly", (store) => store.getAll());
    return rows.filter((row) => this.matches(row)).map(videoFromRow).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getVideo(id: string) {
    await this.assertActive();
    const row = await storeRequest<DemoVideoRow | undefined>(VIDEO_STORE, "readonly", (store) => store.get(id));
    return row && this.matches(row) ? videoFromRow(row) : null;
  }

  async saveVideo(input: NewDemoVideo) {
    await this.assertActive();
    const [existing, videos] = await Promise.all([this.getVideo(input.id), this.listVideos()]);
    if (!existing && videos.length >= demoConfig.maxVideos) {
      throw new Error(`This demo keeps up to ${demoConfig.maxVideos} videos`);
    }
    const video = validatedVideo(input);
    await ensureDemoStorageCapacity(video);
    try {
      await storeRequest<IDBValidKey>(VIDEO_STORE, "readwrite", (store) => store.put(this.row(video)));
    } catch (error) {
      throw friendlyDemoStorageError(error);
    }
    return video;
  }

  private async mutateVideo(id: string, create: (video: DemoVideo) => DemoVideo) {
    await this.assertActive();
    const db = await database();
    return new Promise<DemoVideo>((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE, "readwrite");
      const store = tx.objectStore(VIDEO_STORE);
      const getRequest = store.get(id) as IDBRequest<DemoVideoRow | undefined>;
      let updated: DemoVideo | undefined;
      let failure: Error | DOMException | null = null;
      getRequest.onerror = () => { failure = getRequest.error || new Error("Demo video operation failed"); };
      getRequest.onsuccess = () => {
        const row = getRequest.result;
        if (!row || !this.matches(row)) {
          failure = new Error("Demo video not found");
          tx.abort();
          return;
        }
        try {
          const video = videoFromRow(row);
          updated = validatedVideo({ ...create(video), id: video.id, videoBlob: video.videoBlob });
          const put = store.put(this.row(updated));
          put.onerror = () => { failure = put.error || new Error("Demo video operation failed"); };
        } catch (error) {
          failure = error instanceof Error || error instanceof DOMException ? error : new Error("Demo video operation failed");
          tx.abort();
        }
      };
      const fail = () => { db.close(); reject(failure || tx.error || new Error("Demo video transaction failed")); };
      tx.oncomplete = () => {
        db.close();
        if (updated) resolve(updated);
        else reject(new Error("Demo video operation failed"));
      };
      tx.onerror = fail;
      tx.onabort = fail;
    });
  }

  async patchVideo(id: string, patch: Partial<DemoVideo>) {
    const renderingChanged = Object.prototype.hasOwnProperty.call(patch, "editState") || Object.prototype.hasOwnProperty.call(patch, "zoomEffects");
    const updated = await this.mutateVideo(id, (video) => ({
      ...video,
      ...patch,
      ...(renderingChanged ? { editRevision: video.editRevision + 1 } : {}),
    }));
    if (renderingChanged) await this.removeUnreferencedGraphicAssets(id, updated.editState);
    return updated;
  }

  async saveEditorProject(id: string, project: { editState: VideoEditState; zoomEffects: VideoZoomEffect[] }) {
    const updated = await this.mutateVideo(id, (video) => ({
      ...video,
      editState: normalizeVideoEditState(project.editState, video.durationMs, !!video.screenBlob && !!video.cameraBlob),
      zoomEffects: project.zoomEffects.map((effect) => ({ ...effect })),
      editRevision: video.editRevision + 1,
    }));
    await this.removeUnreferencedGraphicAssets(id, updated.editState);
    return updated;
  }

  private async removeUnreferencedGraphicAssets(videoId: string, editState: VideoEditState) {
    const referenced = referencedGraphicAssetIds(editState);
    const assets = await this.listGraphicAssets(videoId);
    await Promise.all(assets.filter((asset) => !referenced.has(asset.assetId)).map((asset) => this.deleteGraphicAsset(videoId, asset.assetId)));
  }

  async deleteVideo(id: string) {
    await this.assertActive();
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([VIDEO_STORE, GRAPHIC_STORE], "readwrite");
      tx.objectStore(VIDEO_STORE).delete(id);
      const cursorRequest = tx.objectStore(GRAPHIC_STORE).index(GRAPHIC_VIDEO_INDEX).openCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const row = cursor.value as DemoGraphicAssetRow;
        if (this.matches(row)) cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error || new Error("Could not delete demo graphic assets"));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not delete demo video")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Could not delete demo video")); };
    });
  }

  async saveGraphicAsset(videoId: string, input: { assetId: string; blob: Blob; width: number; height: number }) {
    await this.assertActive();
    if (!await this.getVideo(videoId)) throw new Error("Demo video not found");
    const metadata = normalizeGraphicAssetMetadata({
      assetId: input.assetId,
      mimeType: input.blob.type,
      sizeBytes: input.blob.size,
      width: input.width,
      height: input.height,
    });
    const key = graphicKey(videoId, metadata.assetId);
    const existing = await storeRequest<DemoGraphicAssetRow | undefined>(GRAPHIC_STORE, "readonly", (store) => store.get(key));
    if ((!existing || !this.matches(existing)) && (await this.listGraphicAssets(videoId)).length >= MAX_GRAPHIC_ASSETS_PER_VIDEO) {
      throw new Error(`A video can have up to ${MAX_GRAPHIC_ASSETS_PER_VIDEO} graphic assets`);
    }
    const now = Date.now();
    const row: DemoGraphicAssetRow = {
      key,
      sessionId: this.sessionId,
      expiresAt: this.expiresAt,
      videoId,
      assetId: metadata.assetId,
      blob: input.blob,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      width: metadata.width,
      height: metadata.height,
      createdAt: existing && this.matches(existing) ? existing.createdAt : now,
      updatedAt: now,
    };
    await storeRequest<IDBValidKey>(GRAPHIC_STORE, "readwrite", (store) => store.put(row));
    return graphicFromRow(row);
  }

  async listGraphicAssets(videoId: string) {
    await this.assertActive();
    const rows = await storeRequest<DemoGraphicAssetRow[]>(GRAPHIC_STORE, "readonly", (store) => store.index(GRAPHIC_VIDEO_INDEX).getAll(videoId));
    return rows.filter((row) => this.matches(row)).map(graphicFromRow).sort((a, b) => a.createdAt - b.createdAt || a.assetId.localeCompare(b.assetId));
  }

  async getGraphicAsset(videoId: string, requestedId: string) {
    await this.assertActive();
    const assetId = normalizeGraphicAssetId(requestedId);
    const row = await storeRequest<DemoGraphicAssetRow | undefined>(GRAPHIC_STORE, "readonly", (store) => store.get(graphicKey(videoId, assetId)));
    return row && this.matches(row) ? graphicFromRow(row) : null;
  }

  async deleteGraphicAsset(videoId: string, requestedId: string) {
    await this.assertActive();
    const assetId = normalizeGraphicAssetId(requestedId);
    const key = graphicKey(videoId, assetId);
    const row = await storeRequest<DemoGraphicAssetRow | undefined>(GRAPHIC_STORE, "readonly", (store) => store.get(key));
    if (!row || !this.matches(row)) return;
    await storeRequest<undefined>(GRAPHIC_STORE, "readwrite", (store) => store.delete(key));
  }

  async clear() {
    await this.assertActive();
    this.active = false;
    this.dispose();
    await clearDemoMediaStorage();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export async function openDemoMediaStore(options: OpenDemoMediaStoreOptions): Promise<DemoMediaStore> {
  const requested = validateSession(options.sessionId, options.expiresAt);
  const existing = readSession();
  const sessionChanged = !existing || existing.sessionId !== requested.sessionId || existing.expiresAt !== requested.expiresAt;
  const existingExpired = !!existing && existing.expiresAt <= Date.now();
  if (sessionChanged || existingExpired) await clearDemoMediaStorage();
  if (requested.expiresAt <= Date.now()) {
    options.onExpired?.();
    throw new Error("Demo session expired");
  }
  writeSession(requested);
  return new BrowserDemoMediaStore(requested, options.onExpired);
}
