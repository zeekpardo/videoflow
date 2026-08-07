import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDemoMediaStorage,
  clearExpiredDemoMediaStorage,
  DEMO_MEDIA_SESSION_STORAGE_KEY,
  openDemoMediaStore,
  type NewDemoVideo,
} from "@/lib/demo-video-store";
import { deleteLocalVideo, getLocalVideo, saveLocalVideo } from "@/lib/local-video-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function video(id = "demo-video"): NewDemoVideo {
  return {
    id,
    title: "Demo recording",
    createdAt: Date.now(),
    durationMs: 30_000,
    mode: "screen_camera",
    mimeType: "video/webm",
    sizeBytes: 5,
    videoBlob: new Blob(["video"], { type: "video/webm" }),
    screenBlob: new Blob(["screen"], { type: "video/webm" }),
    cameraBlob: new Blob(["camera"], { type: "video/webm" }),
  };
}

describe("sales demo media storage", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    await clearDemoMediaStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("supports session-bound recorder, editor, and graphic CRUD", async () => {
    const store = await openDemoMediaStore({ sessionId: "session-a", expiresAt: Date.now() + 60_000 });
    const saved = await store.saveVideo(video());
    expect(saved.editRevision).toBe(0);
    expect(saved.editState.version).toBe(2);
    expect(await store.listVideos()).toHaveLength(1);

    const renamed = await store.patchVideo(saved.id, { title: "Renamed demo" });
    expect(renamed.title).toBe("Renamed demo");
    expect(renamed.editRevision).toBe(0);
    const edited = await store.saveEditorProject(saved.id, {
      editState: { ...renamed.editState, trim: { startMs: 1_000, endMs: 29_000 } },
      zoomEffects: [{ id: "zoom", startMs: 2_000, endMs: 3_000, x: 0.5, y: 0.5, scale: 2 }],
    });
    expect(edited.editRevision).toBe(1);
    expect(edited.editState.trim).toEqual({ startMs: 1_000, endMs: 29_000 });

    const asset = await store.saveGraphicAsset(saved.id, {
      assetId: "demo_graphic",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 640,
      height: 360,
    });
    expect(asset).toMatchObject({ videoId: saved.id, assetId: "demo_graphic", mimeType: "image/png", width: 640, height: 360 });
    expect(await (await store.getGraphicAsset(saved.id, "demo_graphic"))?.blob.text()).toBe("png");
    expect(await store.listGraphicAssets(saved.id)).toHaveLength(1);

    await store.deleteVideo(saved.id);
    expect(await store.getVideo(saved.id)).toBeNull();
    expect(await store.listGraphicAssets(saved.id)).toEqual([]);
    store.dispose();
  });

  it("enforces recording integrity and video count inside the store", async () => {
    const store = await openDemoMediaStore({ sessionId: "bounded-session", expiresAt: Date.now() + 60_000 });
    await expect(store.saveVideo({ ...video("wrong-size"), sizeBytes: 999 })).rejects.toThrow("size does not match");
    for (let index = 0; index < 10; index += 1) await store.saveVideo(video(`bounded-${index}`));
    await expect(store.saveVideo(video("one-too-many"))).rejects.toThrow("up to 10 videos");
    store.dispose();
  });

  it("removes graphic blobs after their image objects leave the saved project", async () => {
    const store = await openDemoMediaStore({ sessionId: "asset-cleanup-session", expiresAt: Date.now() + 60_000 });
    const saved = await store.saveVideo(video("asset-cleanup-video"));
    await store.saveGraphicAsset(saved.id, {
      assetId: "orphaned_graphic",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 640,
      height: 360,
    });
    expect(await store.listGraphicAssets(saved.id)).toHaveLength(1);
    await store.saveEditorProject(saved.id, { editState: saved.editState, zoomEffects: [] });
    expect(await store.listGraphicAssets(saved.id)).toEqual([]);
    store.dispose();
  });

  it("wipes demo media and namespaced keys when the session changes", async () => {
    const firstExpiry = Date.now() + 80;
    const first = await openDemoMediaStore({ sessionId: "session-first", expiresAt: firstExpiry });
    await first.saveVideo(video("first-video"));
    localStorage.setItem("videoflow-sales-demo:temporary", "remove-me");
    localStorage.setItem("unrelated-key", "keep-me");

    const second = await openDemoMediaStore({ sessionId: "session-second", expiresAt: Date.now() + 10_000 });
    expect(await second.listVideos()).toEqual([]);
    expect(localStorage.getItem("videoflow-sales-demo:temporary")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
    await second.saveVideo(video("second-video"));
    await expect(first.listVideos()).rejects.toThrow("session changed");

    // The first store's old expiration callback must not erase session two.
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, firstExpiry - Date.now() + 20)));
    expect((await second.getVideo("second-video"))?.title).toBe("Demo recording");
    first.dispose();
    second.dispose();
  });

  it("expires while open and is empty on the next visit", async () => {
    let expired = false;
    let notify!: () => void;
    const notified = new Promise<void>((resolve) => { notify = resolve; });
    const store = await openDemoMediaStore({
      sessionId: "short-session",
      expiresAt: Date.now() + 80,
      onExpired: () => { expired = true; notify(); },
    });
    await store.saveVideo(video("expiring-video"));
    await notified;
    expect(expired).toBe(true);
    expect(localStorage.getItem(DEMO_MEDIA_SESSION_STORAGE_KEY)).toBeNull();
    await expect(store.listVideos()).rejects.toThrow("no longer active");

    const next = await openDemoMediaStore({ sessionId: "next-session", expiresAt: Date.now() + 10_000 });
    expect(await next.listVideos()).toEqual([]);
    next.dispose();
  });

  it("clears an expired prior session on the next open", async () => {
    const expiresAt = Date.now() + 10_000;
    const store = await openDemoMediaStore({ sessionId: "closed-session", expiresAt });
    await store.saveVideo(video("closed-video"));
    store.dispose();
    vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
    await expect(openDemoMediaStore({ sessionId: "closed-session", expiresAt })).rejects.toThrow("expired");
    vi.restoreAllMocks();
    const next = await openDemoMediaStore({ sessionId: "fresh-session", expiresAt: Date.now() + 10_000 });
    expect(await next.listVideos()).toEqual([]);
    next.dispose();
  });

  it("lets the access screen clear only expired local demo data", async () => {
    const activeExpiry = Date.now() + 10_000;
    const active = await openDemoMediaStore({ sessionId: "active-cookie-lost", expiresAt: activeExpiry });
    await active.saveVideo(video("keep-during-reverification"));
    active.dispose();
    expect(await clearExpiredDemoMediaStorage(Date.now())).toBe(false);

    expect(await clearExpiredDemoMediaStorage(activeExpiry + 1)).toBe(true);
    const next = await openDemoMediaStore({ sessionId: "next-after-access", expiresAt: activeExpiry + 20_000 });
    expect(await next.listVideos()).toEqual([]);
    next.dispose();
  });

  it("never clears the existing /test IndexedDB database", async () => {
    await saveLocalVideo({
      id: "local-test-video",
      title: "Keep local test",
      createdAt: Date.now(),
      durationMs: 1_000,
      mode: "screen",
      mimeType: "video/webm",
      sizeBytes: 5,
      videoBlob: new Blob(["local"], { type: "video/webm" }),
    });
    const demo = await openDemoMediaStore({ sessionId: "isolated-session", expiresAt: Date.now() + 10_000 });
    await demo.saveVideo(video("isolated-demo"));
    await demo.clear();
    expect((await getLocalVideo("local-test-video"))?.title).toBe("Keep local test");
    await deleteLocalVideo("local-test-video");
  });
});
