import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASTER_AUDIO,
  masterGainAt,
  normalizeMasterAudio,
} from "@/lib/video-audio";

describe("master audio", () => {
  it("normalizes unsafe settings against the edited duration", () => {
    expect(normalizeMasterAudio({
      muted: false,
      gain: 4,
      fadeInMs: -20,
      fadeOutMs: 30_000,
    }, 4_000)).toEqual({
      muted: false,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 4_000,
    });
  });

  it("applies level and final-timeline fades", () => {
    const settings = normalizeMasterAudio({
      gain: 0.8,
      fadeInMs: 2_000,
      fadeOutMs: 1_000,
    }, 10_000);

    expect(masterGainAt(settings, 0, 10_000)).toBe(0);
    expect(masterGainAt(settings, 1_000, 10_000)).toBeCloseTo(0.4);
    expect(masterGainAt(settings, 5_000, 10_000)).toBeCloseTo(0.8);
    expect(masterGainAt(settings, 9_500, 10_000)).toBeCloseTo(0.4);
    expect(masterGainAt(settings, 10_000, 10_000)).toBe(0);
  });

  it("mutes independently of the monitoring volume", () => {
    expect(masterGainAt({ ...DEFAULT_MASTER_AUDIO, muted: true }, 5_000, 10_000)).toBe(0);
  });

  it("uses the quieter envelope when fades overlap", () => {
    const settings = normalizeMasterAudio({ gain: 1, fadeInMs: 8_000, fadeOutMs: 8_000 }, 10_000);
    expect(masterGainAt(settings, 5_000, 10_000)).toBeCloseTo(0.625);
  });
});
