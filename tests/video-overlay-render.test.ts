import { describe, expect, it } from "vitest";
import {
  activeVideoClicks,
  activeVideoKeys,
  activeVideoObjects,
} from "@/lib/video-overlay-render";

describe("timed video overlays", () => {
  it("uses exclusive end times and preserves object layer order", () => {
    const objects = [
      { id: "top", kind: "rectangle" as const, startMs: 0, endMs: 1_000, x: .5, y: .5, width: .2, height: .2, rotation: 0, opacity: 1, zIndex: 8, fill: "#fff", stroke: "#000", strokeWidth: 2 },
      { id: "back", kind: "ellipse" as const, startMs: 100, endMs: 900, x: .5, y: .5, width: .2, height: .2, rotation: 0, opacity: 1, zIndex: 1, fill: "#fff", stroke: "#000", strokeWidth: 2 },
    ];
    expect(activeVideoObjects(objects, 500).map((item) => item.id)).toEqual(["back", "top"]);
    expect(activeVideoObjects(objects, 1_000)).toEqual([]);
  });

  it("selects click and key overlays at the current source time", () => {
    const clicks = [{ id: "click", startMs: 200, endMs: 700, x: .5, y: .5, color: "#f00", size: 48 }];
    const keys = [{ id: "key", startMs: 300, endMs: 900, label: "⌘ K", x: .5, y: .8 }];
    expect(activeVideoClicks(clicks, 250)).toHaveLength(1);
    expect(activeVideoKeys(keys, 250)).toHaveLength(0);
    expect(activeVideoClicks(clicks, 700)).toHaveLength(0);
    expect(activeVideoKeys(keys, 700)).toHaveLength(1);
  });
});
