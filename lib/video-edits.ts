import {
  DEFAULT_MASTER_AUDIO,
  normalizeMasterAudio,
  type MasterAudioSettings,
} from "@/lib/video-audio";

export interface VideoZoomEffect {
  id: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  scale: number;
}

export interface VideoCut {
  /** Source-time range removed from playback. The end is exclusive. */
  id: string;
  startMs: number;
  endMs: number;
}

export interface VideoCrop {
  /** Insets expressed as fractions of the source frame (0–1). */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface VideoScreenTransform {
  /** Center position expressed as a fraction of the output frame. */
  x: number;
  y: number;
  scale: number;
  cornerRadius: number;
}

export type VideoCameraShape = "circle" | "rounded" | "square";

export interface VideoCameraTransform {
  /** Center position and size expressed as fractions of the output frame. */
  x: number;
  y: number;
  size: number;
  shape: VideoCameraShape;
  /** Stroke width in logical pixels at a 1080px output height. */
  strokeWidth?: number;
  /** Hex color used for the webcam outline. */
  strokeColor?: string;
  mirror: boolean;
  visible: boolean;
}

export interface VideoTextOverlay {
  /** Times use the original source timeline. The end is exclusive. */
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  background: string;
}

export interface VideoTrim {
  /** Inclusive source-time in point. */
  startMs: number;
  /** Exclusive source-time out point. */
  endMs: number;
}

export type VideoObjectKind = "rectangle" | "ellipse" | "arrow" | "callout" | "image";

export interface VideoObjectOverlay {
  id: string;
  kind: VideoObjectKind;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
  assetId?: string;
}

export interface VideoClickOverlay {
  id: string;
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  color: string;
  size: number;
}

export interface VideoKeyOverlay {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
  x: number;
  y: number;
}

export interface VideoInteractionSettings {
  clicksEnabled: boolean;
  keysEnabled: boolean;
  clicks: VideoClickOverlay[];
  keys: VideoKeyOverlay[];
}

/**
 * Non-destructive edits always refer to the original recording timeline.
 * Removing an earlier range does not rewrite later cut, text, or zoom times.
 */
interface VideoEditStateCommon {
  cuts: VideoCut[];
  crop: VideoCrop;
  screen: VideoScreenTransform;
  camera?: VideoCameraTransform;
  textOverlays: VideoTextOverlay[];
}

/** Legacy projects remain readable and are upgraded in memory on load. */
export interface VideoEditStateV1 extends VideoEditStateCommon {
  version: 1;
}

export interface VideoEditStateV2 extends VideoEditStateCommon {
  version: 2;
  trim: VideoTrim;
  audio: MasterAudioSettings;
  objects: VideoObjectOverlay[];
  interactions: VideoInteractionSettings;
}

export type VideoEditState = VideoEditStateV1 | VideoEditStateV2;

export type VideoEditMode = "screen" | "screen_camera" | "camera";

export interface BubbleLikeConfig {
  cx?: number;
  cy?: number;
  d?: number;
  shape?: "circle" | "square";
  mirror?: boolean;
}

const MAX_CUTS = 100;
const MAX_TEXT_OVERLAYS = 100;
const MAX_OBJECTS = 100;
const MAX_INTERACTIONS = 200;
const MAX_INPUT_ITEMS = 1_000;
const MIN_TIMED_ITEM_MS = 100;

const DEFAULT_CROP: VideoCrop = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_SCREEN: VideoScreenTransform = { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 };
const DEFAULT_CAMERA: VideoCameraTransform = {
  x: 0.17,
  y: 0.81,
  size: 0.26,
  shape: "circle",
  strokeWidth: 3,
  strokeColor: "#ffffff",
  mirror: false,
  visible: true,
};
const DEFAULT_INTERACTIONS: VideoInteractionSettings = {
  clicksEnabled: true,
  keysEnabled: true,
  clicks: [],
  keys: [],
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

function duration(value: unknown): number {
  return Math.max(0, finite(value, 0));
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function safeColor(value: unknown, fallback: string, allowTransparent = false): string {
  if (typeof value !== "string") return fallback;
  const color = value.trim().toLowerCase();
  if (allowTransparent && color === "transparent") return color;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
  return fallback;
}

function normalizeCuts(cuts: unknown, sourceDurationMs: number): VideoCut[] {
  if (!Array.isArray(cuts) || sourceDurationMs <= 0) return [];

  const candidates = cuts
    .slice(0, MAX_INPUT_ITEMS)
    .map((candidate): VideoCut | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const value = candidate as Partial<VideoCut>;
      const id = cleanId(value.id);
      if (!id) return null;
      const startMs = clamp(value.startMs, 0, sourceDurationMs, 0);
      const endMs = clamp(value.endMs, 0, sourceDurationMs, sourceDurationMs);
      if (endMs - startMs < MIN_TIMED_ITEM_MS) return null;
      return { id, startMs, endMs };
    })
    .filter((candidate): candidate is VideoCut => candidate !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const normalized: VideoCut[] = [];
  const seenIds = new Set<string>();
  const seenRanges = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) continue;
    const rangeKey = `${candidate.startMs}:${candidate.endMs}`;
    if (seenRanges.has(rangeKey)) continue;
    seenIds.add(candidate.id);
    seenRanges.add(rangeKey);

    const previous = normalized.at(-1);
    // Overlapping or touching removed ranges are one logical cut. Merging them
    // prevents double-counting while retaining the first stable identifier.
    if (previous && candidate.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, candidate.endMs);
      continue;
    }
    normalized.push({ ...candidate });
    if (normalized.length >= MAX_CUTS) break;
  }
  return normalized;
}

function normalizeTrim(value: unknown, sourceDurationMs: number): VideoTrim {
  if (sourceDurationMs <= 0) return { startMs: 0, endMs: 0 };
  const trim = value && typeof value === "object" ? value as Partial<VideoTrim> : undefined;
  const startMs = clamp(trim?.startMs, 0, Math.max(0, sourceDurationMs - MIN_TIMED_ITEM_MS), 0);
  // A zero end is emitted by freshly-created projects before their media
  // duration is known. Treat it as an open-ended trim instead of collapsing a
  // new recording to the 100ms minimum when metadata arrives.
  const requestedEnd = finite(trim?.endMs, sourceDurationMs);
  const endMs = requestedEnd <= startMs
    ? sourceDurationMs
    : clamp(requestedEnd, startMs + MIN_TIMED_ITEM_MS, sourceDurationMs, sourceDurationMs);
  return { startMs, endMs };
}

function normalizeTextOverlays(overlays: unknown, sourceDurationMs: number): VideoTextOverlay[] {
  if (!Array.isArray(overlays) || sourceDurationMs <= 0) return [];

  const candidates = overlays
    .slice(0, MAX_INPUT_ITEMS)
    .map((candidate): VideoTextOverlay | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const value = candidate as Partial<VideoTextOverlay>;
      const id = cleanId(value.id);
      const text = typeof value.text === "string" ? value.text.trim().slice(0, 500) : "";
      if (!id || !text) return null;
      const startMs = clamp(value.startMs, 0, sourceDurationMs, 0);
      const endMs = clamp(value.endMs, 0, sourceDurationMs, sourceDurationMs);
      if (endMs - startMs < MIN_TIMED_ITEM_MS) return null;
      return {
        id,
        startMs,
        endMs,
        text,
        x: clamp(value.x, 0, 1, 0.5),
        y: clamp(value.y, 0, 1, 0.82),
        fontSize: clamp(value.fontSize, 10, 160, 32),
        color: safeColor(value.color, "#ffffff"),
        background: safeColor(value.background, "#0f172acc", true),
      };
    })
    .filter((candidate): candidate is VideoTextOverlay => candidate !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));

  const normalized: VideoTextOverlay[] = [];
  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    normalized.push(candidate);
    if (normalized.length >= MAX_TEXT_OVERLAYS) break;
  }
  return normalized;
}

function normalizeObjects(objects: unknown, sourceDurationMs: number): VideoObjectOverlay[] {
  if (!Array.isArray(objects) || sourceDurationMs <= 0) return [];
  const kinds = new Set<VideoObjectKind>(["rectangle", "ellipse", "arrow", "callout", "image"]);
  const seen = new Set<string>();
  const normalized: VideoObjectOverlay[] = [];
  for (const candidate of objects.slice(0, MAX_INPUT_ITEMS)) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Partial<VideoObjectOverlay>;
    const id = cleanId(value.id);
    if (!id || seen.has(id) || !kinds.has(value.kind as VideoObjectKind)) continue;
    const startMs = clamp(value.startMs, 0, sourceDurationMs, 0);
    const endMs = clamp(value.endMs, 0, sourceDurationMs, sourceDurationMs);
    if (endMs - startMs < MIN_TIMED_ITEM_MS) continue;
    const text = typeof value.text === "string" ? value.text.trim().slice(0, 500) : undefined;
    const assetId = cleanId(value.assetId) || undefined;
    if (value.kind === "image" && !assetId) continue;
    seen.add(id);
    normalized.push({
      id,
      kind: value.kind as VideoObjectKind,
      startMs,
      endMs,
      x: clamp(value.x, 0, 1, 0.5),
      y: clamp(value.y, 0, 1, 0.5),
      width: clamp(value.width, 0.01, 1, 0.25),
      height: clamp(value.height, 0.01, 1, 0.2),
      rotation: clamp(value.rotation, -360, 360, 0),
      opacity: clamp(value.opacity, 0, 1, 1),
      zIndex: Math.round(clamp(value.zIndex, -100, 100, normalized.length)),
      fill: safeColor(value.fill, "#6d5bfc33", true),
      stroke: safeColor(value.stroke, "#6d5bfc", true),
      strokeWidth: clamp(value.strokeWidth, 0, 32, 3),
      ...(text ? { text } : {}),
      ...(value.textColor ? { textColor: safeColor(value.textColor, "#ffffff") } : {}),
      ...(value.fontSize !== undefined ? { fontSize: clamp(value.fontSize, 10, 200, 32) } : {}),
      ...(assetId ? { assetId } : {}),
    });
    if (normalized.length >= MAX_OBJECTS) break;
  }
  return normalized.sort((a, b) => a.zIndex - b.zIndex || a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function normalizeInteractions(value: unknown, sourceDurationMs: number): VideoInteractionSettings {
  if (!value || typeof value !== "object" || sourceDurationMs <= 0) return { ...DEFAULT_INTERACTIONS, clicks: [], keys: [] };
  const input = value as Partial<VideoInteractionSettings>;
  const clickIds = new Set<string>();
  const clicks: VideoClickOverlay[] = [];
  for (const candidate of Array.isArray(input.clicks) ? input.clicks.slice(0, MAX_INPUT_ITEMS) : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Partial<VideoClickOverlay>;
    const id = cleanId(item.id);
    const startMs = clamp(item.startMs, 0, sourceDurationMs, 0);
    const endMs = clamp(item.endMs, 0, sourceDurationMs, sourceDurationMs);
    if (!id || clickIds.has(id) || endMs - startMs < MIN_TIMED_ITEM_MS) continue;
    clickIds.add(id);
    clicks.push({ id, startMs, endMs, x: clamp(item.x, 0, 1, 0.5), y: clamp(item.y, 0, 1, 0.5), color: safeColor(item.color, "#ef4444"), size: clamp(item.size, 4, 240, 48) });
    if (clicks.length >= MAX_INTERACTIONS) break;
  }
  const keyIds = new Set<string>();
  const keys: VideoKeyOverlay[] = [];
  for (const candidate of Array.isArray(input.keys) ? input.keys.slice(0, MAX_INPUT_ITEMS) : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Partial<VideoKeyOverlay>;
    const id = cleanId(item.id);
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 80) : "";
    const startMs = clamp(item.startMs, 0, sourceDurationMs, 0);
    const endMs = clamp(item.endMs, 0, sourceDurationMs, sourceDurationMs);
    if (!id || !label || keyIds.has(id) || endMs - startMs < MIN_TIMED_ITEM_MS) continue;
    keyIds.add(id);
    keys.push({ id, label, startMs, endMs, x: clamp(item.x, 0, 1, 0.5), y: clamp(item.y, 0, 1, 0.85) });
    if (keys.length >= MAX_INTERACTIONS) break;
  }
  return {
    clicksEnabled: input.clicksEnabled !== false,
    keysEnabled: input.keysEnabled !== false,
    clicks,
    keys,
  };
}

function cameraShape(value: unknown, fallback: VideoCameraShape): VideoCameraShape {
  return value === "circle" || value === "rounded" || value === "square" ? value : fallback;
}

export function defaultVideoEditState(mode: VideoEditMode, bubble?: BubbleLikeConfig, sourceDurationMs = 0): VideoEditStateV2 {
  const state: VideoEditStateV2 = {
    version: 2,
    trim: { startMs: 0, endMs: Math.max(0, sourceDurationMs) },
    cuts: [],
    crop: { ...DEFAULT_CROP },
    screen: { ...DEFAULT_SCREEN },
    textOverlays: [],
    audio: { ...DEFAULT_MASTER_AUDIO },
    objects: [],
    interactions: { ...DEFAULT_INTERACTIONS, clicks: [], keys: [] },
  };

  if (mode === "screen_camera") {
    state.camera = {
      x: clamp(bubble?.cx, 0, 1, DEFAULT_CAMERA.x),
      y: clamp(bubble?.cy, 0, 1, DEFAULT_CAMERA.y),
      size: clamp(bubble?.d, 0.08, 0.8, DEFAULT_CAMERA.size),
      shape: bubble?.shape === "square" ? "square" : "circle",
      strokeWidth: DEFAULT_CAMERA.strokeWidth,
      strokeColor: DEFAULT_CAMERA.strokeColor,
      mirror: bubble?.mirror === true,
      visible: true,
    };
  }
  return state;
}

export function normalizeVideoEditState(
  state: Partial<VideoEditState> | null | undefined,
  durationMs: number,
  hasCameraLayer: boolean
): VideoEditStateV2 {
  const sourceDurationMs = duration(durationMs);
  const crop = state?.crop;
  const screen = state?.screen;
  const camera = state?.camera;

  const trim = normalizeTrim(state && "trim" in state ? state.trim : undefined, sourceDurationMs);
  const cuts = normalizeCuts(state?.cuts, sourceDurationMs);
  const timeline = buildVideoTimelineMap(sourceDurationMs, cuts, trim);

  return {
    version: 2,
    trim,
    cuts,
    crop: {
      // A 49% per-edge ceiling always leaves at least 2% of either axis.
      top: clamp(crop?.top, 0, 0.49, DEFAULT_CROP.top),
      right: clamp(crop?.right, 0, 0.49, DEFAULT_CROP.right),
      bottom: clamp(crop?.bottom, 0, 0.49, DEFAULT_CROP.bottom),
      left: clamp(crop?.left, 0, 0.49, DEFAULT_CROP.left),
    },
    screen: {
      x: clamp(screen?.x, 0, 1, DEFAULT_SCREEN.x),
      y: clamp(screen?.y, 0, 1, DEFAULT_SCREEN.y),
      scale: clamp(screen?.scale, 0.25, 4, DEFAULT_SCREEN.scale),
      cornerRadius: clamp(screen?.cornerRadius, 0, 100, DEFAULT_SCREEN.cornerRadius),
    },
    camera: hasCameraLayer
      ? {
          x: clamp(camera?.x, 0, 1, DEFAULT_CAMERA.x),
          y: clamp(camera?.y, 0, 1, DEFAULT_CAMERA.y),
          size: clamp(camera?.size, 0.08, 0.8, DEFAULT_CAMERA.size),
          shape: cameraShape(camera?.shape, DEFAULT_CAMERA.shape),
          strokeWidth: clamp(camera?.strokeWidth, 0, 12, DEFAULT_CAMERA.strokeWidth ?? 3),
          strokeColor: safeColor(camera?.strokeColor, DEFAULT_CAMERA.strokeColor ?? "#ffffff"),
          mirror: typeof camera?.mirror === "boolean" ? camera.mirror : DEFAULT_CAMERA.mirror,
          visible: typeof camera?.visible === "boolean" ? camera.visible : DEFAULT_CAMERA.visible,
        }
      : undefined,
    textOverlays: normalizeTextOverlays(state?.textOverlays, sourceDurationMs),
    audio: normalizeMasterAudio(state && "audio" in state ? state.audio : undefined, timeline.durationMs),
    objects: normalizeObjects(state && "objects" in state ? state.objects : undefined, sourceDurationMs),
    interactions: normalizeInteractions(state && "interactions" in state ? state.interactions : undefined, sourceDurationMs),
  };
}

export function activeZoomEffect(effects: readonly VideoZoomEffect[] | undefined, currentMs: number) {
  if (!effects?.length) return undefined;
  return effects.find((effect) => currentMs >= effect.startMs && currentMs < effect.endMs);
}

export function activeCut(cuts: readonly VideoCut[] | undefined, sourceTimeMs: number) {
  if (!cuts?.length || !Number.isFinite(sourceTimeMs)) return undefined;
  return cuts.find((cut) => sourceTimeMs >= cut.startMs && sourceTimeMs < cut.endMs);
}

export function activeTextOverlays(overlays: readonly VideoTextOverlay[] | undefined, sourceTimeMs: number) {
  if (!overlays?.length || !Number.isFinite(sourceTimeMs)) return [];
  return overlays.filter((overlay) => sourceTimeMs >= overlay.startMs && sourceTimeMs < overlay.endMs);
}

export function editedDurationMs(sourceDurationMs: number, cuts: readonly VideoCut[] | undefined, trim?: Partial<VideoTrim> | null) {
  return buildVideoTimelineMap(sourceDurationMs, cuts, trim).durationMs;
}

export interface VideoKeptRange {
  startMs: number;
  endMs: number;
  editedStartMs: number;
  editedEndMs: number;
}

export interface VideoTimelineMap {
  sourceDurationMs: number;
  durationMs: number;
  trim: VideoTrim;
  ranges: VideoKeptRange[];
}

/** One canonical map used by timeline UI, preview playback, audio fades, and export. */
export function buildVideoTimelineMap(
  sourceDurationMs: number,
  cuts: readonly VideoCut[] | undefined,
  trimValue?: Partial<VideoTrim> | null,
): VideoTimelineMap {
  const safeDuration = duration(sourceDurationMs);
  const trim = normalizeTrim(trimValue, safeDuration);
  // Timeline math is also used by the exporter and can receive a raw project
  // manifest. Ignore non-finite ranges rather than turning NaN into a cut from
  // zero, which could accidentally remove most of the recording.
  const finiteCuts = cuts?.filter((cut) => Number.isFinite(cut.startMs) && Number.isFinite(cut.endMs)) ?? [];
  const normalizedCuts = normalizeCuts(finiteCuts, safeDuration)
    .map((cut) => ({ ...cut, startMs: Math.max(trim.startMs, cut.startMs), endMs: Math.min(trim.endMs, cut.endMs) }))
    .filter((cut) => cut.endMs > cut.startMs);
  const sourceRanges: { startMs: number; endMs: number }[] = [];
  let cursor = trim.startMs;
  for (const cut of normalizedCuts) {
    if (cut.startMs > cursor) sourceRanges.push({ startMs: cursor, endMs: cut.startMs });
    cursor = Math.max(cursor, cut.endMs);
  }
  if (cursor < trim.endMs) sourceRanges.push({ startMs: cursor, endMs: trim.endMs });
  let editedCursor = 0;
  const ranges = sourceRanges
    .filter((range) => range.endMs - range.startMs >= 1)
    .map((range): VideoKeptRange => {
      const mapped = { ...range, editedStartMs: editedCursor, editedEndMs: editedCursor + range.endMs - range.startMs };
      editedCursor = mapped.editedEndMs;
      return mapped;
    });
  return { sourceDurationMs: safeDuration, durationMs: editedCursor, trim, ranges };
}

export function sourceTimeToEditedMs(sourceTimeMs: number, timeline: VideoTimelineMap) {
  const source = Math.min(timeline.trim.endMs, Math.max(timeline.trim.startMs, finite(sourceTimeMs, timeline.trim.startMs)));
  for (const range of timeline.ranges) {
    if (source < range.startMs) return range.editedStartMs;
    if (source <= range.endMs) return range.editedStartMs + Math.min(range.endMs - range.startMs, source - range.startMs);
  }
  return timeline.durationMs;
}

export function editedTimeToSourceMs(editedTimeMs: number, timeline: VideoTimelineMap, boundary: "forward" | "backward" = "forward") {
  if (!timeline.ranges.length) return timeline.trim.startMs;
  const edited = Math.min(timeline.durationMs, Math.max(0, finite(editedTimeMs, 0)));
  for (let index = 0; index < timeline.ranges.length; index += 1) {
    const range = timeline.ranges[index];
    if (edited < range.editedEndMs) return range.startMs + edited - range.editedStartMs;
    if (edited === range.editedEndMs) {
      const next = timeline.ranges[index + 1];
      if (boundary === "forward" && next) return next.startMs;
      return range.endMs;
    }
  }
  return timeline.ranges.at(-1)!.endMs;
}

export function snapSourceTimeToKeptMs(
  sourceTimeMs: number,
  timeline: VideoTimelineMap,
  direction: "forward" | "backward" | "nearest" = "forward",
) {
  if (!timeline.ranges.length) return timeline.trim.startMs;
  const source = finite(sourceTimeMs, timeline.trim.startMs);
  if (source <= timeline.ranges[0].startMs) return timeline.ranges[0].startMs;
  for (let index = 0; index < timeline.ranges.length; index += 1) {
    const range = timeline.ranges[index];
    if (source >= range.startMs && source < range.endMs) return source;
    const next = timeline.ranges[index + 1];
    if (next && source >= range.endMs && source < next.startMs) {
      if (direction === "backward") return range.endMs;
      if (direction === "nearest") return source - range.endMs < next.startMs - source ? range.endMs : next.startMs;
      return next.startMs;
    }
  }
  return timeline.ranges.at(-1)!.endMs;
}

export function nextRemovedBoundary(sourceTimeMs: number, timeline: VideoTimelineMap) {
  const source = finite(sourceTimeMs, timeline.trim.startMs);
  for (let index = 0; index < timeline.ranges.length; index += 1) {
    const range = timeline.ranges[index];
    if (source < range.endMs) {
      return {
        startMs: range.endMs,
        endMs: timeline.ranges[index + 1]?.startMs ?? timeline.trim.endMs,
        terminal: index === timeline.ranges.length - 1,
      };
    }
  }
  return undefined;
}

export function formatEditTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
