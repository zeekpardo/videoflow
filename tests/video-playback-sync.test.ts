import { describe, expect, it } from "vitest";
import {
  LAYER_HARD_SYNC_SECONDS,
  layerNeedsHardSync,
  synchronizedLayerPlaybackRate,
} from "@/lib/video-playback-sync";

describe("layered playback synchronization", () => {
  it("leaves aligned layers at the primary playback rate", () => {
    expect(synchronizedLayerPlaybackRate(1, 0)).toBe(1);
    expect(synchronizedLayerPlaybackRate(1.5, 0.02)).toBe(1.5);
  });

  it("gently corrects modest drift in the direction of the primary clock", () => {
    expect(synchronizedLayerPlaybackRate(1, -0.1)).toBeGreaterThan(1);
    expect(synchronizedLayerPlaybackRate(1, 0.1)).toBeLessThan(1);
    expect(synchronizedLayerPlaybackRate(1, -0.4)).toBeLessThanOrEqual(1.12);
    expect(synchronizedLayerPlaybackRate(1, 0.4)).toBeGreaterThanOrEqual(0.88);
  });

  it("reserves hard seeks for explicit synchronization and large drift", () => {
    expect(layerNeedsHardSync(0.2)).toBe(false);
    expect(layerNeedsHardSync(LAYER_HARD_SYNC_SECONDS - 0.001)).toBe(false);
    expect(layerNeedsHardSync(LAYER_HARD_SYNC_SECONDS)).toBe(true);
    expect(layerNeedsHardSync(-LAYER_HARD_SYNC_SECONDS)).toBe(true);
    expect(layerNeedsHardSync(0.01, true)).toBe(true);
  });
});
