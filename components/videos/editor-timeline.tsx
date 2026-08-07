"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Box, Camera, Film, Keyboard, Monitor, MousePointerClick, ScanSearch, Scissors, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildVideoTimelineMap,
  formatEditTime,
  sourceTimeToEditedMs,
  type VideoCut,
  type VideoClickOverlay,
  type VideoKeyOverlay,
  type VideoObjectOverlay,
  type VideoTextOverlay,
  type VideoTrim,
  type VideoZoomEffect,
} from "@/lib/video-edits";

export type EditorSelection =
  | { kind: "video"; id: "video" }
  | { kind: "screen"; id: "screen" }
  | { kind: "camera"; id: "camera" }
  | { kind: "cut"; id: string }
  | { kind: "zoom"; id: string }
  | { kind: "text"; id: string }
  | { kind: "object"; id: string }
  | { kind: "click"; id: string }
  | { kind: "key"; id: string }
  | null;

interface EditorTimelineProps {
  durationMs: number;
  currentMs: number;
  trim: VideoTrim;
  cuts: VideoCut[];
  zooms: VideoZoomEffect[];
  texts: VideoTextOverlay[];
  objects: VideoObjectOverlay[];
  clicks: VideoClickOverlay[];
  keys: VideoKeyOverlay[];
  selection: EditorSelection;
  showScreenTrack?: boolean;
  showCameraTrack?: boolean;
  screenTrackAvailable?: boolean;
  cameraTrackAvailable?: boolean;
  cutCreationEnabled?: boolean;
  playbackRef?: RefObject<HTMLVideoElement | null>;
  onSelect: (selection: EditorSelection) => void;
  onSeek: (timeMs: number) => void;
  onCreateCut: (startMs: number, endMs: number) => void;
  onChangeTrim: (startMs: number, endMs: number) => void;
  onMoveCut: (id: string, startMs: number, endMs: number) => void;
  onMoveZoom: (id: string, startMs: number, endMs: number) => void;
  onMoveText: (id: string, startMs: number, endMs: number) => void;
  onMoveObject: (id: string, startMs: number, endMs: number) => void;
  onMoveClick: (id: string, startMs: number, endMs: number) => void;
  onMoveKey: (id: string, startMs: number, endMs: number) => void;
}

type SegmentKind = "cut" | "zoom" | "text" | "object" | "click" | "key";
type LayerKind = "screen" | "camera";

interface TimelineRange {
  startMs: number;
  endMs: number;
}

interface SegmentDragPreview extends TimelineRange {
  kind: SegmentKind;
  id: string;
}

const MIN_RANGE_MS = 100;

function preventNativeDrag(event: React.DragEvent) {
  event.preventDefault();
}

export function EditorTimeline({
  durationMs,
  currentMs,
  trim,
  cuts,
  zooms,
  texts,
  objects,
  clicks,
  keys,
  selection,
  showScreenTrack = true,
  showCameraTrack = false,
  screenTrackAvailable = true,
  cameraTrackAvailable = false,
  cutCreationEnabled = false,
  playbackRef,
  onSelect,
  onSeek,
  onCreateCut,
  onChangeTrim,
  onMoveCut,
  onMoveZoom,
  onMoveText,
  onMoveObject,
  onMoveClick,
  onMoveKey,
}: EditorTimelineProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLSpanElement | null>(null);
  const currentMsRef = useRef(currentMs);
  const [segmentPreview, setSegmentPreview] = useState<SegmentDragPreview | null>(null);
  const [cutPreview, setCutPreview] = useState<TimelineRange | null>(null);
  const [trimPreview, setTrimPreview] = useState<TimelineRange | null>(null);
  const safeDuration = Math.max(1, durationMs);
  const timelineMap = buildVideoTimelineMap(durationMs, cuts, trimPreview ?? trim);
  const editedCurrentMs = sourceTimeToEditedMs(currentMs, timelineMap);

  useEffect(() => {
    currentMsRef.current = currentMs;
  }, [currentMs]);

  useEffect(() => {
    let animationFrame = 0;
    let lastVisualMs = -1;
    let lastLaneWidth = -1;
    let laneWidth = laneRef.current?.clientWidth ?? 0;
    const lane = laneRef.current;
    const resizeObserver = lane && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(([entry]) => {
          laneWidth = entry.contentRect.width;
        })
      : null;

    if (lane && resizeObserver) resizeObserver.observe(lane);

    const renderPlayhead = () => {
      const mediaMs = (playbackRef?.current?.currentTime ?? Number.NaN) * 1_000;
      const visualMs = Math.min(safeDuration, Math.max(0, Number.isFinite(mediaMs) ? mediaMs : currentMsRef.current));
      if (playheadRef.current && laneWidth > 0 && (Math.abs(visualMs - lastVisualMs) >= 0.5 || laneWidth !== lastLaneWidth)) {
        const x = Math.min(Math.max(0, laneWidth - 1), (visualMs / safeDuration) * laneWidth);
        playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
        lastVisualMs = visualMs;
        lastLaneWidth = laneWidth;
      }
      animationFrame = window.requestAnimationFrame(renderPlayhead);
    };

    renderPlayhead();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [playbackRef, safeDuration]);

  const timeFromPointer = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(fraction * safeDuration);
  };

  const seekFromPointer = (clientX: number) => onSeek(timeFromPointer(clientX));

  const scrubTimeline = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    let latestClientX = event.clientX;
    let animationFrame = 0;

    const apply = () => {
      animationFrame = 0;
      seekFromPointer(latestClientX);
    };
    const schedule = (clientX: number) => {
      latestClientX = clientX;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(apply);
    };
    const finish = (clientX?: number) => {
      if (typeof clientX === "number") latestClientX = clientX;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      apply();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    };
    const onMove = (pointer: PointerEvent) => schedule(pointer.clientX);
    const onUp = (pointer: PointerEvent) => finish(pointer.clientX);
    const onCancel = () => finish();

    apply();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  };

  const moveSegment = (
    event: React.PointerEvent,
    kind: SegmentKind,
    id: string,
    startMs: number,
    endMs: number,
    edge: "move" | "start" | "end" = "move"
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect({ kind, id });

    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const originX = event.clientX;
    const originalLength = endMs - startMs;
    let latest = { startMs, endMs };
    let moved = false;

    const rangeAt = (clientX: number): TimelineRange => {
      const delta = ((clientX - originX) / Math.max(1, rect.width)) * safeDuration;
      if (edge === "start") {
        return {
          startMs: Math.max(0, Math.min(endMs - MIN_RANGE_MS, Math.round(startMs + delta))),
          endMs,
        };
      }
      if (edge === "end") {
        return {
          startMs,
          endMs: Math.min(safeDuration, Math.max(startMs + MIN_RANGE_MS, Math.round(endMs + delta))),
        };
      }
      const nextStart = Math.min(safeDuration - originalLength, Math.max(0, Math.round(startMs + delta)));
      return { startMs: nextStart, endMs: nextStart + originalLength };
    };

    const onMove = (pointer: PointerEvent) => {
      moved ||= Math.abs(pointer.clientX - originX) >= 2;
      latest = rangeAt(pointer.clientX);
      setSegmentPreview({ kind, id, ...latest });
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      setSegmentPreview(null);
    };
    const onUp = (pointer: PointerEvent) => {
      if (moved) latest = rangeAt(pointer.clientX);
      finish();
      if (!moved) return;
      if (kind === "cut") onMoveCut(id, latest.startMs, latest.endMs);
      if (kind === "zoom") onMoveZoom(id, latest.startMs, latest.endMs);
      if (kind === "text") onMoveText(id, latest.startMs, latest.endMs);
      if (kind === "object") onMoveObject(id, latest.startMs, latest.endMs);
      if (kind === "click") onMoveClick(id, latest.startMs, latest.endMs);
      if (kind === "key") onMoveKey(id, latest.startMs, latest.endMs);
    };
    const onCancel = () => finish();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  };

  const createCut = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!cutCreationEnabled || event.button !== 0) {
      seekFromPointer(event.clientX);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const originMs = timeFromPointer(event.clientX);
    let latest = { startMs: originMs, endMs: originMs };
    let moved = false;

    const rangeAt = (clientX: number): TimelineRange => {
      const currentMs = timeFromPointer(clientX);
      return {
        startMs: Math.min(originMs, currentMs),
        endMs: Math.max(originMs, currentMs),
      };
    };
    const onMove = (pointer: PointerEvent) => {
      latest = rangeAt(pointer.clientX);
      moved ||= latest.endMs - latest.startMs >= MIN_RANGE_MS;
      setCutPreview(latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      setCutPreview(null);
    };
    const onUp = (pointer: PointerEvent) => {
      latest = rangeAt(pointer.clientX);
      moved ||= latest.endMs - latest.startMs >= MIN_RANGE_MS;
      finish();
      if (moved) onCreateCut(latest.startMs, latest.endMs);
      else onSeek(originMs);
    };
    const onCancel = () => finish();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  };

  const resizeTrim = (event: React.PointerEvent, edge: "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect({ kind: "video", id: "video" });
    const originX = event.clientX;
    const original = { ...trim };
    let latest = original;
    let moved = false;
    const rangeAt = (clientX: number): TimelineRange => {
      const lane = laneRef.current;
      if (!lane) return original;
      const rect = lane.getBoundingClientRect();
      const delta = ((clientX - originX) / Math.max(1, rect.width)) * safeDuration;
      if (edge === "start") return {
        startMs: Math.max(0, Math.min(original.endMs - MIN_RANGE_MS, Math.round(original.startMs + delta))),
        endMs: original.endMs,
      };
      return {
        startMs: original.startMs,
        endMs: Math.min(safeDuration, Math.max(original.startMs + MIN_RANGE_MS, Math.round(original.endMs + delta))),
      };
    };
    const onMove = (pointer: PointerEvent) => {
      moved ||= Math.abs(pointer.clientX - originX) >= 2;
      latest = rangeAt(pointer.clientX);
      setTrimPreview(latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      setTrimPreview(null);
    };
    const onUp = (pointer: PointerEvent) => {
      if (moved) latest = rangeAt(pointer.clientX);
      finish();
      if (moved) onChangeTrim(latest.startMs, latest.endMs);
    };
    const onCancel = () => finish();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  };

  const renderVideoClip = () => {
    const activeTrim = trimPreview ?? trim;
    const left = activeTrim.startMs / safeDuration * 100;
    const width = Math.max(0.2, (activeTrim.endMs - activeTrim.startMs) / safeDuration * 100);
    const selected = selection?.kind === "video";
    return (
      <div role="group" aria-label="Video trim range" className="relative h-10 w-full border-b border-slate-100 bg-slate-100/70" data-timeline-track="video">
        {activeTrim.startMs > 0 && <span aria-hidden className="absolute inset-y-0 left-0 bg-slate-300/55" style={{ width: `${left}%` }} />}
        {activeTrim.endMs < safeDuration && <span aria-hidden className="absolute inset-y-0 right-0 bg-slate-300/55" style={{ width: `${100 - (activeTrim.endMs / safeDuration * 100)}%` }} />}
        <button
          type="button"
          aria-label={`Video from ${formatEditTime(activeTrim.startMs)} to ${formatEditTime(activeTrim.endMs)}`}
          aria-pressed={selected}
          data-timeline-item="video"
          className={cn("absolute inset-y-1 z-10 min-w-8 touch-none select-none overflow-hidden rounded-md border border-indigo-300 bg-indigo-100 text-left text-[10px] font-semibold text-indigo-800 shadow-sm", selected && "ring-2 ring-primary/60 ring-offset-1")}
          style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
          onClick={(event) => { event.stopPropagation(); onSelect({ kind: "video", id: "video" }); }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) seekFromPointer(event.clientX); }}
        >
          <span role="separator" aria-label="Trim start" data-trim-edge="start" className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize bg-indigo-500/65 transition-colors hover:bg-indigo-600" onPointerDown={(event) => resizeTrim(event, "start")} />
          <span className="pointer-events-none block truncate px-4 py-1.5">Final video</span>
          <span role="separator" aria-label="Trim end" data-trim-edge="end" className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize bg-indigo-500/65 transition-colors hover:bg-indigo-600" onPointerDown={(event) => resizeTrim(event, "end")} />
        </button>
      </div>
    );
  };

  const renderSegment = (
    kind: SegmentKind,
    item: { id: string; startMs: number; endMs: number },
    index: number
  ) => {
    const preview = segmentPreview?.kind === kind && segmentPreview.id === item.id ? segmentPreview : item;
    const left = (preview.startMs / safeDuration) * 100;
    const width = Math.max(1.2, ((preview.endMs - preview.startMs) / safeDuration) * 100);
    const selected = selection?.kind === kind && selection.id === item.id;
    const label = kind === "cut" ? `Cut ${index + 1}` : kind === "zoom" ? `Zoom ${index + 1}` : kind === "text" ? `Text ${index + 1}` : kind === "object" ? `Object ${index + 1}` : kind === "click" ? `Click ${index + 1}` : `Keys ${index + 1}`;
    return (
      <button
        key={item.id}
        type="button"
        aria-label={`${label} from ${formatEditTime(preview.startMs)} to ${formatEditTime(preview.endMs)}`}
        aria-pressed={selected}
        data-timeline-item={kind}
        data-item-id={item.id}
        data-selected={selected ? "true" : "false"}
        draggable={false}
        className={cn(
          "absolute inset-y-1 z-10 min-w-5 touch-none select-none overflow-hidden rounded-md border text-left text-[10px] font-semibold shadow-sm will-change-[left,width] active:cursor-grabbing",
          segmentPreview?.kind === kind && segmentPreview.id === item.id ? "cursor-grabbing transition-none" : "cursor-grab transition-[box-shadow]",
          kind === "cut" && "border-red-300 bg-[repeating-linear-gradient(135deg,#fee2e2_0,#fee2e2_6px,#fecaca_6px,#fecaca_12px)] text-red-700",
          kind === "zoom" && "border-violet-400 bg-violet-500 text-white",
          kind === "text" && "border-sky-400 bg-sky-500 text-white",
          kind === "object" && "border-amber-400 bg-amber-400 text-amber-950",
          kind === "click" && "border-rose-400 bg-rose-500 text-white",
          kind === "key" && "border-slate-700 bg-slate-800 text-white",
          selected && "ring-2 ring-slate-950/25 ring-offset-1"
        )}
        style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ kind, id: item.id });
        }}
        onDragStart={preventNativeDrag}
        onPointerDown={(event) => moveSegment(event, kind, item.id, item.startMs, item.endMs)}
      >
        <span
          role="separator"
          aria-label={`Resize start of ${label}`}
          data-resize-edge="start"
          className="absolute inset-y-0 left-0 z-10 w-2.5 cursor-ew-resize bg-black/10 transition-colors hover:bg-black/20"
          onPointerDown={(event) => moveSegment(event, kind, item.id, item.startMs, item.endMs, "start")}
        />
        <span className="pointer-events-none block truncate px-3 py-1.5">{label}</span>
        <span
          role="separator"
          aria-label={`Resize end of ${label}`}
          data-resize-edge="end"
          className="absolute inset-y-0 right-0 z-10 w-2.5 cursor-ew-resize bg-black/10 transition-colors hover:bg-black/20"
          onPointerDown={(event) => moveSegment(event, kind, item.id, item.startMs, item.endMs, "end")}
        />
      </button>
    );
  };

  const renderLayer = (kind: LayerKind, available: boolean) => {
    const selected = selection?.kind === kind;
    const label = kind === "screen" ? "Screen layer" : "Camera layer";
    return (
      <button
        type="button"
        aria-label={available ? `Select ${label.toLowerCase()}` : `${label} unavailable`}
        aria-pressed={selected}
        disabled={!available}
        data-timeline-item={kind}
        data-selected={selected ? "true" : "false"}
        className={cn(
          "absolute inset-x-1 inset-y-1 flex select-none items-center rounded-md border px-2 text-left text-[10px] font-semibold transition",
          kind === "screen" ? "border-slate-300 bg-gradient-to-r from-slate-300 via-slate-200 to-slate-300 text-slate-700" : "border-emerald-300 bg-emerald-100 text-emerald-700",
          selected && "ring-2 ring-primary/60 ring-offset-1",
          !available && "cursor-not-allowed border-dashed opacity-45"
        )}
        onClick={() => {
          if (!available) return;
          if (kind === "screen") onSelect({ kind: "screen", id: "screen" });
          else onSelect({ kind: "camera", id: "camera" });
        }}
      >
        <span className="truncate">{available ? label : `${label} unavailable`}</span>
      </button>
    );
  };

  const layerTracks = [
    ...(showScreenTrack ? [{ kind: "screen" as const, label: "Screen", icon: Monitor, available: screenTrackAvailable }] : []),
    ...(showCameraTrack ? [{ kind: "camera" as const, label: "Camera", icon: Camera, available: cameraTrackAvailable }] : []),
  ];
  const effectTracks = [
    { kind: "cut" as const, label: "Cuts", icon: Scissors },
    { kind: "zoom" as const, label: "Zoom", icon: ScanSearch },
    { kind: "text" as const, label: "Text", icon: Type },
    { kind: "object" as const, label: "Objects", icon: Box },
    { kind: "click" as const, label: "Clicks", icon: MousePointerClick },
    { kind: "key" as const, label: "Keys", icon: Keyboard },
  ];

  const cutPreviewStyle = cutPreview ? {
    left: `${(cutPreview.startMs / safeDuration) * 100}%`,
    width: `${Math.max(0.2, ((cutPreview.endMs - cutPreview.startMs) / safeDuration) * 100)}%`,
  } : undefined;

  return (
    <section className="select-none bg-white" aria-label="Video edit timeline" data-editor-timeline>
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-4">
        <div>
          <span className="text-xs font-bold text-slate-800">Timeline</span>
          <span className="ml-2 text-[11px] text-slate-400">Drag ranges to move them. Use the edge handles to resize.</span>
        </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600" title={`Source ${formatEditTime(currentMs)} of ${formatEditTime(durationMs)}`}>
          {formatEditTime(editedCurrentMs)} / {formatEditTime(timelineMap.durationMs)} final
        </span>
      </div>

      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
        <div className="border-r border-slate-200 bg-slate-50/70">
          <div className="h-7 border-b border-slate-200" />
          <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-3 text-[11px] font-semibold text-slate-500"><Film className="h-3.5 w-3.5" /> Video</div>
          {layerTracks.map(({ kind, label, icon: Icon, available }) => (
            <div key={kind} className={cn("flex h-10 items-center gap-2 border-b border-slate-100 px-3 text-[11px] font-semibold text-slate-500", !available && "opacity-50")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
          ))}
          {effectTracks.map(({ kind, label, icon: Icon }) => (
            <div key={kind} className="flex h-10 items-center gap-2 border-b border-slate-100 px-3 text-[11px] font-semibold text-slate-500">
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
          ))}
        </div>

        <div ref={laneRef} className="relative min-w-0 overflow-hidden">
          <button
            type="button"
            aria-label="Seek edit timeline"
            className="relative block h-7 w-full cursor-ew-resize touch-none select-none border-b border-slate-200 bg-slate-50 text-[9px] text-slate-400"
            onPointerDown={scrubTimeline}
          >
            {[0, 25, 50, 75, 100].map((value) => (
              <span key={value} className="pointer-events-none absolute top-1 -translate-x-1/2 font-mono" style={{ left: `${value}%` }}>
                {formatEditTime((value / 100) * durationMs)}
              </span>
            ))}
          </button>

          {renderVideoClip()}

          {layerTracks.map(({ kind, available }) => (
            <div key={kind} role="group" aria-label={`${kind === "screen" ? "Screen" : "Camera"} timeline track`} data-timeline-track={kind} className="relative block h-10 w-full border-b border-slate-100 bg-slate-50/40">
              {renderLayer(kind, available)}
            </div>
          ))}
          <div
            role="button"
            tabIndex={0}
            aria-label={cutCreationEnabled ? "Drag to create a cut range" : "Seek cut track"}
            data-timeline-track="cut"
            data-cut-creation-enabled={cutCreationEnabled ? "true" : "false"}
            className={cn("relative block h-10 w-full touch-none border-b border-slate-100 bg-white", cutCreationEnabled && "cursor-crosshair bg-red-50/30")}
            onPointerDown={createCut}
          >
            {cutPreview && <span aria-hidden className="pointer-events-none absolute inset-y-1 z-20 rounded-md border border-dashed border-red-500 bg-red-200/70" style={cutPreviewStyle} />}
            {cuts.map((item, index) => renderSegment("cut", item, index))}
          </div>
          <div role="button" tabIndex={0} aria-label="Seek zoom track" data-timeline-track="zoom" className="relative block h-10 w-full border-b border-slate-100 bg-slate-50/40" onPointerDown={(event) => seekFromPointer(event.clientX)}>
            {zooms.map((item, index) => renderSegment("zoom", item, index))}
          </div>
          <div role="button" tabIndex={0} aria-label="Seek text track" data-timeline-track="text" className="relative block h-10 w-full border-b border-slate-100 bg-white" onPointerDown={(event) => seekFromPointer(event.clientX)}>
            {texts.map((item, index) => renderSegment("text", item, index))}
          </div>
          <div role="button" tabIndex={0} aria-label="Seek objects track" data-timeline-track="object" className="relative block h-10 w-full border-b border-slate-100 bg-slate-50/40" onPointerDown={(event) => seekFromPointer(event.clientX)}>
            {objects.map((item, index) => renderSegment("object", item, index))}
          </div>
          <div role="button" tabIndex={0} aria-label="Seek clicks track" data-timeline-track="click" className="relative block h-10 w-full border-b border-slate-100 bg-white" onPointerDown={(event) => seekFromPointer(event.clientX)}>
            {clicks.map((item, index) => renderSegment("click", item, index))}
          </div>
          <div role="button" tabIndex={0} aria-label="Seek keys track" data-timeline-track="key" className="relative block h-10 w-full border-b border-slate-100 bg-slate-50/40" onPointerDown={(event) => seekFromPointer(event.clientX)}>
            {keys.map((item, index) => renderSegment("key", item, index))}
          </div>

          <span
            ref={playheadRef}
            data-timeline-playhead
            className="pointer-events-none absolute bottom-0 left-0 top-0 z-30 w-px bg-red-500 shadow-[0_0_0_1px_rgba(255,255,255,.65)] will-change-transform"
            style={{ transform: "translate3d(0, 0, 0)" }}
          >
            <span className="absolute -left-1 top-0 h-2 w-2 rotate-45 bg-red-500" />
          </span>
        </div>
      </div>
    </section>
  );
}
