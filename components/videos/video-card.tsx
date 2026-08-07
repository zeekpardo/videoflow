"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Check, Play, Eye, Monitor, MonitorSmartphone, Video as VideoIcon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export interface VideoCardData {
  _id: Id<"videos">;
  title: string;
  durationMs: number;
  mode: "screen" | "screen_camera" | "camera";
  visibility: "private" | "public";
  shareToken?: string;
  viewCount: number;
  transcriptStatus: "none" | "pending" | "done" | "error" | "too_large";
  createdAt: number;
  thumbnailUrl: string | null;
}

function fmtDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relTime(ts: number) {
  const d = Date.now() - ts;
  const days = Math.floor(d / 86_400_000);
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const MODE_ICON = {
  screen: Monitor,
  screen_camera: MonitorSmartphone,
  camera: VideoIcon,
} as const;

export function VideoCard({ video, onPreview, selected = false, onSelectedChange }: { video: VideoCardData; onPreview: () => void; selected?: boolean; onSelectedChange?: (selected: boolean) => void }) {
  const ModeIcon = MODE_ICON[video.mode];
  return (
    <div className="relative">
      {onSelectedChange && <button type="button" aria-label={`${selected ? "Deselect" : "Select"} ${video.title}`} onClick={() => onSelectedChange(!selected)} className={`absolute right-2.5 top-2.5 z-20 grid h-7 w-7 place-items-center rounded-lg border shadow-sm transition ${selected ? "border-primary bg-primary text-white" : "border-white/80 bg-white/90 text-transparent hover:text-slate-400"}`}><Check className="h-4 w-4" /></button>}
      <button type="button" onClick={onPreview} className={`block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${selected ? "ring-2 ring-primary ring-offset-2" : ""}`} aria-label={`Quick preview ${video.title}`}>
      <Card className="group cursor-pointer overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_45px_rgba(35,42,80,.10)]">
        <div className="relative aspect-video overflow-hidden bg-[#eef1f7]">
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_65%_15%,rgba(109,91,252,.14),transparent_48%)]">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/80 text-primary shadow-sm"><ModeIcon className="h-6 w-6" /></span>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <div className="rounded-full bg-primary p-3 shadow-xl shadow-primary/25">
              <Play className="h-5 w-5 fill-current text-white" />
            </div>
          </div>
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {fmtDuration(video.durationMs)}
          </span>
          {video.visibility === "public" && (
            <Badge className="absolute left-2.5 top-2.5 border border-white/60 bg-white/90 text-slate-600 shadow-sm backdrop-blur" variant="secondary">
              Shared
            </Badge>
          )}
        </div>
        <div className="p-4">
          <p className="line-clamp-1 text-sm font-semibold text-slate-900">{video.title}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" /> {video.viewCount}
            </span>
            <span>{relTime(video.createdAt)}</span>
          </div>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary opacity-80 transition group-hover:opacity-100">
            <Play className="h-3 w-3 fill-current" /> Quick preview
          </span>
        </div>
      </Card>
      </button>
    </div>
  );
}
