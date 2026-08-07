/**
 * Pure source-time/finished-time mapping shared by Convex public functions and
 * the browser-only share preview. Keep this module free of browser and Convex
 * runtime imports so the contract can be exercised with ordinary unit tests.
 */

export interface TimelineCutLike {
  startMs: number;
  endMs: number;
}

export interface TimelineTrimLike {
  startMs: number;
  endMs: number;
}

export interface TimelineEditStateLike {
  version?: number;
  cuts?: readonly TimelineCutLike[];
  trim?: TimelineTrimLike;
}

export interface FinishedTimelineRange {
  startMs: number;
  endMs: number;
  finishedStartMs: number;
  finishedEndMs: number;
}

export interface FinishedTimelineMap {
  sourceDurationMs: number;
  durationMs: number;
  trim: TimelineTrimLike;
  ranges: FinishedTimelineRange[];
}

export interface FinishedTimelineInterval {
  startMs: number;
  endMs: number;
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Builds the kept source ranges that are concatenated in a finished video. */
export function buildFinishedTimeline(
  sourceDurationMs: number,
  editState?: TimelineEditStateLike | null,
): FinishedTimelineMap {
  const sourceDuration = Math.max(0, finite(sourceDurationMs));
  const rawTrim = editState?.version === 2 ? editState.trim : undefined;
  const trimStart = clamp(finite(rawTrim?.startMs ?? 0), 0, sourceDuration);
  const trimEnd = clamp(finite(rawTrim?.endMs ?? sourceDuration, sourceDuration), trimStart, sourceDuration);
  const trim = { startMs: trimStart, endMs: trimEnd };

  const cuts = (editState?.cuts ?? [])
    .filter((cut) => Number.isFinite(cut.startMs) && Number.isFinite(cut.endMs))
    .map((cut) => ({
      startMs: clamp(cut.startMs, trimStart, trimEnd),
      endMs: clamp(cut.endMs, trimStart, trimEnd),
    }))
    .filter((cut) => cut.endMs > cut.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const mergedCuts: TimelineCutLike[] = [];
  for (const cut of cuts) {
    const previous = mergedCuts.at(-1);
    if (previous && cut.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, cut.endMs);
    } else {
      mergedCuts.push({ ...cut });
    }
  }

  const sourceRanges: TimelineTrimLike[] = [];
  let sourceCursor = trimStart;
  for (const cut of mergedCuts) {
    if (cut.startMs > sourceCursor) sourceRanges.push({ startMs: sourceCursor, endMs: cut.startMs });
    sourceCursor = Math.max(sourceCursor, cut.endMs);
  }
  if (sourceCursor < trimEnd) sourceRanges.push({ startMs: sourceCursor, endMs: trimEnd });

  let finishedCursor = 0;
  const ranges = sourceRanges
    .filter((range) => range.endMs > range.startMs)
    .map((range): FinishedTimelineRange => {
      const length = range.endMs - range.startMs;
      const mapped = {
        ...range,
        finishedStartMs: finishedCursor,
        finishedEndMs: finishedCursor + length,
      };
      finishedCursor += length;
      return mapped;
    });

  return { sourceDurationMs: sourceDuration, durationMs: finishedCursor, trim, ranges };
}

/**
 * Converts a point on the flattened player timeline back to source time.
 * At a cut boundary the next kept range wins, matching forward playback.
 */
export function finishedTimeToSourceMs(finishedTimeMs: number, timeline: FinishedTimelineMap) {
  if (!timeline.ranges.length) return timeline.trim.startMs;
  const finished = clamp(finite(finishedTimeMs), 0, timeline.durationMs);
  for (const range of timeline.ranges) {
    if (finished < range.finishedEndMs) {
      return range.startMs + finished - range.finishedStartMs;
    }
    if (finished === range.finishedEndMs) {
      const next = timeline.ranges.find((candidate) => candidate.finishedStartMs === finished && candidate.startMs >= range.endMs);
      return next?.startMs ?? range.endMs;
    }
  }
  return timeline.ranges.at(-1)!.endMs;
}

/**
 * Converts stored source time for a timed engagement item to finished time.
 * Points trimmed out or inside a cut return null rather than snapping visibly.
 */
export function sourceTimeToFinishedMs(sourceTimeMs: number, timeline: FinishedTimelineMap): number | null {
  const source = finite(sourceTimeMs, Number.NaN);
  if (!Number.isFinite(source)) return null;
  for (const range of timeline.ranges) {
    if (source >= range.startMs && source < range.endMs) {
      return range.finishedStartMs + source - range.startMs;
    }
  }
  const finalRange = timeline.ranges.at(-1);
  if (finalRange && source === finalRange.endMs) return timeline.durationMs;
  return null;
}

/**
 * Intersects a source interval with every kept range and maps each surviving
 * piece to the flattened timeline. A segment spanning a cut therefore yields
 * two pieces; a segment wholly removed by edits yields none.
 */
export function sourceIntervalToFinished(
  sourceStartMs: number,
  sourceEndMs: number,
  timeline: FinishedTimelineMap,
  finishedDurationMs = timeline.durationMs,
): FinishedTimelineInterval[] {
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) return [];
  const duration = clamp(finite(finishedDurationMs, timeline.durationMs), 0, timeline.durationMs);
  const intervals: FinishedTimelineInterval[] = [];
  for (const range of timeline.ranges) {
    const intersectionStart = Math.max(sourceStartMs, range.startMs);
    const intersectionEnd = Math.min(sourceEndMs, range.endMs);
    if (intersectionEnd <= intersectionStart) continue;
    const startMs = clamp(range.finishedStartMs + intersectionStart - range.startMs, 0, duration);
    const endMs = clamp(range.finishedStartMs + intersectionEnd - range.startMs, 0, duration);
    if (endMs > startMs) intervals.push({ startMs, endMs });
  }
  return intervals;
}
