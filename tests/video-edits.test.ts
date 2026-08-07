import { describe, expect, it } from "vitest";
import {
  activeCut,
  activeTextOverlays,
  activeZoomEffect,
  buildVideoTimelineMap,
  defaultVideoEditState,
  editedTimeToSourceMs,
  editedDurationMs,
  formatEditTime,
  normalizeVideoEditState,
  snapSourceTimeToKeptMs,
  sourceTimeToEditedMs,
  type VideoEditState,
} from "../lib/video-edits";

describe("defaultVideoEditState", () => {
  it("creates a neutral state for a single video layer", () => {
    expect(defaultVideoEditState("screen")).toEqual({
      version: 2,
      trim: { startMs: 0, endMs: 0 },
      cuts: [],
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
      textOverlays: [],
      audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      objects: [],
      interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
    });
    expect(defaultVideoEditState("camera").camera).toBeUndefined();
  });

  it("maps recorder bubble values into the independent camera layer", () => {
    expect(defaultVideoEditState("screen_camera", {
      cx: 0.8,
      cy: 0.2,
      d: 0.34,
      shape: "square",
      mirror: true,
    }).camera).toEqual({
      x: 0.8,
      y: 0.2,
      size: 0.34,
      shape: "square",
      strokeWidth: 3,
      strokeColor: "#ffffff",
      mirror: true,
      visible: true,
    });
  });

  it("clamps unsafe bubble geometry", () => {
    expect(defaultVideoEditState("screen_camera", { cx: -4, cy: 8, d: 2 }).camera).toMatchObject({
      x: 0,
      y: 1,
      size: 0.8,
    });
  });
});

describe("normalizeVideoEditState", () => {
  it("fills missing state with safe defaults", () => {
    expect(normalizeVideoEditState(undefined, 10_000, true)).toEqual({
      version: 2,
      trim: { startMs: 0, endMs: 10_000 },
      cuts: [],
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
      camera: {
        x: 0.17,
        y: 0.81,
        size: 0.26,
        shape: "circle",
        strokeWidth: 3,
        strokeColor: "#ffffff",
        mirror: false,
        visible: true,
      },
      textOverlays: [],
      audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      objects: [],
      interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
    });
  });

  it("clamps transforms, crop, and camera configuration", () => {
    const normalized = normalizeVideoEditState({
      version: 1,
      crop: { top: -1, right: 3, bottom: Number.NaN, left: 0.25 },
      screen: { x: -3, y: 5, scale: 99, cornerRadius: -2 },
      camera: { x: 8, y: -1, size: 0, shape: "rounded", strokeWidth: 99, strokeColor: "javascript:alert(1)", mirror: true, visible: false },
    }, 8_000, true);

    expect(normalized.crop).toEqual({ top: 0, right: 0.49, bottom: 0, left: 0.25 });
    expect(normalized.screen).toEqual({ x: 0, y: 1, scale: 4, cornerRadius: 0 });
    expect(normalized.camera).toEqual({
      x: 1,
      y: 0,
      size: 0.08,
      shape: "rounded",
      strokeWidth: 12,
      strokeColor: "#ffffff",
      mirror: true,
      visible: false,
    });
  });

  it("removes camera data when no independent camera layer exists", () => {
    const normalized = normalizeVideoEditState({
      camera: { x: 0.2, y: 0.3, size: 0.4, shape: "square", mirror: true, visible: true },
    }, 5_000, false);
    expect(normalized.camera).toBeUndefined();
  });

  it("backfills stroke settings on legacy camera edits", () => {
    const normalized = normalizeVideoEditState({
      camera: { x: 0.2, y: 0.3, size: 0.4, shape: "square", mirror: true, visible: true },
    }, 5_000, true);

    expect(normalized.camera).toMatchObject({
      x: 0.2,
      y: 0.3,
      strokeWidth: 3,
      strokeColor: "#ffffff",
    });
  });

  it("clamps, sorts, deduplicates, and merges removed source ranges", () => {
    const normalized = normalizeVideoEditState({
      cuts: [
        { id: "late", startMs: 8_000, endMs: 20_000 },
        { id: "first", startMs: -200, endMs: 2_000 },
        { id: "duplicate-range", startMs: 0, endMs: 2_000 },
        { id: "overlap", startMs: 1_500, endMs: 3_000 },
        { id: "late", startMs: 4_000, endMs: 5_000 },
        { id: "empty", startMs: 4_000, endMs: 4_050 },
        { id: "backwards", startMs: 7_000, endMs: 6_000 },
        { id: "   ", startMs: 6_000, endMs: 7_000 },
      ],
    }, 10_000, false);

    expect(normalized.cuts).toEqual([
      { id: "first", startMs: 0, endMs: 3_000 },
      { id: "late", startMs: 4_000, endMs: 5_000 },
    ]);
  });

  it("normalizes text overlays while retaining original source times", () => {
    const normalized = normalizeVideoEditState({
      textOverlays: [
        {
          id: "later",
          startMs: 7_000,
          endMs: 30_000,
          text: "  Second title  ",
          x: 2,
          y: -1,
          fontSize: 999,
          color: "javascript:alert(1)",
          background: "transparent",
        },
        {
          id: "first",
          startMs: -1_000,
          endMs: 2_000,
          text: "First title",
          x: 0.25,
          y: 0.75,
          fontSize: 24,
          color: "#ABCDEF",
          background: "#0008",
        },
        {
          id: "first",
          startMs: 3_000,
          endMs: 4_000,
          text: "Duplicate id",
          x: 0,
          y: 0,
          fontSize: 10,
          color: "#fff",
          background: "#000",
        },
        {
          id: "blank",
          startMs: 1_000,
          endMs: 2_000,
          text: "   ",
          x: 0,
          y: 0,
          fontSize: 10,
          color: "#fff",
          background: "#000",
        },
      ],
    }, 10_000, false);

    expect(normalized.textOverlays).toEqual([
      {
        id: "first",
        startMs: 0,
        endMs: 2_000,
        text: "First title",
        x: 0.25,
        y: 0.75,
        fontSize: 24,
        color: "#abcdef",
        background: "#0008",
      },
      {
        id: "later",
        startMs: 7_000,
        endMs: 10_000,
        text: "Second title",
        x: 1,
        y: 0,
        fontSize: 160,
        color: "#ffffff",
        background: "transparent",
      },
    ]);
  });

  it("returns no timed edits for an invalid or zero duration", () => {
    const state = {
      cuts: [{ id: "cut", startMs: 0, endMs: 1_000 }],
      textOverlays: [{ id: "text", startMs: 0, endMs: 1_000, text: "Hello" }],
    } as Partial<VideoEditState>;
    expect(normalizeVideoEditState(state, Number.NaN, false).cuts).toEqual([]);
    expect(normalizeVideoEditState(state, -1, false).textOverlays).toEqual([]);
  });

  it("upgrades legacy v1 projects into bounded v2 trim and feature defaults", () => {
    const normalized = normalizeVideoEditState({
      version: 1,
      cuts: [],
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 },
      textOverlays: [],
    }, 9_000, false);

    expect(normalized).toMatchObject({
      version: 2,
      trim: { startMs: 0, endMs: 9_000 },
      audio: { muted: false, gain: 1, fadeInMs: 0, fadeOutMs: 0 },
      objects: [],
      interactions: { clicksEnabled: true, keysEnabled: true, clicks: [], keys: [] },
    });
  });
});

describe("source-time helpers", () => {
  const cuts = [
    { id: "a", startMs: 1_000, endMs: 2_000 },
    { id: "b", startMs: 4_000, endMs: 5_500 },
  ];

  it("uses half-open source ranges for cuts and zooms", () => {
    expect(activeCut(cuts, 999)).toBeUndefined();
    expect(activeCut(cuts, 1_000)?.id).toBe("a");
    expect(activeCut(cuts, 1_999)?.id).toBe("a");
    expect(activeCut(cuts, 2_000)).toBeUndefined();

    const zooms = [{ id: "z", startMs: 2_000, endMs: 3_000, x: 0.5, y: 0.5, scale: 2 }];
    expect(activeZoomEffect(zooms, 2_000)?.id).toBe("z");
    expect(activeZoomEffect(zooms, 3_000)).toBeUndefined();
  });

  it("returns every text overlay active at a source timestamp", () => {
    const overlays = [
      { id: "a", startMs: 0, endMs: 2_000, text: "A", x: 0, y: 0, fontSize: 20, color: "#fff", background: "transparent" },
      { id: "b", startMs: 1_000, endMs: 3_000, text: "B", x: 0, y: 0, fontSize: 20, color: "#fff", background: "transparent" },
    ];
    expect(activeTextOverlays(overlays, 1_500).map((overlay) => overlay.id)).toEqual(["a", "b"]);
    expect(activeTextOverlays(overlays, 3_000)).toEqual([]);
  });

  it("calculates edited duration without double-counting overlaps", () => {
    expect(editedDurationMs(10_000, [
      { id: "a", startMs: 1_000, endMs: 4_000 },
      { id: "b", startMs: 3_000, endMs: 5_000 },
      { id: "c", startMs: 8_000, endMs: 20_000 },
    ])).toBe(4_000);
    expect(editedDurationMs(-1, cuts)).toBe(0);
    expect(editedDurationMs(Number.NaN, cuts)).toBe(0);
  });

  it("maps trim and short cuts between source and final time without gaps", () => {
    const map = buildVideoTimelineMap(
      10_000,
      [{ id: "short", startMs: 2_000, endMs: 2_100 }, { id: "middle", startMs: 4_000, endMs: 5_000 }],
      { startMs: 1_000, endMs: 8_000 },
    );

    expect(map.ranges).toEqual([
      { startMs: 1_000, endMs: 2_000, editedStartMs: 0, editedEndMs: 1_000 },
      { startMs: 2_100, endMs: 4_000, editedStartMs: 1_000, editedEndMs: 2_900 },
      { startMs: 5_000, endMs: 8_000, editedStartMs: 2_900, editedEndMs: 5_900 },
    ]);
    expect(map.durationMs).toBe(5_900);
    expect(sourceTimeToEditedMs(3_000, map)).toBe(1_900);
    expect(sourceTimeToEditedMs(4_500, map)).toBe(2_900);
    expect(editedTimeToSourceMs(2_900, map)).toBe(5_000);
    expect(snapSourceTimeToKeptMs(2_050, map, "forward")).toBe(2_100);
    expect(snapSourceTimeToKeptMs(500, map, "forward")).toBe(1_000);
    expect(snapSourceTimeToKeptMs(9_000, map, "forward")).toBe(8_000);
  });
});

describe("formatEditTime", () => {
  it("formats edit positions without changing existing behavior", () => {
    expect(formatEditTime(0)).toBe("0:00");
    expect(formatEditTime(65_999)).toBe("1:05");
    expect(formatEditTime(-10)).toBe("0:00");
  });
});
