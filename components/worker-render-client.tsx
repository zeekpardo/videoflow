"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { buildVideoTimelineMap, normalizeVideoEditState, type VideoEditState, type VideoZoomEffect } from "@/lib/video-edits";
import { exportEditedWebm, type ExportResolutionPreset } from "@/lib/video-export";
import { captionTrackToTextOverlays, type CaptionCue, type CaptionStyle } from "@/lib/video-v2";

export interface WorkerRenderRequest {
  durationMs: number;
  mode: "screen" | "screen_camera" | "camera";
  editState?: VideoEditState;
  zoomEffects: VideoZoomEffect[];
  captions?: { cues: CaptionCue[]; style: CaptionStyle } | null;
  sources: { primary: string; screen?: string | null; camera?: string | null };
  graphicAssets?: Array<{ assetId: string; url: string }>;
  outputUrl: string;
  preset: ExportResolutionPreset;
}

declare global {
  interface Window {
    videoFlowWorkerRender?: (request: WorkerRenderRequest) => Promise<{ durationMs: number; sizeBytes: number; mimeType: string }>;
  }
}

export function WorkerRenderClient() {
  const [status, setStatus] = useState("Background renderer ready");

  useEffect(() => {
    window.videoFlowWorkerRender = async (request) => {
      setStatus("Rendering the current edit revision…");
      const state = normalizeVideoEditState(request.editState, request.durationMs, !!request.sources.screen && !!request.sources.camera);
      const burnedCaptions = captionTrackToTextOverlays(request.captions ? { ...request.captions, language: "en", revision: 0 } : null);
      const blob = await exportEditedWebm({
        primarySrc: request.sources.primary,
        screenSrc: request.sources.screen ?? undefined,
        cameraSrc: request.sources.camera ?? undefined,
        durationMs: request.durationMs,
        editState: state,
        zoomEffects: request.zoomEffects,
        supplementalTextOverlays: burnedCaptions,
        graphicUrls: Object.fromEntries((request.graphicAssets ?? []).map((asset) => [asset.assetId, asset.url])),
        resolution: request.preset,
        onProgress: ({ progress }) => setStatus(`Rendering ${Math.round(progress * 100)}%`),
      });
      setStatus("Uploading worker render…");
      const response = await fetch(request.outputUrl, { method: "PUT", headers: { "content-type": blob.type || "video/webm" }, body: blob });
      if (!response.ok) throw new Error(`Worker upload failed with ${response.status}`);
      const durationMs = buildVideoTimelineMap(request.durationMs, state.cuts, state.trim).durationMs;
      setStatus("Render uploaded");
      return { durationMs, sizeBytes: blob.size, mimeType: blob.type || "video/webm" };
    };
    document.documentElement.dataset.videoFlowWorkerReady = "true";
    return () => {
      delete window.videoFlowWorkerRender;
      delete document.documentElement.dataset.videoFlowWorkerReady;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-8 text-white">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <h1 className="mt-5 text-lg font-semibold">VideoFlow media worker</h1>
        <p className="mt-2 text-sm text-slate-400" aria-live="polite">{status}</p>
      </div>
    </main>
  );
}
