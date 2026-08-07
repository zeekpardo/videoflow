"use client";

import { Keyboard, MousePointerClick, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { VideoClickOverlay, VideoInteractionSettings, VideoKeyOverlay } from "@/lib/video-edits";

export type InteractionSelection =
  | { kind: "click"; item: VideoClickOverlay }
  | { kind: "key"; item: VideoKeyOverlay };

interface EditorInteractionsInspectorProps {
  settings: VideoInteractionSettings;
  selected?: InteractionSelection;
  durationMs: number;
  clickPlacementActive?: boolean;
  onToggleClicks: (enabled: boolean) => void;
  onToggleKeys: (enabled: boolean) => void;
  onStartClickPlacement: () => void;
  onAddKey: () => void;
  onPatchClick: (id: string, patch: Partial<VideoClickOverlay>) => void;
  onPatchKey: (id: string, patch: Partial<VideoKeyOverlay>) => void;
  onDelete: (kind: "click" | "key", id: string) => void;
}

function TimeInput({ label, valueMs, durationMs, onChange }: { label: string; valueMs: number; durationMs: number; onChange: (value: number) => void }) {
  return <label className="space-y-1 text-xs font-medium text-slate-500"><span>{label}</span><Input type="number" min={0} max={durationMs / 1_000} step={0.1} value={(valueMs / 1_000).toFixed(1)} onChange={(event) => onChange(Math.round(Number(event.target.value) * 1_000))} className="h-9 font-mono text-xs" /></label>;
}

function ToggleRow({ icon, title, description, checked, onChange }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between gap-3 py-1.5"><div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">{icon}</span><div><p className="text-xs font-semibold text-slate-800">{title}</p><p className="text-[11px] text-slate-400">{description}</p></div></div><Switch aria-label={title} checked={checked} onCheckedChange={onChange} /></div>;
}

export function EditorInteractionsInspector({ settings, selected, durationMs, clickPlacementActive = false, onToggleClicks, onToggleKeys, onStartClickPlacement, onAddKey, onPatchClick, onPatchKey, onDelete }: EditorInteractionsInspectorProps) {
  return (
    <div className="space-y-5">
      <div><h3 className="text-sm font-bold text-slate-900">Clicks & keys</h3><p className="mt-1 text-xs leading-5 text-slate-500">Add manual click pulses and keyboard badges. Automatic capture requires an extension or desktop helper.</p></div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <ToggleRow icon={<MousePointerClick className="h-4 w-4" />} title="Show click markers" description="Display saved click pulses" checked={settings.clicksEnabled} onChange={onToggleClicks} />
        <ToggleRow icon={<Keyboard className="h-4 w-4" />} title="Show key badges" description="Display saved typing badges" checked={settings.keysEnabled} onChange={onToggleKeys} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant={clickPlacementActive ? "default" : "outline"} onClick={onStartClickPlacement}><MousePointerClick className="h-4 w-4" /> {clickPlacementActive ? "Click preview…" : "Add click"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onAddKey}><Keyboard className="h-4 w-4" /> Add keys</Button>
      </div>

      {selected ? <div className="space-y-4 border-t border-slate-100 pt-5">
        <div><p className="text-xs font-bold text-slate-800">{selected.kind === "click" ? "Click marker" : "Keyboard badge"}</p><p className="text-[11px] text-slate-400">Timed manual overlay</p></div>
        {selected.kind === "key" && <label className="space-y-1.5 text-xs font-medium text-slate-500"><span>Keys shown</span><Input value={selected.item.label} maxLength={80} onChange={(event) => onPatchKey(selected.item.id, { label: event.target.value.slice(0, 80) })} placeholder="⌘ K" /></label>}
        <div className="grid grid-cols-2 gap-2"><TimeInput label="Start" valueMs={selected.item.startMs} durationMs={durationMs} onChange={(value) => selected.kind === "click" ? onPatchClick(selected.item.id, { startMs: Math.max(0, Math.min(selected.item.endMs - 100, value)) }) : onPatchKey(selected.item.id, { startMs: Math.max(0, Math.min(selected.item.endMs - 100, value)) })} /><TimeInput label="End" valueMs={selected.item.endMs} durationMs={durationMs} onChange={(value) => selected.kind === "click" ? onPatchClick(selected.item.id, { endMs: Math.min(durationMs, Math.max(selected.item.startMs + 100, value)) }) : onPatchKey(selected.item.id, { endMs: Math.min(durationMs, Math.max(selected.item.startMs + 100, value)) })} /></div>
        <label className="block space-y-2"><span className="flex items-center justify-between text-xs font-medium text-slate-600"><span>Horizontal</span><span className="font-mono text-[11px] text-slate-400">{Math.round(selected.item.x * 100)}%</span></span><input type="range" min={0} max={1} step={0.01} value={selected.item.x} onChange={(event) => selected.kind === "click" ? onPatchClick(selected.item.id, { x: Number(event.target.value) }) : onPatchKey(selected.item.id, { x: Number(event.target.value) })} className="h-1.5 w-full accent-primary" /></label>
        <label className="block space-y-2"><span className="flex items-center justify-between text-xs font-medium text-slate-600"><span>Vertical</span><span className="font-mono text-[11px] text-slate-400">{Math.round(selected.item.y * 100)}%</span></span><input type="range" min={0} max={1} step={0.01} value={selected.item.y} onChange={(event) => selected.kind === "click" ? onPatchClick(selected.item.id, { y: Number(event.target.value) }) : onPatchKey(selected.item.id, { y: Number(event.target.value) })} className="h-1.5 w-full accent-primary" /></label>
        {selected.kind === "click" && <><label className="space-y-1.5 text-xs font-medium text-slate-500"><span>Color</span><Input type="color" value={selected.item.color.slice(0, 7)} onChange={(event) => onPatchClick(selected.item.id, { color: event.target.value })} className="h-9 cursor-pointer p-1" /></label><label className="block space-y-2"><span className="flex items-center justify-between text-xs font-medium text-slate-600"><span>Pulse size</span><span className="font-mono text-[11px] text-slate-400">{selected.item.size}px</span></span><input type="range" min={12} max={120} step={1} value={selected.item.size} onChange={(event) => onPatchClick(selected.item.id, { size: Number(event.target.value) })} className="h-1.5 w-full accent-primary" /></label></>}
        <Button type="button" variant="outline" className="w-full text-red-500 hover:text-red-600" onClick={() => onDelete(selected.kind, selected.item.id)}><Trash2 className="h-4 w-4" /> Delete overlay</Button>
      </div> : <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">Add an overlay or select one on its timeline track to edit timing and placement.</p>}
    </div>
  );
}
