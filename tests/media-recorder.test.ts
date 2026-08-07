import { afterEach, describe, expect, test, vi } from "vitest";
import {
  HIGH_DETAIL_DISPLAY_CONSTRAINTS,
  cameraVideoConstraints,
  pickAudioMime,
  pickVideoMime,
  pickVideoOnlyMime,
  recordedMimeType,
  recordingVideoBitrate,
  supportsDisplayCapture,
} from "../components/videos/use-media-recorder";

afterEach(() => vi.unstubAllGlobals());

describe("MediaRecorder capability selection", () => {
  test("checks screen capture separately from camera capture", () => {
    expect(supportsDisplayCapture({ getDisplayMedia: vi.fn() })).toBe(true);
    expect(supportsDisplayCapture(undefined)).toBe(false);
  });

  test("selects front and back cameras without mixing device constraints", () => {
    expect(cameraVideoConstraints(undefined, "environment")).toMatchObject({
      facingMode: { exact: "environment" },
    });
    expect(cameraVideoConstraints(undefined, "user", false)).toMatchObject({
      facingMode: { ideal: "user" },
    });
    const selected = cameraVideoConstraints("camera-2", "environment");
    expect(selected).toMatchObject({ deviceId: { exact: "camera-2" } });
    expect(selected).not.toHaveProperty("facingMode");
  });

  test("prefers VP9/Opus when the browser supports it", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (value: string) => value === "video/webm;codecs=vp9,opus" || value === "video/webm;codecs=vp9" });
    expect(pickVideoMime()).toBe("video/webm;codecs=vp9,opus");
    expect(pickVideoOnlyMime()).toBe("video/webm;codecs=vp9");
  });

  test("falls back across browser codec support", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (value: string) => value === "video/webm" || value === "audio/ogg" });
    expect(pickVideoMime()).toBe("video/webm");
    expect(pickVideoOnlyMime()).toBe("video/webm");
    expect(pickAudioMime()).toBe("audio/ogg");
  });

  test("uses native MP4 when WebM is unavailable on mobile WebKit", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (value: string) =>
        value === "video/mp4" || value === "audio/mp4",
    });
    expect(pickVideoMime()).toBe("video/mp4");
    expect(pickVideoOnlyMime()).toBe("video/mp4");
    expect(pickAudioMime()).toBe("audio/mp4");
  });

  test("uses WebKit's MP4 default when MIME capability probing is unavailable", () => {
    vi.stubGlobal("MediaRecorder", {});
    expect(pickVideoMime()).toBe("video/mp4");
    expect(pickVideoOnlyMime()).toBe("video/mp4");
    expect(pickAudioMime()).toBe("audio/mp4");
  });

  test("allows the browser default when no advertised MIME is supported", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(pickVideoMime()).toBe("");
    expect(pickVideoOnlyMime()).toBe("");
    expect(pickAudioMime()).toBe("");
  });

  test("trusts the format the recorder actually produced", () => {
    expect(recordedMimeType("video/mp4", "video/webm")).toBe("video/mp4");
    expect(recordedMimeType("", "video/webm")).toBe("video/webm");
    expect(recordedMimeType("", "")).toBe("video/mp4");
  });

  test("returns WebM defaults when MediaRecorder is unavailable", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickVideoMime()).toBe("video/webm");
    expect(pickVideoOnlyMime()).toBe("video/webm");
    expect(pickAudioMime()).toBe("audio/webm");
  });
});

describe("recording quality targets", () => {
  test("requests high-density display pixels without forcing an aspect ratio", () => {
    expect(HIGH_DETAIL_DISPLAY_CONSTRAINTS).toEqual({
      width: { ideal: 3_840 },
      height: { ideal: 2_160 },
      frameRate: { ideal: 30, max: 30 },
    });
    expect(HIGH_DETAIL_DISPLAY_CONSTRAINTS).not.toHaveProperty("aspectRatio");
  });

  test("gives detailed screen captures enough bitrate for readable UI text", () => {
    expect(recordingVideoBitrate(1280, 720, "screen", "video/webm;codecs=vp9")).toBe(8_000_000);
    expect(recordingVideoBitrate(1920, 1080, "screen", "video/webm;codecs=vp9")).toBe(11_819_520);
    expect(recordingVideoBitrate(3840, 2160, "screen", "video/webm;codecs=vp9")).toBe(36_000_000);
  });

  test("uses a camera-appropriate floor and scales for full-HD webcams", () => {
    expect(recordingVideoBitrate(1280, 720, "camera", "video/webm;codecs=vp9")).toBe(4_000_000);
    expect(recordingVideoBitrate(1920, 1080, "camera", "video/webm;codecs=vp9")).toBe(6_220_800);
  });

  test("budgets more bits for VP8 and safely bounds invalid dimensions", () => {
    expect(recordingVideoBitrate(1920, 1080, "screen", "video/webm;codecs=vp8")).toBe(13_685_760);
    expect(recordingVideoBitrate(Number.NaN, 0, "screen", "video/webm;codecs=vp9")).toBe(8_000_000);
  });
});
