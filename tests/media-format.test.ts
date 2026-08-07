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
