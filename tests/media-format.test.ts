import { describe, expect, it } from "vitest";
import {
  audioFileExtension,
  isSupportedVideoContainer,
  mediaTypeEssence,
  videoFileExtension,
  videoFilename,
} from "../lib/media-format";

describe("media container filenames", () => {
  it("keeps Safari MP4 MIME parameters out of filenames", () => {
    const mime = "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
    expect(mediaTypeEssence(mime)).toBe("video/mp4");
    expect(videoFileExtension(mime)).toBe("mp4");
    expect(videoFilename("recording", mime)).toBe("recording.mp4");
    expect(isSupportedVideoContainer(mime)).toBe(true);
  });

  it("preserves WebM defaults and recognizes Safari audio containers", () => {
    expect(videoFilename("recording", "video/webm;codecs=vp9,opus")).toBe("recording.webm");
    expect(videoFilename("recording", undefined)).toBe("recording.webm");
    expect(audioFileExtension("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(audioFileExtension("audio/ogg")).toBe("ogg");
    expect(isSupportedVideoContainer("text/plain")).toBe(false);
  });
});

describe("multipart upload content-type validation", () => {
  // Mirrors validContentType in convex/multipartUploads.ts. Browser MediaRecorder
  // blobs carry codec parameters, and use-resumable-upload.ts forwards file.type
  // unmodified, so validating the raw string rejected every real recording over the
  // 32 MB multipart threshold.
  const accepts = (contentType: string) =>
    /^(video|audio|image)\/[a-z0-9.+-]+$/.test(mediaTypeEssence(contentType));

  it("accepts parameterised MediaRecorder types", () => {
    expect(accepts("video/webm;codecs=vp9,opus")).toBe(true);
    expect(accepts("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toBe(true);
    expect(accepts("audio/webm;codecs=opus")).toBe(true);
  });

  it("still accepts bare container types", () => {
    expect(accepts("video/webm")).toBe(true);
    expect(accepts("image/png")).toBe(true);
  });

  it("still rejects types outside the allowed families", () => {
    expect(accepts("application/pdf")).toBe(false);
    expect(accepts("text/html;charset=utf-8")).toBe(false);
    expect(accepts("")).toBe(false);
  });
});
