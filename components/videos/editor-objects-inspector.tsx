"use client";

import {
  ArrowDown,
  ArrowUp,
  Circle,
  ImagePlus,
  MessageSquareText,
  MoveRight,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VideoObjectKind, VideoObjectOverlay } from "@/lib/video-edits";

interface EditorObjectsInspectorProps {
  selected?: VideoObjectOverlay;
  durationMs: number;
  onAdd: (kind: Exclude<VideoObjectKind, "image">) => void;
  onUploadGraphic: () => void;
  onPatch: (id: string, patch: Partial<VideoObjectOverlay>) => void;
  onMoveLayer: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
}

function Slider({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void }) {
  return <label className="block space-y-2"><span className="flex items-center justify-between text-xs font-medium text-slate-600"><span>{label}</span><span className="font-mono text-[11px] text-slate-400">{display}</span></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full cursor-pointer accent-primary" /></label>;
}

function TimeInput({ label, valueMs, durationMs, onChange }: { label: string; valueMs: number; durationMs: number; onChange: (value: number) => void }) {
  return <label className="space-y-1 text-xs font-medium text-slate-500"><span>{label}</span><Input type="number" min={0} max={durationMs / 1_000} step={0.1} value={(valueMs / 1_000).toFixed(1)} onChange={(event) => onChange(Math.round(Number(event.target.value) * 1_000))} className="h-9 font-mono text-xs" /></label>;
}

const choices: { kind: Exclude<VideoObjectKind, "image">; label: string; icon: typeof Square }[] = [
  { kind: "rectangle", label: "Box", icon: Square },
  { kind: "ellipse", label: "Circle", icon: Circle },
  { kind: "arrow", label: "Arrow", icon: MoveRight },
  { kind: "callout", label: "Callout", icon: MessageSquareText },
];

export function EditorObjectsInspector({ selected, durationMs, onAdd, onUploadGraphic, onPatch, onMoveLayer, onDelete }: EditorObjectsInspectorProps) {
  return (
    <div className="space-y-5">
      <div><h3 className="text-sm font-bold text-slate-900">Objects</h3><p className="mt-1 text-xs leading-5 text-slate-500">Add a timed shape, callout, or raster graphic, then drag it directly in the preview.</p></div>
      <div className="grid grid-cols-2 gap-2">
        {choices.map(({ kind, label, icon: Icon }) => <Button key={kind} type="button" size="sm" variant="outline" onClick={() => onAdd(kind)}><Icon className="h-4 w-4" /> {label}</Button>)}
        <Button type="button" size="sm" className="col-span-2" onClick={onUploadGraphic}><ImagePlus className="h-4 w-4" /> Import graphic</Button>
      </div>

      {selected ? (
        <div className="space-y-4 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold capitalize text-slate-800">{selected.kind}</p><p className="text-[11px] text-slate-400">Selected object</p></div><div className="flex gap-1"><Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Send object backward" onClick={() => onMoveLayer(selected.id, -1)}><ArrowDown className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Bring object forward" onClick={() => onMoveLayer(selected.id, 1)}><ArrowUp className="h-3.5 w-3.5" /></Button></div></div>

          {(selected.kind === "callout" || selected.kind === "rectangle" || selected.kind === "ellipse") && <div className="space-y-1.5"><Label htmlFor={`object-text-${selected.id}`} className="text-xs text-slate-500">Text</Label><Textarea id={`object-text-${selected.id}`} value={selected.text ?? ""} onChange={(event) => onPatch(selected.id, { text: event.target.value.slice(0, 500) })} rows={3} placeholder="Optional label…" /></div>}

          <div className="grid grid-cols-2 gap-2"><TimeInput label="Start" valueMs={selected.startMs} durationMs={durationMs} onChange={(value) => onPatch(selected.id, { startMs: Math.max(0, Math.min(selected.endMs - 100, value)) })} /><TimeInput label="End" valueMs={selected.endMs} durationMs={durationMs} onChange={(value) => onPatch(selected.id, { endMs: Math.min(durationMs, Math.max(selected.startMs + 100, value)) })} /></div>
          <Slider label="Width" value={selected.width} min={0.04} max={0.9} step={0.01} display={`${Math.round(selected.width * 100)}%`} onChange={(width) => onPatch(selected.id, { width })} />
          <Slider label="Height" value={selected.height} min={0.04} max={0.9} step={0.01} display={`${Math.round(selected.height * 100)}%`} onChange={(height) => onPatch(selected.id, { height })} />
          <Slider label="Horizontal" value={selected.x} min={0} max={1} step={0.01} display={`${Math.round(selected.x * 100)}%`} onChange={(x) => onPatch(selected.id, { x })} />
          <Slider label="Vertical" value={selected.y} min={0} max={1} step={0.01} display={`${Math.round(selected.y * 100)}%`} onChange={(y) => onPatch(selected.id, { y })} />
          <Slider label="Rotation" value={selected.rotation} min={-180} max={180} step={1} display={`${Math.round(selected.rotation)}°`} onChange={(rotation) => onPatch(selected.id, { rotation })} />
          <Slider label="Opacity" value={selected.opacity} min={0.05} max={1} step={0.01} display={`${Math.round(selected.opacity * 100)}%`} onChange={(opacity) => onPatch(selected.id, { opacity })} />

          {selected.kind !== "image" && <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs text-slate-500"><span>Fill</span><Input type="color" value={selected.fill === "transparent" ? "#ffffff" : selected.fill.slice(0, 7)} onChange={(event) => onPatch(selected.id, { fill: event.target.value })} className="h-9 cursor-pointer p-1" /></label><label className="space-y-1.5 text-xs text-slate-500"><span>Stroke</span><Input type="color" value={selected.stroke === "transparent" ? "#6d5bfc" : selected.stroke.slice(0, 7)} onChange={(event) => onPatch(selected.id, { stroke: event.target.value })} className="h-9 cursor-pointer p-1" /></label></div>}
          {selected.kind !== "image" && <Slider label="Stroke width" value={selected.strokeWidth} min={0} max={16} step={1} display={`${selected.strokeWidth}px`} onChange={(strokeWidth) => onPatch(selected.id, { strokeWidth })} />}
          {selected.text !== undefined && <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-xs text-slate-500"><span>Text color</span><Input type="color" value={(selected.textColor ?? "#ffffff").slice(0, 7)} onChange={(event) => onPatch(selected.id, { textColor: event.target.value })} className="h-9 cursor-pointer p-1" /></label><label className="space-y-1.5 text-xs text-slate-500"><span>Text size</span><Input type="number" min={10} max={120} value={selected.fontSize ?? 32} onChange={(event) => onPatch(selected.id, { fontSize: Number(event.target.value) })} className="h-9" /></label></div>}
          <Button type="button" variant="outline" className="w-full text-red-500 hover:text-red-600" onClick={() => onDelete(selected.id)}><Trash2 className="h-4 w-4" /> Delete object</Button>
        </div>
      ) : <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">Choose an object above or select one on the Objects timeline track.</p>}
    </div>
  );
}
