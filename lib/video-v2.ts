import type {
  VideoClickOverlay,
  VideoCut,
  VideoEditStateV2,
  VideoTextOverlay,
  VideoZoomEffect,
} from "@/lib/video-edits";

export type CaptionPreset = "minimal" | "karaoke" | "pop" | "lower_third";
export type CaptionPosition = "top" | "middle" | "bottom";

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: CaptionWord[];
}

export interface CaptionStyle {
  preset: CaptionPreset;
  position: CaptionPosition;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  fontScale: number;
  burnIn: boolean;
}

export interface VideoCaptionTrack {
  language: string;
  revision: number;
  cues: CaptionCue[];
  style: CaptionStyle;
}

export interface VideoTemplateSettings {
  name: string;
  background: string;
  screenPadding: number;
  screenRadius: number;
  screenShadow: boolean;
  cameraPosition: "bottom_left" | "bottom_right" | "top_left" | "top_right";
  captionPreset: CaptionPreset;
  introTitle?: string;
  outroTitle?: string;
  defaultCta?: { label: string; url: string };
}

export interface MagicPolishSuggestion {
  id: string;
  kind: "trim" | "silence" | "filler" | "audio" | "captions" | "title" | "chapters" | "template";
  label: string;
  description: string;
  startMs?: number;
  endMs?: number;
  confidence: number;
  selected: boolean;
}

export interface TranscriptSegmentLike {
  start: number;
  end: number;
  text: string;
}

export type DirectorPlanItemKind = "cut" | "captions" | "smart_focus" | "title" | "summary" | "chapters" | "template";

export interface DirectorPlanItem {
  id: string;
  kind: DirectorPlanItemKind;
  label: string;
  description: string;
  startMs?: number;
  endMs?: number;
  selected: boolean;
}

export interface DirectorPlan {
  headline: string;
  rationale: string;
  suggestedTitle: string;
  suggestedSummary: string;
  chapters: Array<{ startMs: number; label: string }>;
  items: DirectorPlanItem[];
}

export interface VisualSopFrame {
  timestampMs: number;
  caption: string;
}

export interface ViewerAnswerCitation {
  startMs: number;
  endMs: number;
  label: string;
}

export interface VideoTaskProposalCandidate {
  fingerprint: string;
  sourceKind: "transcript" | "comment" | "review";
  sourceId?: string;
  sourceTimestampMs?: number;
  title: string;
  description?: string;
  confidence: number;
}

const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  preset: "minimal",
  position: "bottom",
  textColor: "#ffffff",
  highlightColor: "#facc15",
  backgroundColor: "#0f172acc",
  fontScale: 1,
  burnIn: false,
};

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) || value === "transparent")
    ? value.toLowerCase()
    : fallback;
}

function approximateWords(text: string, startMs: number, endMs: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, 500);
  if (!tokens.length) return [];
  const step = (endMs - startMs) / tokens.length;
  return tokens.map((token, index) => ({
    text: token,
    startMs: startMs + step * index,
    endMs: index === tokens.length - 1 ? endMs : startMs + step * (index + 1),
  }));
}

export function normalizeCaptionStyle(value?: Partial<CaptionStyle> | null): CaptionStyle {
  const presets = new Set<CaptionPreset>(["minimal", "karaoke", "pop", "lower_third"]);
  const positions = new Set<CaptionPosition>(["top", "middle", "bottom"]);
  return {
    preset: presets.has(value?.preset as CaptionPreset) ? value!.preset! : DEFAULT_CAPTION_STYLE.preset,
    position: positions.has(value?.position as CaptionPosition) ? value!.position! : DEFAULT_CAPTION_STYLE.position,
    textColor: color(value?.textColor, DEFAULT_CAPTION_STYLE.textColor),
    highlightColor: color(value?.highlightColor, DEFAULT_CAPTION_STYLE.highlightColor),
    backgroundColor: color(value?.backgroundColor, DEFAULT_CAPTION_STYLE.backgroundColor),
    fontScale: clamp(finite(value?.fontScale, 1), 0.5, 2),
    burnIn: value?.burnIn === true,
  };
}

export function normalizeCaptionCues(input: unknown, durationMs: number): CaptionCue[] {
  if (!Array.isArray(input)) return [];
  const duration = Math.max(0, finite(durationMs));
  const seen = new Set<string>();
  const cues: CaptionCue[] = [];
  for (const candidate of input.slice(0, 2_000)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Partial<CaptionCue>;
    const id = typeof value.id === "string" ? value.id.trim().slice(0, 80) : "";
    const text = typeof value.text === "string" ? value.text.replace(/\s+/g, " ").trim().slice(0, 1_000) : "";
    const startMs = clamp(finite(value.startMs), 0, duration);
    const endMs = clamp(finite(value.endMs), startMs, duration);
    if (!id || seen.has(id) || !text || endMs - startMs < 50) continue;
    seen.add(id);
    const words = Array.isArray(value.words) ? value.words.slice(0, 500).flatMap((word) => {
      if (!word || typeof word !== "object") return [];
      const row = word as Partial<CaptionWord>;
      const wordText = typeof row.text === "string" ? row.text.trim().slice(0, 100) : "";
      const wordStart = clamp(finite(row.startMs, startMs), startMs, endMs);
      const wordEnd = clamp(finite(row.endMs, wordStart), wordStart, endMs);
      return wordText && wordEnd > wordStart ? [{ text: wordText, startMs: wordStart, endMs: wordEnd }] : [];
    }) : undefined;
    cues.push({ id, startMs, endMs, text, words: words?.length ? words : approximateWords(text, startMs, endMs) });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
}

export function transcriptToCaptionCues(segments: TranscriptSegmentLike[], durationMs: number): CaptionCue[] {
  return normalizeCaptionCues(segments.map((segment, index) => ({
    id: `caption-${index + 1}`,
    startMs: segment.start,
    endMs: segment.end,
    text: segment.text,
  })), durationMs);
}

export function captionTrackToTranscriptSegments(track?: VideoCaptionTrack | null): TranscriptSegmentLike[] {
  return (track?.cues ?? []).map((cue) => ({ start: cue.startMs, end: cue.endMs, text: cue.text }));
}

export function captionTrackToTextOverlays(track?: VideoCaptionTrack | null): VideoTextOverlay[] {
  if (!track?.style.burnIn) return [];
  const y = track.style.position === "top" ? 0.14 : track.style.position === "middle" ? 0.5 : 0.84;
  const fontSize = Math.round(42 * Math.max(0.5, Math.min(2, track.style.fontScale)));
  return track.cues.map((cue) => ({
    id: `caption-${cue.id}`.slice(0, 80),
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    x: 0.5,
    y,
    fontSize,
    color: track.style.textColor,
    background: track.style.backgroundColor,
  }));
}

function timestamp(ms: number, separator: "," | ".") {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function captionsToSrt(cues: CaptionCue[]) {
  return cues.map((cue, index) => `${index + 1}\n${timestamp(cue.startMs, ",")} --> ${timestamp(cue.endMs, ",")}\n${cue.text}\n`).join("\n");
}

export function captionsToVtt(cues: CaptionCue[]) {
  return `WEBVTT\n\n${cues.map((cue) => `${cue.id}\n${timestamp(cue.startMs, ".")} --> ${timestamp(cue.endMs, ".")}\n${cue.text}\n`).join("\n")}`;
}

function parseTimestamp(input: string) {
  const match = input.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return ((Number(match[1] || 0) * 60 * 60 + Number(match[2]) * 60 + Number(match[3])) * 1_000) + Number(match[4]);
}

export function parseCaptionFile(source: string, durationMs: number): CaptionCue[] {
  const blocks = source.replace(/^\uFEFF/, "").replace(/^WEBVTT[^\n]*\n/i, "").trim().split(/\n\s*\n/);
  const cues = blocks.flatMap((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return [];
    const [startRaw, endRawWithSettings] = lines[timingIndex].split("-->");
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRawWithSettings.trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]*>/g, "").trim();
    if (startMs === null || endMs === null || !text) return [];
    return [{ id: `caption-${index + 1}`, startMs, endMs, text }];
  });
  return normalizeCaptionCues(cues, durationMs);
}

export function magicPolishSuggestions(input: {
  durationMs: number;
  transcript?: TranscriptSegmentLike[] | null;
  silenceRanges?: Array<{ startMs: number; endMs: number }>;
  hasCaptionTrack?: boolean;
  hasTemplate?: boolean;
}): MagicPolishSuggestion[] {
  const suggestions: MagicPolishSuggestion[] = [];
  const duration = Math.max(0, input.durationMs);
  for (const [index, silence] of (input.silenceRanges ?? []).entries()) {
    const startMs = clamp(finite(silence.startMs), 0, duration);
    const endMs = clamp(finite(silence.endMs), startMs, duration);
    if (endMs - startMs < 700) continue;
    const edge = startMs < 1_500 || duration - endMs < 1_500;
    suggestions.push({
      id: `${edge ? "trim" : "silence"}-${index}`,
      kind: edge ? "trim" : "silence",
      label: edge ? "Trim dead air" : "Shorten a silent pause",
      description: `${((endMs - startMs) / 1_000).toFixed(1)} seconds at ${timestamp(startMs, ".").slice(3, -4)}`,
      startMs,
      endMs,
      confidence: edge ? 0.98 : 0.9,
      selected: true,
    });
  }
  const fillerPattern = /\b(um+|uh+|erm+|you know|sort of|kind of)\b/i;
  for (const [index, segment] of (input.transcript ?? []).entries()) {
    if (!fillerPattern.test(segment.text)) continue;
    suggestions.push({
      id: `filler-${index}`,
      kind: "filler",
      label: "Review a filler phrase",
      description: segment.text.trim().slice(0, 120),
      startMs: segment.start,
      endMs: segment.end,
      confidence: 0.72,
      selected: false,
    });
  }
  suggestions.push({ id: "audio-normalize", kind: "audio", label: "Balance voice loudness", description: "Normalize the published audio and apply gentle speech cleanup.", confidence: 0.96, selected: true });
  if (!input.hasCaptionTrack && input.transcript?.length) suggestions.push({ id: "captions-create", kind: "captions", label: "Create kinetic captions", description: "Turn the transcript into an editable caption track.", confidence: 0.99, selected: true });
  if (!input.hasTemplate) suggestions.push({ id: "template-apply", kind: "template", label: "Apply a branded layout", description: "Add consistent framing, camera placement, and caption styling.", confidence: 0.88, selected: true });
  if (input.transcript?.length) {
    suggestions.push({ id: "title-generate", kind: "title", label: "Suggest a clearer title", description: "Use the recording transcript to draft a concise title and summary.", confidence: 0.8, selected: false });
    suggestions.push({ id: "chapters-generate", kind: "chapters", label: "Generate chapters", description: "Create timestamped navigation from topic changes.", confidence: 0.78, selected: false });
  }
  return suggestions;
}

export function createDirectorPlan(input: {
  title: string;
  instruction?: string;
  durationMs: number;
  transcript: TranscriptSegmentLike[];
  silenceRanges?: Array<{ startMs: number; endMs: number }>;
  hasCaptionTrack?: boolean;
  hasTemplate?: boolean;
  hasClickMarkers?: boolean;
}): DirectorPlan {
  const words = input.transcript.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const suggestedTitle = words.split(/\s+/).slice(0, 9).join(" ").replace(/[.,;:!?]+$/, "") || input.title;
  const suggestedSummary = input.transcript.slice(0, 4).map((segment) => segment.text.trim()).join(" ").slice(0, 600);
  const chapters = input.transcript
    .filter((_, index) => index % Math.max(1, Math.ceil(input.transcript.length / 6)) === 0)
    .slice(0, 8)
    .map((segment) => ({ startMs: segment.start, label: segment.text.trim().split(/\s+/).slice(0, 7).join(" ") }));
  const polish = magicPolishSuggestions({
    durationMs: input.durationMs,
    transcript: input.transcript,
    silenceRanges: input.silenceRanges,
    hasCaptionTrack: input.hasCaptionTrack,
    hasTemplate: input.hasTemplate,
  });
  const items: DirectorPlanItem[] = polish.flatMap((suggestion) => {
    const kind = suggestion.kind === "trim" || suggestion.kind === "silence" ? "cut" : suggestion.kind;
    if (!["cut", "captions", "title", "chapters", "template"].includes(kind)) return [];
    return [{ ...suggestion, kind: kind as DirectorPlanItemKind, selected: suggestion.kind !== "title" && suggestion.kind !== "chapters" }];
  });
  if (suggestedSummary) items.push({ id: "summary-generate", kind: "summary", label: "Write the summary", description: "Create a concise description grounded in the transcript.", selected: true });
  if (input.hasClickMarkers) items.push({ id: "smart-focus-generate", kind: "smart_focus", label: "Add Smart Focus", description: "Use click activity to guide the viewer through important interface details.", selected: true });
  return {
    headline: "A cleaner, easier-to-follow cut",
    rationale: input.instruction?.trim().slice(0, 500) || "Tighten the pacing, improve navigation, and make the recording easier to scan without changing its meaning.",
    suggestedTitle: suggestedTitle.slice(0, 100),
    suggestedSummary,
    chapters,
    items: items.slice(0, 30),
  };
}

export function suggestVisualSopFrames(segments: TranscriptSegmentLike[], durationMs: number, limit = 4): VisualSopFrame[] {
  const rows = segments.filter((segment) => segment.text.trim() && segment.start >= 0 && segment.start <= durationMs);
  if (!rows.length) return [];
  const count = Math.max(1, Math.min(6, Math.floor(limit), rows.length));
  const used = new Set<number>();
  return Array.from({ length: count }, (_, index) => {
    const rowIndex = Math.min(rows.length - 1, Math.floor(index * rows.length / count));
    used.add(rowIndex);
    const row = rows[rowIndex];
    return {
      timestampMs: clamp(row.start + Math.min(750, Math.max(0, row.end - row.start) / 2), 0, durationMs),
      caption: row.text.trim().replace(/\s+/g, " ").slice(0, 140),
    };
  }).filter((_, index) => index < used.size);
}

const ANSWER_STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "who", "why", "with"]);

function answerTokens(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !ANSWER_STOP_WORDS.has(token)) ?? [];
}

export function rankTranscriptSegments(question: string, segments: TranscriptSegmentLike[], limit = 3) {
  const terms = new Set(answerTokens(question));
  const ranked = segments.map((segment, index) => {
    const tokens = answerTokens(segment.text);
    const overlap = tokens.reduce((score, token) => score + (terms.has(token) ? 1 : 0), 0);
    return { segment, index, score: overlap * 10 + Math.min(tokens.length, 20) / 100 };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = (terms.size && ranked.some((row) => row.score >= 10) ? ranked.filter((row) => row.score >= 10) : ranked)
    .slice(0, Math.max(1, Math.min(5, limit)))
    .map((row) => row.segment);
  return best.sort((a, b) => a.start - b.start);
}

function taskTitle(value: string) {
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/^(?:action item|todo|to-do|please|we (?:need|should|have) to|i (?:need|should|have) to|can you|could you)\s*[:—-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (!cleaned) return "";
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`.slice(0, 180);
}

function taskFingerprint(sourceKind: string, sourceId: string | undefined, timestampMs: number | undefined, title: string) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  return `${sourceKind}:${sourceId ?? Math.round(timestampMs ?? 0)}:${normalized}`.slice(0, 240);
}

export function proposeVideoTasks(input: {
  transcript?: TranscriptSegmentLike[] | null;
  comments?: Array<{ id: string; text: string; timestampMs?: number }>;
  reviews?: Array<{ id: string; text: string }>;
}, limit = 20): VideoTaskProposalCandidate[] {
  const candidates: VideoTaskProposalCandidate[] = [];
  const explicitAction = /\b(action item|todo|to-do|need to|needs to|should|must|please|can you|could you|follow up|fix|update|create|send|review|change|remove|add)\b/i;
  for (const segment of input.transcript ?? []) {
    if (!explicitAction.test(segment.text)) continue;
    const title = taskTitle(segment.text);
    if (title.length < 4) continue;
    candidates.push({
      fingerprint: taskFingerprint("transcript", undefined, segment.start, title),
      sourceKind: "transcript",
      sourceTimestampMs: Math.max(0, segment.start),
      title,
      description: `Suggested from the transcript near ${Math.floor(Math.max(0, segment.start) / 1_000)}s.`,
      confidence: /\b(action item|todo|to-do|must|please)\b/i.test(segment.text) ? 0.94 : 0.76,
    });
  }
  for (const comment of input.comments ?? []) {
    const title = taskTitle(comment.text);
    if (title.length < 4) continue;
    candidates.push({
      fingerprint: taskFingerprint("comment", comment.id, comment.timestampMs, title),
      sourceKind: "comment",
      sourceId: comment.id,
      sourceTimestampMs: comment.timestampMs,
      title,
      description: "Suggested from timestamped viewer feedback.",
      confidence: explicitAction.test(comment.text) ? 0.96 : 0.82,
    });
  }
  for (const review of input.reviews ?? []) {
    const title = taskTitle(review.text);
    if (title.length < 4) continue;
    candidates.push({
      fingerprint: taskFingerprint("review", review.id, undefined, title),
      sourceKind: "review",
      sourceId: review.id,
      title,
      description: "Suggested from a reviewer’s requested changes.",
      confidence: 0.99,
    });
  }
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.confidence - a.confidence || (a.sourceTimestampMs ?? 0) - (b.sourceTimestampMs ?? 0))
    .filter((candidate) => !seen.has(candidate.fingerprint) && seen.add(candidate.fingerprint))
    .slice(0, Math.max(1, Math.min(50, Math.floor(limit))));
}

export async function detectAudioSilences(sourceUrl: string, options: { minSilenceMs?: number; threshold?: number } = {}) {
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Audio analysis is unavailable in this browser");
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error("The recording audio could not be loaded for analysis");
  const context = new AudioContextConstructor();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const windowMs = 50;
    const windowSamples = Math.max(1, Math.round(buffer.sampleRate * windowMs / 1_000));
    const threshold = Math.max(.001, Math.min(.2, options.threshold ?? .018));
    const minSilenceMs = Math.max(300, options.minSilenceMs ?? 750);
    const ranges: Array<{ startMs: number; endMs: number }> = [];
    let silenceStart: number | null = null;
    for (let offset = 0; offset < buffer.length; offset += windowSamples) {
      let energy = 0;
      let samples = 0;
      const end = Math.min(buffer.length, offset + windowSamples);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = offset; index < end; index += 1) { energy += data[index] * data[index]; samples += 1; }
      }
      const rms = samples ? Math.sqrt(energy / samples) : 0;
      const timeMs = offset / buffer.sampleRate * 1_000;
      if (rms < threshold && silenceStart === null) silenceStart = timeMs;
      if (rms >= threshold && silenceStart !== null) {
        if (timeMs - silenceStart >= minSilenceMs) ranges.push({ startMs: Math.round(silenceStart), endMs: Math.round(timeMs) });
        silenceStart = null;
      }
    }
    const endMs = buffer.duration * 1_000;
    if (silenceStart !== null && endMs - silenceStart >= minSilenceMs) ranges.push({ startMs: Math.round(silenceStart), endMs: Math.round(endMs) });
    return ranges.slice(0, 100);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function cutsFromPolishSuggestions(suggestions: MagicPolishSuggestion[]): VideoCut[] {
  return suggestions.filter((item) => item.selected && item.kind === "silence" && item.startMs !== undefined && item.endMs !== undefined).map((item) => ({
    id: `polish-${item.id}`,
    startMs: item.startMs!,
    endMs: item.endMs!,
  }));
}

export function smartFocusZooms(clicks: VideoClickOverlay[], intensity: "subtle" | "moderate" | "energetic", durationMs: number): VideoZoomEffect[] {
  const config = intensity === "subtle" ? { scale: 1.45, before: 250, after: 1_250 } : intensity === "energetic" ? { scale: 2.35, before: 120, after: 850 } : { scale: 1.85, before: 200, after: 1_050 };
  const candidates = clicks.map((click, index) => ({
    id: `smart-focus-${click.id || index}`,
    startMs: Math.max(0, click.startMs - config.before),
    endMs: Math.min(durationMs, Math.max(click.endMs, click.startMs + config.after)),
    x: clamp(click.x, 0.05, 0.95),
    y: clamp(click.y, 0.05, 0.95),
    scale: config.scale,
  })).filter((zoom) => zoom.endMs - zoom.startMs >= 100).sort((a, b) => a.startMs - b.startMs);
  const connected: VideoZoomEffect[] = [];
  for (const zoom of candidates) {
    const previous = connected.at(-1);
    if (previous && zoom.startMs < previous.endMs) {
      if (zoom.startMs - previous.startMs < 400) continue;
      previous.endMs = zoom.startMs;
    }
    connected.push(zoom);
  }
  return connected.slice(0, 50);
}

export function applyTemplateToEditState(editState: VideoEditStateV2, template: VideoTemplateSettings): VideoEditStateV2 {
  const positions = {
    bottom_left: { x: 0.17, y: 0.81 },
    bottom_right: { x: 0.83, y: 0.81 },
    top_left: { x: 0.17, y: 0.19 },
    top_right: { x: 0.83, y: 0.19 },
  } as const;
  return {
    ...editState,
    screen: { ...editState.screen, cornerRadius: clamp(template.screenRadius, 0, 100) },
    camera: editState.camera ? { ...editState.camera, ...positions[template.cameraPosition] } : undefined,
  };
}

export function deterministicVideoDocument(input: { title: string; kind: "sop" | "tutorial" | "release_notes" | "recap" | "email"; segments: TranscriptSegmentLike[] }) {
  const heading = input.kind === "sop" ? "Standard operating procedure" : input.kind === "tutorial" ? "Tutorial" : input.kind === "release_notes" ? "Release notes" : input.kind === "recap" ? "Video recap" : "Email summary";
  const rows = input.segments.filter((segment) => segment.text.trim()).slice(0, 40);
  const body = [`# ${input.title}`, "", `_${heading} generated from the video transcript._`, "", ...rows.map((segment, index) => `${index + 1}. [${timestamp(segment.start, ".").slice(3, -4)}] ${segment.text.trim()}`)].join("\n");
  return { title: `${input.title} — ${heading}`, body };
}
