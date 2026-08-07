"use client";

import { ScanSearch, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEditTime, type VideoZoomEffect } from "@/lib/video-edits";
import { cn } from "@/lib/utils";

export type ZoomPlacement =
  | { mode: "create" }
  | { mode: "retarget"; id: string }
  | null;

interface EditorZoomInspectorProps {
  activeMs: number;
  durationMs: number;
  placement: ZoomPlacement;
  selected?: VideoZoomEffect;
  onStartCreate: () => void;
  onStartRetarget: (id: string) => void;
  onCancelPlacement: () => void;
  onPatch: (id: string, patch: Partial<VideoZoomEffect>) => void;
  onDelete: (id: string) => void;
}

function TimeField({
  label,
  valueMs,
  durationMs,
  onChange,
}: {
  label: string;
  valueMs: number;
  durationMs: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-500">
      <span>{label}</span>
      <Input
        type="number"
        min={0}
        max={durationMs / 1_000}
        step={0.1}
        value={(valueMs / 1_000).toFixed(1)}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * 1_000))}
        className="h-9 font-mono text-xs"
      />
    </label>
  );
}

export function EditorZoomInspector({
  activeMs,
  durationMs,
  placement,
  selected,
  onStartCreate,
  onStartRetarget,
  onCancelPlacement,
  onPatch,
  onDelete,
}: EditorZoomInspectorProps) {
  const retargetingSelected = placement?.mode === "retarget" && placement.id === selected?.id;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Zoom a detail</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Put the playhead where the zoom should begin, choose its focus in the preview, then resize the purple range on the timeline.
        </p>
      </div>

      {placement ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3" role="status">
          <p className="flex items-center gap-2 text-xs font-bold text-primary">
            <Target className="h-4 w-4" />
            {placement.mode === "create" ? "Choose the zoom focus" : "Choose a new focus point"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Click the exact point in the video preview that should remain centered.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3 w-full bg-white" onClick={onCancelPlacement}>
            Cancel focus selection
          </Button>
        </div>
      ) : (
        <Button type="button" className="w-full" onClick={onStartCreate}>
          <ScanSearch className="h-4 w-4" /> Add zoom at {formatEditTime(activeMs)}
        </Button>
      )}

      {selected ? (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-800">Selected zoom</p>
              <p className="mt-1 font-mono text-[10px] text-slate-400">
                {formatEditTime(selected.startMs)}–{formatEditTime(selected.endMs)} · focus {Math.round(selected.x * 100)}%, {Math.round(selected.y * 100)}%
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("h-8 shrink-0 text-[11px]", retargetingSelected && "border-primary text-primary")}
              onClick={() => retargetingSelected ? onCancelPlacement() : onStartRetarget(selected.id)}
            >
              <Target className="h-3.5 w-3.5" /> {retargetingSelected ? "Cancel" : "Change focus"}
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">Magnification</p>
            <div className="grid grid-cols-3 gap-2">
              {[1.5, 2, 2.5].map((scale) => (
                <button
                  key={scale}
                  type="button"
                  aria-label={`Set zoom to ${scale.toFixed(1)} times`}
                  onClick={() => onPatch(selected.id, { scale })}
                  className={cn(
                    "h-9 rounded-lg border text-xs font-bold transition",
                    Math.abs(selected.scale - scale) < 0.01
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-slate-200 text-slate-600 hover:border-primary/30"
                  )}
                >
                  {scale.toFixed(1)}×
                </button>
              ))}
            </div>
            <label className="mt-3 block space-y-2">
              <span className="flex items-center justify-between text-xs font-medium text-slate-600">
                <span>Fine tune</span>
                <span className="font-mono text-[11px] text-slate-400">{selected.scale.toFixed(1)}×</span>
              </span>
              <input
                aria-label="Zoom magnification"
                type="range"
                min={1.2}
                max={3}
                step={0.1}
                value={selected.scale}
                onChange={(event) => onPatch(selected.id, { scale: Number(event.target.value) })}
                className="h-1.5 w-full cursor-pointer accent-primary"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TimeField
              label="Start"
              valueMs={selected.startMs}
              durationMs={durationMs}
              onChange={(value) => onPatch(selected.id, { startMs: Math.min(selected.endMs - 100, Math.max(0, value)) })}
            />
            <TimeField
              label="End"
              valueMs={selected.endMs}
              durationMs={durationMs}
              onChange={(value) => onPatch(selected.id, { endMs: Math.max(selected.startMs + 100, Math.min(durationMs, value)) })}
            />
          </div>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
            Tip: drag the purple block to move it, or drag either edge to change how long the zoom lasts.
          </p>

          <Button type="button" variant="outline" className="w-full text-red-500" onClick={() => onDelete(selected.id)}>
            <Trash2 className="h-4 w-4" /> Delete zoom
          </Button>
        </div>
      ) : (
        <ol className="space-y-2 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500">
          <li><strong className="text-slate-700">1.</strong> Move the red playhead to the moment you want.</li>
          <li><strong className="text-slate-700">2.</strong> Click Add zoom, then click the detail in the preview.</li>
          <li><strong className="text-slate-700">3.</strong> Drag or resize the purple timeline block to adjust it.</li>
        </ol>
      )}
    </div>
  );
}
