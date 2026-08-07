import { describe, expect, it } from "vitest";
import {
  captionsToSrt,
  captionsToVtt,
  captionTrackToTextOverlays,
  captionTrackToTranscriptSegments,
  createDirectorPlan,
  cutsFromPolishSuggestions,
  magicPolishSuggestions,
  normalizeCaptionCues,
  parseCaptionFile,
  proposeVideoTasks,
  rankTranscriptSegments,
  smartFocusZooms,
  suggestVisualSopFrames,
  transcriptToCaptionCues,
} from "../lib/video-v2";

describe("VideoFlow V2 feature contracts", () => {
  it("normalizes, exports, and imports editable captions", () => {
    const cues = normalizeCaptionCues([
      { id: "one", startMs: 100, endMs: 1_500, text: "  Hello   world  " },
      { id: "one", startMs: 2_000, endMs: 3_000, text: "duplicate" },
      { id: "two", startMs: 1_600, endMs: 2_800, text: "Second cue" },
    ], 3_000);
    expect(cues.map((cue) => ({ id: cue.id, startMs: cue.startMs, endMs: cue.endMs, text: cue.text }))).toEqual([
      { id: "one", startMs: 100, endMs: 1_500, text: "Hello world" },
      { id: "two", startMs: 1_600, endMs: 2_800, text: "Second cue" },
    ]);
    expect(cues[0].words).toEqual([
      { text: "Hello", startMs: 100, endMs: 800 },
      { text: "world", startMs: 800, endMs: 1_500 },
    ]);
    expect(captionsToSrt(cues)).toContain("00:00:00,100 --> 00:00:01,500");
    expect(captionsToVtt(cues)).toMatch(/^WEBVTT/);
    expect(parseCaptionFile(captionsToVtt(cues), 3_000).map((cue) => cue.text)).toEqual(["Hello world", "Second cue"]);
  });

  it("creates caption cues from transcript segments", () => {
    expect(transcriptToCaptionCues([{ start: 0, end: 900, text: "Welcome" }], 1_000)).toEqual([
      { id: "caption-1", startMs: 0, endMs: 900, text: "Welcome", words: [{ text: "Welcome", startMs: 0, endMs: 900 }] },
    ]);
  });

  it("uses one caption track for the transcript and burned-in video overlays", () => {
    const track = {
      language: "en",
      revision: 2,
      cues: [{ id: "intro", startMs: 500, endMs: 1_500, text: "Welcome aboard" }],
      style: { preset: "karaoke" as const, position: "bottom" as const, textColor: "#ffffff", highlightColor: "#facc15", backgroundColor: "#0f172acc", fontScale: 1, burnIn: true },
    };
    expect(captionTrackToTranscriptSegments(track)).toEqual([{ start: 500, end: 1_500, text: "Welcome aboard" }]);
    expect(captionTrackToTextOverlays(track)).toEqual([expect.objectContaining({ id: "caption-intro", startMs: 500, endMs: 1_500, text: "Welcome aboard", x: 0.5, y: 0.84 })]);
    expect(captionTrackToTextOverlays({ ...track, style: { ...track.style, burnIn: false } })).toEqual([]);
  });

  it("suggests reversible silence cuts and edge trims", () => {
    const suggestions = magicPolishSuggestions({
      durationMs: 10_000,
      silenceRanges: [{ startMs: 0, endMs: 900 }, { startMs: 4_000, endMs: 5_200 }, { startMs: 9_100, endMs: 10_000 }],
      transcript: [{ start: 1_000, end: 2_000, text: "Um, welcome to the demo" }],
      hasCaptionTrack: false,
      hasTemplate: false,
    });
    expect(suggestions.filter((item) => item.kind === "trim")).toHaveLength(2);
    expect(suggestions.some((item) => item.kind === "filler" && !item.selected)).toBe(true);
    expect(cutsFromPolishSuggestions(suggestions)).toEqual([{ id: "polish-silence-1", startMs: 4_000, endMs: 5_200 }]);
  });

  it("turns click markers into non-overlapping Smart Focus zooms", () => {
    const zooms = smartFocusZooms([
      { id: "a", startMs: 1_000, endMs: 1_300, x: .2, y: .3, color: "#fff", size: 40 },
      { id: "b", startMs: 2_000, endMs: 2_300, x: .8, y: .7, color: "#fff", size: 40 },
    ], "moderate", 5_000);
    expect(zooms).toHaveLength(2);
    expect(zooms[0]).toMatchObject({ id: "smart-focus-a", x: .2, y: .3, scale: 1.85 });
    expect(zooms[0].endMs).toBeLessThanOrEqual(zooms[1].startMs);
  });

  it("builds a previewable Director plan without applying edits", () => {
    const plan = createDirectorPlan({
      title: "Raw recording",
      instruction: "Make this a crisp onboarding walkthrough",
      durationMs: 12_000,
      transcript: [{ start: 1_000, end: 3_000, text: "Create your first workspace and invite the team" }],
      silenceRanges: [{ startMs: 5_000, endMs: 6_200 }],
      hasClickMarkers: true,
    });
    expect(plan.rationale).toContain("onboarding");
    expect(plan.items.some((item) => item.kind === "cut")).toBe(true);
    expect(plan.items.some((item) => item.kind === "smart_focus")).toBe(true);
  });

  it("suggests distributed SOP frames and ranks cited answers", () => {
    const segments = [
      { start: 0, end: 1_000, text: "Welcome to the account settings" },
      { start: 2_000, end: 3_000, text: "Choose billing and update the payment method" },
      { start: 4_000, end: 5_000, text: "Invite teammates from the members page" },
    ];
    expect(suggestVisualSopFrames(segments, 5_000, 2)).toHaveLength(2);
    expect(rankTranscriptSegments("How do I update billing?", segments, 1)[0].start).toBe(2_000);
  });

  it("proposes bounded tasks from explicit transcript actions and review feedback", () => {
    const proposals = proposeVideoTasks({
      transcript: [
        { start: 1_000, end: 2_000, text: "Welcome to the launch overview." },
        { start: 3_000, end: 4_000, text: "Action item: update the pricing screenshot before Friday." },
      ],
      comments: [{ id: "comment-1", text: "Please fix the mobile spacing.", timestampMs: 5_000 }],
      reviews: [{ id: "review-1", text: "Remove the outdated checkout step." }],
    });
    expect(proposals).toHaveLength(3);
    expect(proposals.map((proposal) => proposal.sourceKind)).toEqual(["review", "comment", "transcript"]);
    expect(proposals[0].title).toBe("Remove the outdated checkout step");
    expect(proposals[1]).toMatchObject({ sourceId: "comment-1", sourceTimestampMs: 5_000 });
  });
});
