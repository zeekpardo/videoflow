"use client";

import { Circle, FlipHorizontal2, SquareRoundCorner } from "lucide-react";
import type { BubbleConfig } from "@/components/videos/use-media-recorder";
import { cn } from "@/lib/utils";

interface CameraBubbleControlsProps {
  bubble: BubbleConfig;
  onChange: (patch: Partial<BubbleConfig>) => void;
}

const positions = [
  { label: "Top left", short: "↖", cx: 0.13, cy: 0.18 },
  { label: "Top right", short: "↗", cx: 0.87, cy: 0.18 },
  { label: "Bottom left", short: "↙", cx: 0.13, cy: 0.82 },
  { label: "Bottom right", short: "↘", cx: 0.87, cy: 0.82 },
] as const;

const sizes = [
  { label: "Small", short: "S", d: 0.18 },
  { label: "Medium", short: "M", d: 0.26 },
  { label: "Large", short: "L", d: 0.34 },
] as const;

export function CameraBubbleControls({ bubble, onChange }: CameraBubbleControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
      <div className="flex items-center gap-2"><span className="font-semibold text-slate-500">Position</span><div className="flex gap-1">{positions.map((position) => { const active = Math.abs(bubble.cx - position.cx) < 0.06 && Math.abs(bubble.cy - position.cy) < 0.06; return <button key={position.label} type="button" onClick={() => onChange({ cx: position.cx, cy: position.cy })} className={cn("grid h-8 w-8 place-items-center rounded-lg border text-sm transition", active ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500 hover:border-primary/30")} title={position.label} aria-label={position.label}>{position.short}</button>; })}</div></div>
      <div className="flex items-center gap-2"><span className="font-semibold text-slate-500">Size</span><div className="flex gap-1">{sizes.map((size) => <button key={size.label} type="button" onClick={() => onChange({ d: size.d })} className={cn("grid h-8 w-8 place-items-center rounded-lg border text-[11px] font-bold transition", Math.abs(bubble.d - size.d) < 0.02 ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500 hover:border-primary/30")} title={size.label} aria-label={`${size.label} camera bubble`}>{size.short}</button>)}</div></div>
      <div className="flex items-center gap-2"><span className="font-semibold text-slate-500">Shape</span><button type="button" onClick={() => onChange({ shape: "circle" })} className={cn("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 transition", bubble.shape === "circle" ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500 hover:border-primary/30")}><Circle className="h-3.5 w-3.5" /> Circle</button><button type="button" onClick={() => onChange({ shape: "square" })} className={cn("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 transition", bubble.shape === "square" ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500 hover:border-primary/30")}><SquareRoundCorner className="h-3.5 w-3.5" /> Square</button></div>
      <button type="button" onClick={() => onChange({ mirror: !bubble.mirror })} className={cn("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-semibold transition", bubble.mirror ? "border-primary bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-500 hover:border-primary/30")}><FlipHorizontal2 className="h-3.5 w-3.5" /> Mirror</button>
    </div>
  );
}
