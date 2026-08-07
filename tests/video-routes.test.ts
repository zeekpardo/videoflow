import { describe, expect, it } from "vitest";
import { videoEditorHref } from "@/lib/video-routes";

describe("videoEditorHref", () => {
  it("opens a provider-backed recording in the full editor", () => {
    expect(videoEditorHref("j57abc123")).toBe("/videos/j57abc123");
  });

  it("opens a browser-local recording in the test-mode editor", () => {
    expect(videoEditorHref("9eb81a42-85ea-41f3-99e8-55a11aa0d89c", "local"))
      .toBe("/test/videos/9eb81a42-85ea-41f3-99e8-55a11aa0d89c");
  });

  it("preserves imported local identifiers safely inside the path", () => {
    expect(videoEditorHref("demo/video #1", "local"))
      .toBe("/test/videos/demo%2Fvideo%20%231");
  });
});
