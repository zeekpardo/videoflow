import { describe, expect, it } from "vitest";
import {
  buildFinishedTimeline,
  finishedTimeToSourceMs,
  sourceIntervalToFinished,
  sourceTimeToFinishedMs,
} from "@/convex/lib/videoTimeline";

describe("finished video timeline mapping", () => {
  const timeline = buildFinishedTimeline(10_000, {
    version: 2,
    trim: { startMs: 1_000, endMs: 9_000 },
    cuts: [
      { startMs: 2_000, endMs: 3_000 },
      { startMs: 5_000, endMs: 5_500 },
    ],
  });

  it("builds concatenated kept ranges from trim and cuts", () => {
    expect(timeline).toEqual({
      sourceDurationMs: 10_000,
      durationMs: 6_500,
      trim: { startMs: 1_000, endMs: 9_000 },
      ranges: [
        { startMs: 1_000, endMs: 2_000, finishedStartMs: 0, finishedEndMs: 1_000 },
        { startMs: 3_000, endMs: 5_000, finishedStartMs: 1_000, finishedEndMs: 3_000 },
        { startMs: 5_500, endMs: 9_000, finishedStartMs: 3_000, finishedEndMs: 6_500 },
      ],
    });
  });

  it("maps incoming finished-time points back to stored source time", () => {
    expect(finishedTimeToSourceMs(-100, timeline)).toBe(1_000);
    expect(finishedTimeToSourceMs(500, timeline)).toBe(1_500);
    expect(finishedTimeToSourceMs(1_000, timeline)).toBe(3_000);
    expect(finishedTimeToSourceMs(3_000, timeline)).toBe(5_500);
    expect(finishedTimeToSourceMs(99_000, timeline)).toBe(9_000);
  });

  it("maps kept source points and hides points removed by trim or cuts", () => {
    expect(sourceTimeToFinishedMs(1_500, timeline)).toBe(500);
    expect(sourceTimeToFinishedMs(2_500, timeline)).toBeNull();
    expect(sourceTimeToFinishedMs(3_000, timeline)).toBe(1_000);
    expect(sourceTimeToFinishedMs(500, timeline)).toBeNull();
    expect(sourceTimeToFinishedMs(9_500, timeline)).toBeNull();
    expect(sourceTimeToFinishedMs(9_000, timeline)).toBe(6_500);
  });

  it("splits transcript segments at removed ranges and clamps to rendition duration", () => {
    expect(sourceIntervalToFinished(1_500, 3_500, timeline)).toEqual([
      { startMs: 500, endMs: 1_000 },
      { startMs: 1_000, endMs: 1_500 },
    ]);
    expect(sourceIntervalToFinished(2_100, 2_900, timeline)).toEqual([]);
    expect(sourceIntervalToFinished(8_000, 9_500, timeline, 6_000)).toEqual([
      { startMs: 5_500, endMs: 6_000 },
    ]);
  });

  it("normalizes overlapping, invalid, and out-of-bounds cuts safely", () => {
    const robust = buildFinishedTimeline(5_000, {
      version: 2,
      trim: { startMs: -1_000, endMs: 8_000 },
      cuts: [
        { startMs: Number.NaN, endMs: 100 },
        { startMs: -500, endMs: 1_000 },
        { startMs: 900, endMs: 2_000 },
        { startMs: 4_500, endMs: 7_000 },
      ],
    });
    expect(robust.durationMs).toBe(2_500);
    expect(robust.ranges).toEqual([
      { startMs: 2_000, endMs: 4_500, finishedStartMs: 0, finishedEndMs: 2_500 },
    ]);
  });

  it("keeps legacy live projects on the full source timeline", () => {
    const legacy = buildFinishedTimeline(4_000, {
      version: 1,
      trim: { startMs: 1_000, endMs: 2_000 },
      cuts: [],
    });
    expect(legacy.trim).toEqual({ startMs: 0, endMs: 4_000 });
    expect(finishedTimeToSourceMs(1_500, legacy)).toBe(1_500);
    expect(sourceTimeToFinishedMs(1_500, legacy)).toBe(1_500);
  });
});
