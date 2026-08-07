"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudUpload, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EditorProject } from "@/components/videos/video-editor-workspace";
import { buildVideoTimelineMap, type VideoTextOverlay } from "@/lib/video-edits";
import { editedExportSupport, exportEditedWebm } from "@/lib/video-export";

export interface EditorPublishAdapter {
  current: boolean;
  status?: "rendering" | "ready" | "error";
  error?: string;
  /** Persist this exact project and mark its returned revision as rendering. */
  prepare: (project: EditorProject) => Promise<number>;
  /** Store the browser render only if it still matches that revision. */
  complete: (input: { blob: Blob; editRevision: number; durationMs: number }) => Promise<void>;
  fail?: (input: { editRevision: number; message: string }) => Promise<void>;
}

interface VideoPublishButtonProps {
  title: string;
  mode: "screen" | "screen_camera" | "camera";
  durationMs: number;
  primarySrc: string;
  screenSrc?: string | null;
  cameraSrc?: string | null;
  project: EditorProject;
  supplementalTextOverlays?: readonly VideoTextOverlay[];
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  adapter: EditorPublishAdapter;
  beforePublish?: () => Promise<void>;
}

type PublishState =
  | { kind: "idle" }
  | { kind: "working"; label: string; progress: number; editRevision?: number }
  | { kind: "complete" }
  | { kind: "error"; message: string };

function percent(value: number) {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function VideoPublishButton({
  title,
  mode,
  durationMs,
  primarySrc,
  screenSrc,
  cameraSrc,
  project,
  supplementalTextOverlays,
  graphicUrls,
  adapter,
  beforePublish,
}: VideoPublishButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PublishState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const busy = state.kind === "working";
  const support = open ? editedExportSupport() : { supported: true as const };
  const finalDurationMs = buildVideoTimelineMap(durationMs, project.editState.cuts, project.editState.trim).durationMs;
  const actionLabel = adapter.current ? "Update published video" : "Publish latest";

  useEffect(() => () => controllerRef.current?.abort(), []);

  const publish = async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let editRevision: number | undefined;
    setState({ kind: "working", label: "Saving the current project", progress: 0 });
    try {
      await beforePublish?.();
      editRevision = await adapter.prepare(structuredClone(project));
      setState({ kind: "working", label: "Rendering the finished video", progress: 0, editRevision });
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
        resolution: "native",
        signal: controller.signal,
        onProgress: ({ progress }) => setState({
          kind: "working",
          label: "Rendering the finished video",
          progress,
          editRevision,
        }),
      });
      if (controller.signal.aborted) throw new DOMException("Publishing canceled", "AbortError");
      setState({ kind: "working", label: "Saving the viewer file", progress: 1, editRevision });
      await adapter.complete({ blob, editRevision, durationMs: finalDurationMs });
      setState({ kind: "complete" });
      toast.success("Published video is ready");
    } catch (caught) {
      const canceled = caught instanceof DOMException && caught.name === "AbortError";
      const message = canceled
        ? "Publishing was canceled. Your editable project is still safe."
        : caught instanceof Error ? caught.message : "The finished video could not be published.";
      if (editRevision !== undefined) {
        await adapter.fail?.({ editRevision, message }).catch(() => undefined);
      }
      setState({ kind: "error", message });
      if (!canceled) toast.error(message);
    } finally {
      controllerRef.current = null;
    }
  };

  const changeOpen = (next: boolean) => {
    if (!next && busy) return;
    setOpen(next);
    if (next && state.kind === "complete") setState({ kind: "idle" });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="h-9"
        onClick={() => setOpen(true)}
        data-testid="publish-latest"
      >
        {adapter.status === "rendering" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
        {actionLabel}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-lg overflow-hidden rounded-2xl border-slate-200 bg-white p-0 text-slate-950" onEscapeKeyDown={(event) => busy && event.preventDefault()} onPointerDownOutside={(event) => busy && event.preventDefault()}>
          <DialogHeader className="border-b border-slate-100 px-6 py-5 pr-12">
            <DialogTitle className="flex items-center gap-2 text-xl"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><CloudUpload className="h-4 w-4" /></span>{actionLabel}</DialogTitle>
            <DialogDescription>Build one finished WebM with cuts, layout, audio, text, zooms, and overlays applied for the public viewer.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            {state.kind === "idle" && (
              <>
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs">
                  <div><p className="text-slate-400">Video</p><p className="mt-1 truncate font-semibold text-slate-800">{title}</p></div>
                  <div><p className="text-slate-400">Finished length</p><p className="mt-1 font-mono font-semibold text-slate-800">{Math.max(0, finalDurationMs / 1_000).toFixed(1)}s</p></div>
                </div>
                <p className="text-xs leading-5 text-slate-500">Rendering happens in this browser and usually takes about as long as the finished video. Keep this tab open. Your original source layers stay available in the editor.</p>
                {!support.supported && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">{support.reason}</p>}
                {adapter.status === "error" && adapter.error && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">Last attempt: {adapter.error}</p>}
                <Button className="w-full" disabled={!support.supported || finalDurationMs < 100} onClick={() => void publish()}><CloudUpload className="h-4 w-4" /> {actionLabel}</Button>
              </>
            )}

            {state.kind === "working" && (
              <div className="rounded-xl bg-slate-950 p-5 text-white" aria-live="polite">
                <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin text-primary" /> {state.label}</span><span className="font-mono text-xs text-slate-300">{percent(state.progress)}%</span></div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Publishing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(state.progress)}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent(state.progress)}%` }} /></div>
                <div className="mt-4 flex items-center justify-between gap-3"><p className="text-[11px] leading-4 text-slate-400">Keep this tab visible until the viewer file is saved.</p><Button size="sm" variant="secondary" className="h-8" onClick={() => controllerRef.current?.abort()}><X className="h-3.5 w-3.5" /> Cancel</Button></div>
              </div>
            )}

            {state.kind === "complete" && <div className="space-y-4 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" /></span><div><p className="font-bold text-slate-900">Published video ready</p><p className="mt-1 text-xs leading-5 text-slate-500">Viewer links now use the flattened version for this edit revision.</p></div><Button className="w-full" onClick={() => setOpen(false)}>Done</Button></div>}

            {state.kind === "error" && <div className="space-y-4"><div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700" role="alert"><strong className="block">Publishing did not finish</strong>{state.message}</div><Button variant="outline" className="w-full" onClick={() => setState({ kind: "idle" })}><RotateCcw className="h-4 w-4" /> Try again</Button></div>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
