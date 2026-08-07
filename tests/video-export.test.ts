import { describe, expect, it, vi } from "vitest";

// `video-export` is browser-facing and imports this module through Next's `@`
// alias, while the deliberately minimal Node Vitest config has no alias entry.
// These pure-export tests do not execute the compositor, so a narrow virtual
// stand-in keeps the suite focused on the exported deterministic helpers.
vi.mock("@/lib/video-edits", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/video-edits")>(),
  activeTextOverlays: () => [],
  activeZoomEffect: () => undefined,
}));
import {
  buildKeptSourceRanges,
  cameraRect,
  cameraStrokeWidth,
  containRect,
  createVideoProjectManifest,
  editedExportSupport,
  exportVideoBitrate,
  keptDurationMs,
  pickExportMime,
  resolveExportDimensions,
  safeVideoFilename,
} from "../lib/video-export";
import type { VideoEditState, VideoZoomEffect } from "../lib/video-edits";

const editState: VideoEditState = {
  version: 1,
  cuts: [{ id: "cut-1", startMs: 1_000, endMs: 2_000 }],
  crop: { top: 0.05, right: 0.1, bottom: 0.15, left: 0.2 },
  screen: { x: 0.45, y: 0.55, scale: 1.2, cornerRadius: 18 },
  camera: {
    x: 0.8,
    y: 0.75,
    size: 0.24,
    shape: "rounded",
    mirror: true,
    visible: true,
  },
  textOverlays: [{
    id: "text-1",
    startMs: 2_500,
    endMs: 4_000,
    text: "A safe title",
    x: 0.5,
    y: 0.2,
    fontSize: 42,
    color: "#ffffff",
    background: "#111827cc",
  }],
};

const zoomEffects: VideoZoomEffect[] = [{
  id: "zoom-1",
  startMs: 3_000,
  endMs: 5_000,
  x: 0.6,
  y: 0.4,
  scale: 2,
}];

describe("safeVideoFilename", () => {
  it("removes traversal separators, control characters, unsafe punctuation, and known extensions", () => {
    const filename = safeVideoFilename("../Q3\\Demo\u0000\u001f: Final?<draft>|.webm");

    expect(filename).toBe("Q3-Demo-Final-draft-");
    expect(filename).not.toMatch(/[\\/\u0000-\u001f\u007f:*?"<>|]/);
    expect(filename).not.toContain("..");
    expect(filename).not.toMatch(/\.webm$/i);
  });

  it.each(["CON", "prn.webm", "Aux", "NUL.json", "com1.mp4", "LPT9"])(
    "replaces the reserved device name %s",
    (title) => {
      expect(safeVideoFilename(title)).toBe("videoflow-recording");
    }
  );

  it("normalizes Unicode, collapses whitespace, and bounds the basename", () => {
    expect(safeVideoFilename("  Café   product   tour.mp4  ")).toBe("Cafe-product-tour");
    expect(safeVideoFilename("x".repeat(200))).toBe("x".repeat(80));
    expect(safeVideoFilename("...   ")).toBe("videoflow-recording");
  });
});

describe("kept source ranges", () => {
  it("keeps the full source when there are no cuts", () => {
    const ranges = buildKeptSourceRanges(10_000);
    expect(ranges).toEqual([{ startMs: 0, endMs: 10_000 }]);
    expect(keptDurationMs(ranges)).toBe(10_000);
  });

  it("clamps, sorts, and merges overlapping or touching cuts", () => {
    const ranges = buildKeptSourceRanges(10_000, [
      { id: "middle-b", startMs: 3_000, endMs: 5_000 },
      { id: "middle-a", startMs: 1_000, endMs: 4_000 },
      { id: "touching", startMs: 5_000, endMs: 6_000 },
      { id: "end", startMs: 9_000, endMs: 12_000 },
      { id: "start", startMs: -500, endMs: 500 },
      { id: "backwards", startMs: 8_000, endMs: 7_000 },
      { id: "invalid", startMs: Number.NaN, endMs: 9_000 },
    ]);

    expect(ranges).toEqual([
      { startMs: 500, endMs: 1_000 },
      { startMs: 6_000, endMs: 9_000 },
    ]);
    expect(keptDurationMs(ranges)).toBe(3_500);
  });

  it("returns no ranges when a cut removes the full source or duration is invalid", () => {
    expect(buildKeptSourceRanges(5_000, [{ id: "all", startMs: -1_000, endMs: 8_000 }])).toEqual([]);
    expect(buildKeptSourceRanges(0)).toEqual([]);
    expect(buildKeptSourceRanges(Number.NaN)).toEqual([]);
  });

  it("intersects internal cuts with explicit trim in and out points", () => {
    expect(buildKeptSourceRanges(10_000, [
      { id: "before", startMs: 500, endMs: 1_500 },
      { id: "inside", startMs: 4_000, endMs: 5_000 },
      { id: "after", startMs: 8_500, endMs: 9_500 },
    ], { startMs: 2_000, endMs: 8_000 })).toEqual([
      { startMs: 2_000, endMs: 4_000 },
      { startMs: 5_000, endMs: 8_000 },
    ]);
  });

  it("does not count backwards ranges as kept duration", () => {
    expect(keptDurationMs([
      { startMs: 0, endMs: 1_000 },
      { startMs: 3_000, endMs: 2_000 },
      { startMs: 4_000, endMs: 4_500 },
    ])).toBe(1_500);
  });
});

describe("export geometry", () => {
  it("preserves the source dimensions for a full-resolution export", () => {
    expect(resolveExportDimensions("native", 2560, 1440)).toEqual({ width: 2560, height: 1440 });
    expect(resolveExportDimensions("native", 640, 360)).toEqual({ width: 640, height: 360 });
  });

  it("uses encoder-safe even dimensions and caps full-resolution exports at 8K", () => {
    expect(resolveExportDimensions("native", 1919, 1079)).toEqual({ width: 1918, height: 1078 });
    expect(resolveExportDimensions("native", 15_360, 8_640)).toEqual({ width: 7680, height: 4320 });
  });

  it("fits 1080p and 720p exports within their presets while preserving aspect ratio", () => {
    expect(resolveExportDimensions("1080p", 2560, 1440)).toEqual({ width: 1920, height: 1080 });
    expect(resolveExportDimensions("720p", 2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(resolveExportDimensions("1080p", 1080, 1920)).toEqual({ width: 608, height: 1080 });
    expect(resolveExportDimensions("720p", 1080, 1920)).toEqual({ width: 404, height: 720 });
  });

  it("upscales smaller sources when a fixed resolution preset is requested", () => {
    expect(resolveExportDimensions("1080p", 640, 360)).toEqual({ width: 1920, height: 1080 });
    expect(resolveExportDimensions("720p", 640, 360)).toEqual({ width: 1280, height: 720 });
  });

  it("keeps full-resolution ultrawide pixels and fits quality presets without stretching", () => {
    expect(resolveExportDimensions("native", 3440, 1440)).toEqual({ width: 3440, height: 1440 });
    expect(resolveExportDimensions("1080p", 3440, 1440)).toEqual({ width: 1920, height: 804 });
    expect(resolveExportDimensions("720p", 3440, 1440)).toEqual({ width: 1280, height: 536 });

    for (const preset of ["native", "1080p", "720p"] as const) {
      const output = resolveExportDimensions(preset, 3440, 1440);
      expect(output.width / output.height).toBeCloseTo(3440 / 1440, 2);
      expect(output.width % 2).toBe(0);
      expect(output.height % 2).toBe(0);
    }
  });

  it("scales encoder bitrate with output quality and caps browser-heavy exports", () => {
    expect(exportVideoBitrate(1280, 720, 30, "video/webm;codecs=vp9")).toBe(8_000_000);
    expect(exportVideoBitrate(1920, 1080, 30, "video/webm;codecs=vp9")).toBe(11_819_520);
    expect(exportVideoBitrate(2560, 1440, 30, "video/webm;codecs=vp9")).toBe(21_012_480);
    expect(exportVideoBitrate(3840, 2160, 30, "video/webm;codecs=vp9")).toBe(47_278_080);
    expect(exportVideoBitrate(7680, 4320, 30, "video/webm;codecs=vp9")).toBe(48_000_000);
    expect(exportVideoBitrate(15_360, 8_640, 30, "video/webm;codecs=vp9")).toBe(48_000_000);
  });

  it("accounts for encoder efficiency and frame rate without dropping below the text-quality floor", () => {
    expect(exportVideoBitrate(1920, 1080)).toBe(13_685_760);
    expect(exportVideoBitrate(1280, 720, 60, "video/webm;codecs=vp9,opus")).toBe(10_506_240);
    expect(exportVideoBitrate(320, 180, 15, "video/webm;codecs=vp9,opus")).toBe(8_000_000);
    expect(exportVideoBitrate(Number.NaN, 0, Number.NaN)).toBe(8_000_000);
  });

  it("contains landscape and portrait sources without changing aspect ratio", () => {
    expect(containRect(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(containRect(1080, 1920, 1280, 720)).toEqual({ x: 437.5, y: 0, width: 405, height: 720 });
  });

  it("applies output-relative center and scale", () => {
    expect(containRect(1000, 500, 800, 800, 0.25, 0.75, 0.5)).toEqual({
      x: 0,
      y: 500,
      width: 400,
      height: 200,
    });
  });

  it("sizes a camera square from output height and centers it at the requested point", () => {
    expect(cameraRect(1920, 1080, 0.25, 0.75, 0.2)).toEqual({
      x: 372,
      y: 702,
      width: 216,
      height: 216,
    });
    expect(cameraRect(640, 360, 0, 0, 0)).toEqual({ x: -0.5, y: -0.5, width: 1, height: 1 });
  });

  it("uses the shorter frame edge for webcam size in both landscape and portrait exports", () => {
    expect(cameraRect(1920, 1080, 0.5, 0.5, 0.2)).toEqual({
      x: 852,
      y: 432,
      width: 216,
      height: 216,
    });
    expect(cameraRect(1080, 1920, 0.5, 0.5, 0.2)).toEqual({
      x: 432,
      y: 852,
      width: 216,
      height: 216,
    });
  });

  it("preserves the editor webcam center and shorter-edge-relative size at every export quality", () => {
    const camera = editState.camera!;
    const outputs = [
      resolveExportDimensions("native", 2560, 1440),
      resolveExportDimensions("1080p", 2560, 1440),
      resolveExportDimensions("720p", 2560, 1440),
    ];

    for (const output of outputs) {
      const rect = cameraRect(output.width, output.height, camera.x, camera.y, camera.size);

      // The editor positions the bubble with left/top percentages and sizes
      // its square from the shorter frame edge. The compositor must resolve the same
      // normalized center and edge length at every selected export quality.
      expect((rect.x + rect.width / 2) / output.width).toBeCloseTo(camera.x, 10);
      expect((rect.y + rect.height / 2) / output.height).toBeCloseTo(camera.y, 10);
      const shorterEdge = Math.min(output.width, output.height);
      expect(rect.width / shorterEdge).toBeCloseTo(camera.size, 10);
      expect(rect.height / shorterEdge).toBeCloseTo(camera.size, 10);
      expect(rect.width / output.width).toBeCloseTo((camera.size * shorterEdge) / output.width, 10);
    }
  });

  it("scales the webcam stroke consistently with export height and supports no outline", () => {
    expect(cameraStrokeWidth(1920, 1080, 3)).toBe(3);
    expect(cameraStrokeWidth(1280, 720, 3)).toBe(2);
    expect(cameraStrokeWidth(1080, 1920, 6)).toBe(6);
    expect(cameraStrokeWidth(3840, 2160, 3)).toBe(6);
    expect(cameraStrokeWidth(1920, 1080, 0)).toBe(0);
    expect(cameraStrokeWidth(Number.NaN, 0, Number.NaN)).toBeCloseTo(3 / 1080);
  });
});

describe("editedExportSupport", () => {
  it("reports an actionable unsupported result in the Node test environment", () => {
    expect(editedExportSupport()).toEqual({
      supported: false,
      reason: "Edited export requires a browser.",
    });
  });

  it("selects MP4 when Safari does not advertise a WebM encoder", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (mimeType: string) => mimeType === "video/mp4",
    });
    expect(pickExportMime()).toBe("video/mp4");
    vi.unstubAllGlobals();
  });
});

describe("createVideoProjectManifest", () => {
  it("uses MP4 asset names for Safari recordings", () => {
    const manifest = createVideoProjectManifest({
      title: "Safari review",
      mode: "screen_camera",
      durationMs: 12_000,
      editState,
      zoomEffects,
      hasScreenLayer: true,
      hasCameraLayer: true,
      sourceMimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    });
    expect(manifest.assets).toEqual({
      original: "Safari-review-original.mp4",
      screen: "Safari-review-screen.mp4",
      camera: "Safari-review-camera.mp4",
    });
  });

  it("contains portable filenames and edit metadata without source URLs or secrets", () => {
    const manifest = createVideoProjectManifest({
      title: "Customer walkthrough.webm",
      mode: "screen_camera",
      durationMs: 12_000,
      editState,
      zoomEffects,
      hasScreenLayer: true,
      hasCameraLayer: true,
      primarySrc: "https://private.example/original.webm?token=source-secret",
      screenSrc: "https://private.example/screen.webm?signature=secret",
      cameraSrc: "blob:https://app.example/private-camera",
      shareToken: "share-secret",
      passwordHash: "password-secret",
    } as Parameters<typeof createVideoProjectManifest>[0] & Record<string, unknown>);

    expect(manifest).toEqual({
      schema: "videoflow.project",
      version: 1,
      video: { title: "Customer walkthrough.webm", mode: "screen_camera", durationMs: 12_000 },
      assets: {
        original: "Customer-walkthrough-original.webm",
        screen: "Customer-walkthrough-screen.webm",
        camera: "Customer-walkthrough-camera.webm",
      },
      edits: { editState, zoomEffects },
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/https?:|blob:|source-secret|share-secret|password-secret|primarySrc|screenSrc|cameraSrc|passwordHash/);
  });

  it("omits unavailable optional layer filenames", () => {
    const manifest = createVideoProjectManifest({
      title: "Camera only",
      mode: "camera",
      durationMs: 5_000,
      editState: { ...editState, camera: undefined },
      zoomEffects: [],
      hasScreenLayer: false,
      hasCameraLayer: false,
    });

    expect(manifest.assets).toEqual({
      original: "Camera-only-original.webm",
      screen: undefined,
      camera: undefined,
    });
    expect(JSON.parse(JSON.stringify(manifest)).assets).toEqual({ original: "Camera-only-original.webm" });
  });
});
