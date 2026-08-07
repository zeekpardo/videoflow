"use client";

import {
  activeVideoClicks,
  activeVideoKeys,
  activeVideoObjects,
} from "@/lib/video-overlay-render";
import type { VideoEditStateV2, VideoObjectOverlay } from "@/lib/video-edits";
import { cn } from "@/lib/utils";

interface VideoOverlayLayerProps {
  editState: VideoEditStateV2;
  sourceTimeMs: number;
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  selectedObjectId?: string;
  objectEditActive?: boolean;
  onSelectObject?: (id: string) => void;
  onObjectMove?: (id: string, point: { x: number; y: number }) => void;
  onObjectMoveEnd?: (id: string, point: { x: number; y: number }) => void;
}

function objectBorderRadius(kind: VideoObjectOverlay["kind"]) {
  if (kind === "ellipse") return "9999px";
  if (kind === "rectangle" || kind === "callout") return "12%";
  return undefined;
}

export function VideoOverlayLayer({
  editState,
  sourceTimeMs,
  graphicUrls = {},
  selectedObjectId,
  objectEditActive = false,
  onSelectObject,
  onObjectMove,
  onObjectMoveEnd,
}: VideoOverlayLayerProps) {
  const objects = activeVideoObjects(editState.objects, sourceTimeMs);
  const clicks = editState.interactions.clicksEnabled
    ? activeVideoClicks(editState.interactions.clicks, sourceTimeMs)
    : [];
  const keys = editState.interactions.keysEnabled
    ? activeVideoKeys(editState.interactions.keys, sourceTimeMs)
    : [];

  const beginMove = (event: React.PointerEvent<HTMLButtonElement>, item: VideoObjectOverlay) => {
    if (!objectEditActive || !onObjectMove) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage) return;
    const point = (clientX: number, clientY: number) => ({
      x: Math.min(1, Math.max(0, (clientX - stage.left) / Math.max(1, stage.width))),
      y: Math.min(1, Math.max(0, (clientY - stage.top) / Math.max(1, stage.height))),
    });
    let latest = point(event.clientX, event.clientY);
    onSelectObject?.(item.id);
    onObjectMove(item.id, latest);
    const move = (pointer: PointerEvent) => {
      latest = point(pointer.clientX, pointer.clientY);
      onObjectMove(item.id, latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      onObjectMoveEnd?.(item.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[13] overflow-hidden" data-video-overlay-layer>
      {objects.map((item) => {
        const selected = objectEditActive && selectedObjectId === item.id;
        const graphicUrl = item.assetId ? graphicUrls[item.assetId] : undefined;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={`Select ${item.kind} overlay`}
            data-video-object={item.kind}
            data-object-id={item.id}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 touch-none overflow-visible text-center",
              objectEditActive && "pointer-events-auto cursor-move",
              selected && "ring-2 ring-primary ring-offset-2 ring-offset-transparent",
            )}
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              width: `${item.width * 100}%`,
              height: `${item.height * 100}%`,
              transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
              opacity: item.opacity,
              zIndex: item.zIndex,
              borderRadius: objectBorderRadius(item.kind),
              borderWidth: item.kind === "arrow" || item.kind === "image" ? 0 : `${item.strokeWidth}px`,
              borderColor: item.stroke,
              background: item.kind === "arrow" || item.kind === "image" ? "transparent" : item.fill,
            }}
            onClick={(event) => {
              if (!objectEditActive) return;
              event.preventDefault();
              event.stopPropagation();
              onSelectObject?.(item.id);
            }}
            onPointerDown={(event) => beginMove(event, item)}
          >
            {item.kind === "image" && graphicUrl && (
              // Raster-only inputs are validated before they reach this layer.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={graphicUrl} alt="" draggable={false} className="h-full w-full select-none object-contain" />
            )}
            {item.kind === "arrow" && (
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
                <path d="M 2 20 L 94 20 M 72 3 L 96 20 L 72 37" fill="none" stroke={item.stroke === "transparent" ? item.fill : item.stroke} strokeWidth={Math.max(2, item.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {item.text && item.kind !== "image" && item.kind !== "arrow" && (
              <span
                className="flex h-full w-full items-center justify-center whitespace-pre-wrap px-[8%] font-bold leading-tight"
                style={{ color: item.textColor ?? "#ffffff", fontSize: `${item.fontSize ?? 32}px` }}
              >
                {item.text}
              </span>
            )}
            {item.kind === "callout" && (
              <span
                aria-hidden
                className="absolute bottom-0 right-[12%] h-[18%] w-[18%] translate-y-[42%] rotate-45 border-b border-r"
                style={{ background: item.fill, borderColor: item.stroke, borderWidth: `0 ${item.strokeWidth}px ${item.strokeWidth}px 0` }}
              />
            )}
          </button>
        );
      })}

      {clicks.map((item) => {
        const progress = Math.min(1, Math.max(0, (sourceTimeMs - item.startMs) / Math.max(1, item.endMs - item.startMs)));
        return (
          <span
            key={item.id}
            data-click-overlay
            className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              width: `${Math.max(1.2, item.size / 10) * (0.55 + progress * 0.65)}%`,
              borderColor: item.color,
              background: `${item.color}33`,
              opacity: 1 - progress * 0.8,
            }}
          />
        );
      })}

      {keys.map((item) => (
        <kbd
          key={item.id}
          data-key-overlay
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/30 bg-slate-950/90 px-3 py-2 font-mono text-sm font-bold text-white shadow-xl backdrop-blur"
          style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
        >
          {item.label}
        </kbd>
      ))}
    </div>
  );
}
