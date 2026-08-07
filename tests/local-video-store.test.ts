import "fake-indexeddb/auto";

import { beforeAll, describe, expect, it } from "vitest";
import {
  beginLocalFinishedRendition,
  currentLocalFinishedRendition,
  deleteLocalGraphicAsset,
  deleteLocalVideo,
  failLocalFinishedRendition,
  finalizeLocalFinishedRendition,
  getLocalGraphicAsset,
  getLocalVideo,
  listLocalGraphicAssets,
  patchLocalVideo,
  recordLocalView,
  removeLocalFinishedRendition,
  saveLocalEditorProject,
  saveLocalGraphicAsset,
  saveLocalVideo,
  updateLocalViewProgress,
  type LocalVideo,
} from "@/lib/local-video-store";

const DATABASE = "videoflow-local-test";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not reset local video storage"));
    request.onblocked = () => reject(new Error("Local video storage reset was blocked"));
  });
}

function fixtureVideo(): LocalVideo {
  return {
    id: "concurrent-video",
    title: "Original title",
    description: "Original description",
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

describe("local video storage", () => {
  beforeAll(async () => {
    await deleteDatabase();
  });

  it("preserves disjoint settings and editor patches that overlap", async () => {
    const video = fixtureVideo();
    await saveLocalVideo(video);

    const existing = await getLocalVideo(video.id);
    expect(existing).not.toBeNull();

    const editorState = {
      ...existing!.editState!,
      cuts: [{ id: "cut-1", startMs: 2_000, endMs: 4_000 }],
    };

    await Promise.all([
      patchLocalVideo(video.id, { editState: editorState }),
      patchLocalVideo(video.id, {
        title: "Updated in settings",
        description: "This settings save overlapped the editor save.",
        allowDownload: true,
      }),
    ]);

    const stored = await getLocalVideo(video.id);
    expect(stored).toMatchObject({
      id: video.id,
      title: "Updated in settings",
      description: "This settings save overlapped the editor save.",
      allowDownload: true,
    });
    expect(stored?.editState?.cuts).toEqual([
      { id: "cut-1", startMs: 2_000, endMs: 4_000 },
    ]);
    expect(await stored?.videoBlob.text()).toBe("video");
  });

  it("keeps the existing not-found error", async () => {
    await expect(patchLocalVideo("missing-video", { title: "No video" }))
      .rejects.toThrow("Local video not found");
  });

  it("keeps only safe http or https calls to action", async () => {
    const video = { ...fixtureVideo(), id: "cta-video", cta: { label: "Unsafe", url: "javascript:alert(1)" } };
    await saveLocalVideo(video);
    expect((await getLocalVideo(video.id))?.cta).toBeUndefined();

    await patchLocalVideo(video.id, { cta: { label: "Book a demo", url: "https://example.com/demo" } });
    expect((await getLocalVideo(video.id))?.cta).toEqual({ label: "Book a demo", url: "https://example.com/demo" });
  });

  it("publishes a local rendition only for the current edit revision", async () => {
    const video = { ...fixtureVideo(), id: "rendition-video" };
    await saveLocalVideo(video);
    expect((await getLocalVideo(video.id))?.editRevision).toBe(0);

    await beginLocalFinishedRendition(video.id, 0);
    const rendered = new Blob(["finished"], { type: "video/webm" });
    const ready = await finalizeLocalFinishedRendition(video.id, {
      blob: rendered,
      editRevision: 0,
      durationMs: 25_000,
    });
    expect(currentLocalFinishedRendition(ready)).toMatchObject({
      editRevision: 0,
      durationMs: 25_000,
      mimeType: "video/webm",
    });
    expect(await currentLocalFinishedRendition(ready)?.blob.text()).toBe("finished");

    const metadataOnly = await patchLocalVideo(video.id, { title: "Renamed" });
    expect(currentLocalFinishedRendition(metadataOnly)?.editRevision).toBe(0);

    const edited = await saveLocalEditorProject(video.id, {
      editState: metadataOnly.editState,
      zoomEffects: [{ id: "zoom", startMs: 1_000, endMs: 2_000, x: 0.5, y: 0.5, scale: 2 }],
    });
    expect(edited.editRevision).toBe(1);
    expect(currentLocalFinishedRendition(edited)).toBeNull();
    expect(edited.finishedRenditionBlob).toBeUndefined();

    await expect(finalizeLocalFinishedRendition(video.id, {
      blob: rendered,
      editRevision: 0,
      durationMs: 25_000,
    })).rejects.toThrow("changed while the rendition was rendering");
  });

  it("tracks rendition failures and supports explicit cleanup", async () => {
    const video = { ...fixtureVideo(), id: "failed-rendition-video" };
    await saveLocalVideo(video);
    await beginLocalFinishedRendition(video.id, 0);
    const failed = await failLocalFinishedRendition(video.id, 0, " Browser encoder stopped ");
    expect(failed).toMatchObject({
      finishedRenditionRevision: 0,
      finishedRenditionStatus: "error",
      finishedRenditionError: "Browser encoder stopped",
    });
    const removed = await removeLocalFinishedRendition(video.id);
    expect(removed.finishedRenditionStatus).toBeUndefined();
    expect(removed.finishedRenditionRevision).toBeUndefined();
    await expect(finalizeLocalFinishedRendition(video.id, {
      blob: new Blob(["not-video"], { type: "text/plain" }),
      editRevision: 0,
      durationMs: 1_000,
    })).rejects.toThrow("must be an MP4 or WebM video");
  });

  it("stores Safari MP4 finished renditions", async () => {
    const video = { ...fixtureVideo(), id: "safari-rendition-video" };
    await saveLocalVideo(video);
    await beginLocalFinishedRendition(video.id, 0);
    const ready = await finalizeLocalFinishedRendition(video.id, {
      blob: new Blob(["safari-finished"], { type: "video/mp4;codecs=avc1.42E01E,mp4a.40.2" }),
      editRevision: 0,
      durationMs: 12_000,
    });
    expect(currentLocalFinishedRendition(ready)).toMatchObject({
      mimeType: "video/mp4;codecs=avc1.42e01e,mp4a.40.2",
      durationMs: 12_000,
    });
  });

  it("measures local viewer progress against the current finished duration", async () => {
    const video = { ...fixtureVideo(), id: "finished-view-video", shareToken: "finished-view-token" };
    await saveLocalVideo(video);
    await beginLocalFinishedRendition(video.id, 0);
    await finalizeLocalFinishedRendition(video.id, {
      blob: new Blob(["finished"], { type: "video/webm" }),
      editRevision: 0,
      durationMs: 10_000,
    });
    await recordLocalView(video.shareToken, "viewer-one");

    await updateLocalViewProgress(video.shareToken, "viewer-one", 50_000);

    const stored = await getLocalVideo(video.id);
    expect(stored?.views?.[0]).toMatchObject({
      maxPositionMs: 10_000,
      percentWatched: 100,
      completed: true,
    });
  });

  it("stores validated raster graphics separately from the local video row", async () => {
    const video = { ...fixtureVideo(), id: "graphic-video" };
    await saveLocalVideo(video);
    const first = await saveLocalGraphicAsset(video.id, {
      assetId: "graphic_1",
      blob: new Blob(["png-one"], { type: "image/png" }),
      width: 640,
      height: 360,
    });
    expect(first).toMatchObject({
      videoId: video.id,
      assetId: "graphic_1",
      mimeType: "image/png",
      sizeBytes: 7,
      width: 640,
      height: 360,
    });
    expect(await (await getLocalGraphicAsset(video.id, "graphic_1"))?.blob.text()).toBe("png-one");
    expect(await listLocalGraphicAssets(video.id)).toHaveLength(1);

    const replacement = await saveLocalGraphicAsset(video.id, {
      assetId: "graphic_1",
      blob: new Blob(["webp-two"], { type: "image/webp" }),
      width: 320,
      height: 180,
    });
    expect(replacement.createdAt).toBe(first.createdAt);
    expect(replacement).toMatchObject({ mimeType: "image/webp", width: 320, height: 180 });
    expect(await (await getLocalGraphicAsset(video.id, "graphic_1"))?.blob.text()).toBe("webp-two");

    await deleteLocalGraphicAsset(video.id, "graphic_1");
    expect(await getLocalGraphicAsset(video.id, "graphic_1")).toBeNull();
  });

  it("rejects unsafe or oversized local graphic files", async () => {
    const video = { ...fixtureVideo(), id: "invalid-graphic-video" };
    await saveLocalVideo(video);
    await expect(saveLocalGraphicAsset(video.id, {
      assetId: "unsafe",
      blob: new Blob(["svg"], { type: "image/svg+xml" }),
      width: 100,
      height: 100,
    })).rejects.toThrow("PNG, JPG, or WebP");
    await expect(saveLocalGraphicAsset(video.id, {
      assetId: "too_big",
      blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" }),
      width: 100,
      height: 100,
    })).rejects.toThrow("under 10 MB");
    await expect(saveLocalGraphicAsset(video.id, {
      assetId: "bad id!",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 100,
      height: 100,
    })).rejects.toThrow("asset ID is invalid");
    await expect(saveLocalGraphicAsset("missing-graphic-video", {
      assetId: "graphic",
      blob: new Blob(["png"], { type: "image/png" }),
      width: 100,
      height: 100,
    })).rejects.toThrow("Local video not found");
  });

  it("cascades local graphic assets when their video is deleted", async () => {
    const video = { ...fixtureVideo(), id: "graphic-cascade-video" };
    await saveLocalVideo(video);
    await saveLocalGraphicAsset(video.id, {
      assetId: "cascade_graphic",
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      width: 200,
      height: 100,
    });
    await deleteLocalVideo(video.id);
    expect(await getLocalVideo(video.id)).toBeNull();
    expect(await listLocalGraphicAssets(video.id)).toEqual([]);
  });
});
