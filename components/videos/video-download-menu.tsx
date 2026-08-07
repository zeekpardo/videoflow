"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clapperboard,
  Download,
  FileJson,
  Layers3,
  Loader2,
  Monitor,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { VideoEditState, VideoTextOverlay, VideoZoomEffect } from "@/lib/video-edits";
import {
  downloadProjectManifest,
  downloadUrl,
  editedExportSupport,
  exportEditedWebm,
  safeVideoFilename,
  triggerBlobDownload,
  type ExportResolutionPreset,
} from "@/lib/video-export";
import { cn } from "@/lib/utils";
import { videoFileExtension } from "@/lib/media-format";

interface VideoDownloadMenuProps {
  title: string;
  mode: "screen" | "screen_camera" | "camera";
  durationMs: number;
  primarySrc: string;
  primaryMimeType?: string | null;
  screenSrc?: string | null;
  cameraSrc?: string | null;
  /** A current flattened rendition can be downloaded without a second encode. */
  finishedSrc?: string | null;
  finishedMimeType?: string | null;
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  project: { editState: VideoEditState; zoomEffects: VideoZoomEffect[] };
  supplementalTextOverlays?: readonly VideoTextOverlay[];
  scope?: "owner" | "viewer";
  trigger?: React.ReactNode;
  triggerClassName?: string;
  onAnalyticsEvent?: (eventName: "export_started" | "export_completed" | "export_failed", properties?: Record<string, string | number | boolean | null>) => void;
}

type DownloadState =
  | { kind: "idle" }
  | { kind: "working"; action: string; progress?: number }
  | { kind: "complete"; action: string }
  | { kind: "error"; message: string };

interface DownloadChoiceProps {
  icon: typeof Download;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}

function DownloadChoice({ icon: Icon, title, description, badge, disabled, onClick }: DownloadChoiceProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-left transition hover:border-primary/30 hover:bg-primary/[.035] disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 transition group-hover:bg-primary/10 group-hover:text-primary"><Icon className="h-4.5 w-4.5" /></span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">{title}{badge && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-primary">{badge}</span>}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span>
      <Download className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-primary" />
    </button>
  );
}

function percent(value: number) {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function VideoDownloadMenu({
  title,
  mode,
  durationMs,
  primarySrc,
  primaryMimeType,
  screenSrc,
  cameraSrc,
  finishedSrc,
  finishedMimeType,
  graphicUrls,
  project,
  supplementalTextOverlays,
  scope = "owner",
  trigger,
  triggerClassName,
  onAnalyticsEvent,
}: VideoDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DownloadState>({ kind: "idle" });
  const [support, setSupport] = useState<{ supported: boolean; reason?: string }>({ supported: false, reason: "Checking browser support…" });
  const [resolution, setResolution] = useState<ExportResolutionPreset>("native");
  const controllerRef = useRef<AbortController | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const base = safeVideoFilename(title);
  const busy = state.kind === "working";

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, []);

  const finishAction = (action: string) => {
    setState({ kind: "complete", action });
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = window.setTimeout(() => setState((current) => current.kind === "complete" ? { kind: "idle" } : current), 2_000);
  };

  const run = async (action: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "working", action });
    onAnalyticsEvent?.("export_started", { action, resolution });
    try {
      await work(controller.signal);
      finishAction(action);
      toast.success(`${action} downloaded`);
      onAnalyticsEvent?.("export_completed", { action, resolution });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") setState({ kind: "idle" });
      else {
        const message = caught instanceof Error ? caught.message : "The download could not be prepared.";
        setState({ kind: "error", message });
        toast.error(message);
        onAnalyticsEvent?.("export_failed", { action, resolution, error: message });
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const exportEdited = () => void run("Edited video", async (signal) => {
    if (finishedSrc) {
      await downloadUrl(finishedSrc, `${base}-edited.${finishedMimeType?.startsWith("video/mp4") ? "mp4" : "webm"}`, signal);
      return;
    }
    const useSeparateLayers = mode !== "screen_camera" || (!!screenSrc && !!cameraSrc);
    const blob = await exportEditedWebm({
      primarySrc,
      screenSrc: useSeparateLayers ? screenSrc ?? undefined : undefined,
      cameraSrc: useSeparateLayers ? cameraSrc ?? undefined : undefined,
      durationMs,
      editState: project.editState,
      zoomEffects: project.zoomEffects,
      supplementalTextOverlays,
      graphicUrls,
      resolution,
      signal,
      onProgress: ({ progress }) => setState({ kind: "working", action: "Edited video", progress }),
    });
    if (signal.aborted) return;
    triggerBlobDownload(blob, `${base}-edited.${videoFileExtension(blob.type)}`);
  });

  const sourceDownload = (label: string, source: string, suffix: string) => void run(label, async (signal) => {
    await downloadUrl(source, `${base}-${suffix}.${videoFileExtension(primaryMimeType)}`, signal);
  });

  const projectDownload = () => {
    downloadProjectManifest({
      title,
      mode,
      durationMs,
      editState: project.editState,
      zoomEffects: project.zoomEffects,
      hasScreenLayer: !!screenSrc,
      hasCameraLayer: !!cameraSrc,
      sourceMimeType: primaryMimeType ?? undefined,
    });
    finishAction("Edit project");
    toast.success("Edit project downloaded");
    onAnalyticsEvent?.("export_completed", { action: "Edit project", resolution: "manifest" });
  };

  const changeOpen = (next: boolean) => {
    if (!next) controllerRef.current?.abort();
    if (next) setSupport(editedExportSupport());
    if (next && state.kind === "error") setState({ kind: "idle" });
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" variant="outline" className={cn("h-9", triggerClassName)}><Download className="h-3.5 w-3.5" /> Download</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto rounded-2xl border-slate-200 bg-white p-0 text-slate-950">
        <DialogHeader className="border-b border-slate-100 px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2 text-xl"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Download className="h-4 w-4" /></span>Download video</DialogTitle>
          <DialogDescription className="leading-5">{scope === "owner" ? "Choose the finished video, untouched source files, or a reusable edit project." : "Create the finished version with the creator’s cuts, layout, text, and zoom effects applied."}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 py-5">
          {!finishedSrc && <div>
            <div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-xs font-bold text-slate-900">Finished quality</p><p className="mt-0.5 text-[11px] text-slate-500">Full resolution uses the captured screen or video pixels.</p></div></div>
            <div role="radiogroup" aria-label="Edited video resolution" className="grid grid-cols-3 gap-2">
              {([
                ["native", "Full resolution", "Source · up to 8K"],
                ["1080p", "1080p", "Balanced size"],
                ["720p", "720p", "Smaller file"],
              ] as const).map(([value, label, description]) => (
                <button key={value} type="button" role="radio" aria-checked={resolution === value} disabled={busy} onClick={() => setResolution(value)} className={cn("rounded-xl border px-2.5 py-2.5 text-left transition disabled:opacity-50", resolution === value ? "border-primary bg-primary/[.06] ring-1 ring-primary/20" : "border-slate-200 hover:border-slate-300")}>
                  <span className={cn("block text-xs font-bold", resolution === value ? "text-primary" : "text-slate-800")}>{label}</span><span className="mt-0.5 block text-[9px] leading-4 text-slate-400">{description}</span>
                </button>
              ))}
            </div>
            {resolution === "native" && durationMs >= 5 * 60_000 && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] leading-4 text-amber-800">Long full-resolution exports can use substantial browser memory. Choose 1080p if your device slows down.</p>}
          </div>}
          <DownloadChoice
            icon={Clapperboard}
            title="Edited WebM"
            badge="Recommended"
            description={finishedSrc ? "Download the creator’s current published file without re-rendering it." : support.supported ? `${resolution === "native" ? "Full-resolution" : resolution} finished video. Rendering takes about as long as the recording.` : support.reason ?? "Edited export is unavailable in this browser."}
            disabled={(!finishedSrc && !support.supported) || busy}
            onClick={exportEdited}
          />

          {scope === "owner" && <>
            <div className="flex items-center gap-3 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400"><span className="h-px flex-1 bg-slate-100" />Source files<span className="h-px flex-1 bg-slate-100" /></div>
            <DownloadChoice icon={Scissors} title="Original recording" description="The untouched combined recording with its original mixed audio." disabled={busy} onClick={() => sourceDownload("Original recording", primarySrc, "original")} />
            {screenSrc && <DownloadChoice icon={Monitor} title="Screen source" description="The untouched shared-screen layer. Video only; use the original for audio." disabled={busy} onClick={() => sourceDownload("Screen source", screenSrc, "screen")} />}
            {cameraSrc && <DownloadChoice icon={Camera} title="Webcam source" description="The untouched webcam layer. Video only; use the original for audio." disabled={busy} onClick={() => sourceDownload("Webcam source", cameraSrc, "camera")} />}
            <DownloadChoice icon={FileJson} title="Edit project" description="A small JSON backup of cuts, crop, text, layout, and zoom settings. It contains no video or secret URLs." disabled={busy} onClick={projectDownload} />
          </>}

          {state.kind === "working" && (
            <div className="rounded-xl bg-slate-950 p-4 text-white" aria-live="polite">
              <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Preparing {state.action.toLowerCase()}</span>{state.progress !== undefined && <span className="font-mono text-xs text-slate-300">{percent(state.progress)}%</span>}</div>
              {state.progress !== undefined && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Edited video export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(state.progress)}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent(state.progress)}%` }} /></div>}
              <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] leading-4 text-slate-400">Keep this tab open and active while VideoFlow prepares the file.</p><Button size="sm" variant="secondary" className="h-8 shrink-0" onClick={() => controllerRef.current?.abort()}>Cancel</Button></div>
            </div>
          )}

          {state.kind === "complete" && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-xs font-semibold text-emerald-700" aria-live="polite"><CheckCircle2 className="h-4 w-4" /> {state.action} is ready.</p>}
          {state.kind === "error" && <div className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700" role="alert"><strong className="block">Download failed</strong>{state.message}</div>}
        </div>

        <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4 text-[11px] leading-4 text-slate-500"><Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{scope === "owner" ? "VideoFlow uses the video container your browser can encode, including MP4 in Safari. Source downloads remain available if this browser cannot render edits." : "The finished download applies every saved edit and never exposes the creator’s untouched source as a download option."}</div>
      </DialogContent>
    </Dialog>
  );
}
