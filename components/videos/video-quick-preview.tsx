"use client";

import type { ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  Loader2,
  PencilLine,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoPlayer } from "@/components/videos/player/video-player";
import type { VideoEditState, VideoZoomEffect } from "@/lib/video-edits";
import { cn } from "@/lib/utils";

export interface VideoQuickPreviewStat {
  label: string;
  value: ReactNode;
}

interface VideoQuickPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  loading?: boolean;
  src?: string;
  screenSrc?: string;
  cameraSrc?: string;
  poster?: string;
  editState?: VideoEditState;
  zoomEffects?: VideoZoomEffect[];
  durationLabel?: string;
  sizeLabel?: string;
  modeLabel?: string;
  stats?: VideoQuickPreviewStat[];
  shareEnabled?: boolean;
  shareLabel?: string;
  onOpenEditor: () => void;
  onOpenViewer?: () => void;
  onCopyShare?: () => void;
  onDelete?: () => void;
  deleteBusy?: boolean;
}

/**
 * A read-only library preview shared by local test mode and the installed app.
 * Editing and owner settings intentionally live in the full-page editor.
 */
export function VideoQuickPreview({
  open,
  onOpenChange,
  title,
  description,
  loading = false,
  src,
  screenSrc,
  cameraSrc,
  poster,
  editState,
  zoomEffects,
  durationLabel,
  sizeLabel,
  modeLabel,
  stats = [],
  shareEnabled = false,
  shareLabel,
  onOpenEditor,
  onOpenViewer,
  onCopyShare,
  onDelete,
  deleteBusy = false,
}: VideoQuickPreviewProps) {
  const facts = [
    durationLabel ? { label: "Duration", value: durationLabel } : null,
    sizeLabel ? { label: "Size", value: sizeLabel } : null,
    modeLabel ? { label: "Recording", value: modeLabel } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 sm:h-[min(92dvh,720px)] sm:max-w-[1080px]">
        <DialogHeader className="border-b border-slate-100 px-6 py-5 pr-14 text-left sm:px-8 sm:py-6 sm:pr-16">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Quick preview</p>
          <DialogTitle className="line-clamp-1 text-2xl font-bold tracking-[-.035em]">
            {title}
          </DialogTitle>
          <DialogDescription className="line-clamp-2 max-w-3xl text-sm leading-6">
            {description || "Preview the finished video, then open the editor for edits and video settings."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden">
          <div className="min-w-0 p-5 sm:p-7 lg:overflow-y-auto">
            {loading || !src ? (
              <div className="grid aspect-video w-full place-items-center rounded-2xl bg-slate-950">
                <Loader2 className="h-7 w-7 animate-spin text-white/70" aria-label="Loading video preview" />
              </div>
            ) : (
              <VideoPlayer
                key={src}
                src={src}
                screenSrc={screenSrc}
                cameraSrc={cameraSrc}
                poster={poster}
                editState={editState}
                zoomEffects={zoomEffects}
                preload="metadata"
                wrapperClassName="rounded-2xl shadow-[0_18px_45px_rgba(22,25,45,.16)]"
              />
            )}

            {facts.length > 0 && (
              <dl className="mt-5 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-100 py-4 text-center">
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0 px-2">
                    <dt className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">{fact.label}</dt>
                    <dd className="mt-1 truncate text-xs font-semibold text-slate-700">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-slate-50/65 p-5 sm:p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <section>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Share status</p>
              <div className="mt-3 flex items-center gap-3">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", shareEnabled ? "bg-emerald-500" : "bg-slate-300")} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{shareEnabled ? "Link enabled" : "Not shared"}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{shareLabel || (shareEnabled ? "Viewer link is ready" : "Enable sharing in the editor")}</p>
                </div>
              </div>
              {shareEnabled && (onOpenViewer || onCopyShare) && (
                <div className="mt-4 flex gap-2">
                  {onOpenViewer && (
                    <Button size="sm" variant="outline" className="flex-1 bg-white" onClick={onOpenViewer}>
                      <ExternalLink className="h-3.5 w-3.5" /> Viewer
                    </Button>
                  )}
                  {onCopyShare && (
                    <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 bg-white" aria-label="Copy share link" onClick={onCopyShare}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </section>

            {stats.length > 0 && (
              <section className="mt-6 border-t border-slate-200 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Performance</p>
                <dl className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-1">
                  {stats.map((stat) => (
                    <div key={stat.label} className="min-w-0 lg:flex lg:items-baseline lg:justify-between lg:gap-3">
                      <dt className="text-[10px] font-medium text-slate-500">{stat.label}</dt>
                      <dd className="mt-1 truncate text-lg font-bold tracking-[-.035em] text-slate-900 lg:mt-0">{stat.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <div className="mt-7 space-y-2 lg:mt-auto lg:pt-8">
              <Button className="h-11 w-full rounded-xl" onClick={onOpenEditor} disabled={loading || !src}>
                <PencilLine className="h-4 w-4" /> Open editor
              </Button>
              <p className="px-2 text-center text-[11px] leading-4 text-slate-400">
                Edit the video and manage details, thumbnails, sharing, and analytics.
              </p>
              {onDelete && (
                <Button variant="ghost" disabled={deleteBusy} className="h-9 w-full rounded-xl text-red-500 hover:bg-red-50 hover:text-red-600" onClick={onDelete}>
                  {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {deleteBusy ? "Deleting…" : "Delete video"}
                </Button>
              )}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
