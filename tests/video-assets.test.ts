import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_GRAPHIC_BYTES,
  isVideoGraphicMimeType,
  validateVideoGraphicFile,
} from "@/lib/video-assets";

describe("video graphic assets", () => {
  it("accepts only the raster formats rendered consistently by preview and export", () => {
    expect(isVideoGraphicMimeType("image/png")).toBe(true);
    expect(isVideoGraphicMimeType("image/jpeg")).toBe(true);
    expect(isVideoGraphicMimeType("image/webp")).toBe(true);
    expect(isVideoGraphicMimeType("image/svg+xml")).toBe(false);
    expect(isVideoGraphicMimeType("image/gif")).toBe(false);
  });

  it("rejects empty, oversized, and unsupported files", () => {
    expect(() => validateVideoGraphicFile(new File([], "empty.png", { type: "image/png" }))).toThrow("empty");
    expect(() => validateVideoGraphicFile(new File([new Uint8Array(MAX_VIDEO_GRAPHIC_BYTES + 1)], "large.png", { type: "image/png" }))).toThrow("under 10 MB");
    expect(() => validateVideoGraphicFile(new File(["<svg/>"], "unsafe.svg", { type: "image/svg+xml" }))).toThrow("PNG, JPG, or WebP");
  });
});
