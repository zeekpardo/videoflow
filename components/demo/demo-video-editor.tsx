"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  ImagePlus,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  DemoPurchaseBar,
  DemoTimeRemaining,
  DEMO_DISCLOSURE,
} from "@/components/demo/demo-purchase-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  VideoEditorWorkspace,
  type EditorProject,
} from "@/components/videos/video-editor-workspace";
import { appConfig } from "@/lib/config";
import {
  openDemoMediaStore,
  type DemoGraphicAsset,
  type DemoMediaStore,
  type DemoVideo,
} from "@/lib/demo-video-store";
import { stableObjectUrl } from "@/lib/stable-object-url";
import {
  captureVideoBlobFrame,
  captureVideoFrame,
  generateTitleThumbnail,
  validateThumbnailFile,
} from "@/lib/video-thumbnail";
import {
  readVideoGraphicDimensions,
  validateVideoGraphicFile,
} from "@/lib/video-assets";
import { trackDemoEvent } from "@/lib/demo-analytics";
import { DemoV2Panel } from "@/components/demo/demo-v2-panel";

export function DemoVideoEditor({
  videoId,
  sessionId,
  expiresAt,
}: {
  videoId: string;
  sessionId: string;
  expiresAt: number;
}) {
  const router = useRouter();
  const [store, setStore] = useState<DemoMediaStore | null>(null);
  const [video, setVideo] = useState<DemoVideo | null | undefined>(undefined);
  const [graphicAssets, setGraphicAssets] = useState<DemoGraphicAsset[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    trackDemoEvent("editor_opened", { videoId, existingVideo: true });
  }, [videoId]);

  useEffect(() => {
    let active = true;
    let current: DemoMediaStore | null = null;
    void openDemoMediaStore({
      sessionId,
      expiresAt,
      onExpired: () => router.replace("/demo/access"),
    })
      .then(async (nextStore) => {
        current = nextStore;
        const [row, assets] = await Promise.all([
          nextStore.getVideo(videoId),
          nextStore.listGraphicAssets(videoId),
        ]);
        if (!active) return;
        setStore(nextStore);
        setVideo(row);
        setGraphicAssets(assets);
        setTitle(row?.title ?? "");
        setDescription(row?.description ?? "");
      })
      .catch((caught) => {
        if (!active) return;
        setVideo(null);
        toast.error(
          caught instanceof Error ? caught.message : "Could not open the recording",
        );
      });
    return () => {
      active = false;
      current?.dispose();
    };
  }, [expiresAt, router, sessionId, videoId]);

  if (video === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f6f8fc]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!video || !store) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f8fc] p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Recording not found</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Demo recordings exist only for the browser and private demo session
            where they were created.
          </p>
          <Button className="mt-5" onClick={() => router.push("/demo?view=library")}>
            Back to library
          </Button>
        </div>
      </main>
    );
  }

  // IndexedDB returns fresh Blob objects after every metadata save. Key the
  // immutable source layers by recording so autosave cannot replace the media
  // URL and reset the editor playhead.
  const videoUrl = stableObjectUrl(video.videoBlob, `demo:${video.id}:video`);
  const screenUrl = stableObjectUrl(video.screenBlob, `demo:${video.id}:screen`);
  const cameraUrl = stableObjectUrl(video.cameraBlob, `demo:${video.id}:camera`);
  const posterUrl = stableObjectUrl(video.thumbnailBlob);
  const graphicUrls = Object.fromEntries(
    graphicAssets.map((asset) => [asset.assetId, stableObjectUrl(asset.blob)]),
  );

  const patchVideo = async (patch: Partial<DemoVideo>) => {
    const updated = await store.patchVideo(video.id, patch);
    setVideo(updated);
    return updated;
  };

  const saveProject = async (project: EditorProject) => {
    const saved = await store.saveEditorProject(video.id, {
      editState: project.editState,
      zoomEffects: project.zoomEffects,
    });
    setVideo(saved);
    trackDemoEvent("editor_saved", {
      cuts: project.editState.cuts.length,
      text: project.editState.textOverlays.length,
      zooms: project.zoomEffects.length,
      objects: project.editState.version === 2 ? project.editState.objects.length : 0,
      trimStartMs: project.editState.version === 2 ? project.editState.trim.startMs : 0,
      trimEndMs: project.editState.version === 2 ? project.editState.trim.endMs : video.durationMs,
      cropTop: project.editState.crop.top, cropRight: project.editState.crop.right,
      cropBottom: project.editState.crop.bottom, cropLeft: project.editState.crop.left,
      screenScale: project.editState.screen.scale,
      cameraVisible: project.editState.camera?.visible ?? false,
      cameraShape: project.editState.camera?.shape ?? "unavailable",
      cameraSize: project.editState.camera?.size ?? 0,
      audioMuted: project.editState.version === 2 ? project.editState.audio.muted : false,
      audioGain: project.editState.version === 2 ? project.editState.audio.gain : 1,
      clickOverlays: project.editState.version === 2 ? project.editState.interactions.clicks.length : 0,
      keyOverlays: project.editState.version === 2 ? project.editState.interactions.keys.length : 0,
    });
    return { editRevision: saved.editRevision };
  };

  const addGraphic = async (requested: File) => {
    const file = validateVideoGraphicFile(requested);
    const { width, height } = await readVideoGraphicDimensions(file);
    const assetId = crypto.randomUUID();
    const asset = await store.saveGraphicAsset(video.id, {
      assetId,
      blob: file,
      width,
      height,
    });
    setGraphicAssets((current) => [
      ...current.filter((item) => item.assetId !== assetId),
      asset,
    ]);
    trackDemoEvent("graphic_uploaded", { mimeType: file.type, sizeBytes: file.size, width, height });
    return { assetId, url: stableObjectUrl(asset.blob) };
  };

  const commitTitle = async () => {
    const next = title.trim().slice(0, 200);
    if (!next) {
      setTitle(video.title);
      toast.error("Enter a video title");
      return;
    }
    if (next === video.title) return;
    setTitle(next);
    await patchVideo({ title: next });
    toast.success("Title updated");
  };

  const commitDescription = async () => {
    const next = description.trim().slice(0, 5_000);
    if (next === (video.description ?? "")) return;
    setDescription(next);
    await patchVideo({ description: next || undefined });
    toast.success("Description updated");
  };

  const changeThumbnail = async (create: () => Promise<Blob>) => {
    setThumbnailBusy(true);
    try {
      await patchVideo({ thumbnailBlob: await create() });
      trackDemoEvent("thumbnail_updated");
      toast.success("Thumbnail updated");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Could not update thumbnail",
      );
    } finally {
      setThumbnailBusy(false);
    }
  };

  const removeVideo = async () => {
    if (!window.confirm(`Delete “${video.title}” from this demo?`)) return;
    setDeleteBusy(true);
    try {
      await store.deleteVideo(video.id);
      trackDemoEvent("recording_deleted", { mode: video.mode, durationMs: video.durationMs, fromEditor: true });
      toast.success("Video deleted");
      router.push("/demo?view=library");
    } catch (caught) {
      setDeleteBusy(false);
      toast.error(caught instanceof Error ? caught.message : "Could not delete video");
    }
  };

  const ownerSettings = (
    <div className="divide-y divide-slate-100">
      <section className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Video details</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            These details stay with this browser-only demo project.
          </p>
        </div>
        <label className="block space-y-1.5">
          <Label htmlFor="demo-editor-title" className="text-xs">
            Title
          </Label>
          <Input
            id="demo-editor-title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
          />
        </label>
        <label className="block space-y-1.5">
          <Label htmlFor="demo-editor-description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="demo-editor-description"
            value={description}
            maxLength={5_000}
            rows={4}
            placeholder="Add context for this recording…"
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => void commitDescription()}
          />
        </label>
      </section>

      <section className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Thumbnail</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Choose the current frame, upload artwork, or generate a title card.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Button
            size="sm"
            variant="outline"
            disabled={thumbnailBusy}
            onClick={() =>
              void changeThumbnail(async () => {
                if (!playerRef.current) throw new Error("Video preview is not ready");
                return captureVideoFrame(playerRef.current);
              })
            }
          >
            <Camera className="h-3.5 w-3.5" /> Current frame
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={thumbnailBusy}
            onClick={() => thumbnailInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
          <Button
            size="sm"
            className="sm:col-span-2 lg:col-span-1 xl:col-span-2"
            disabled={thumbnailBusy}
            onClick={() =>
              void changeThumbnail(async () =>
                generateTitleThumbnail(
                  await captureVideoBlobFrame(video.videoBlob, video.durationMs),
                  title.trim() || video.title,
                  appConfig.brandColor,
                ),
              )
            }
          >
            {thumbnailBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate title card
          </Button>
        </div>
        <p className="flex items-center gap-2 text-[11px] font-medium text-emerald-600">
          <ImagePlus className="h-3.5 w-3.5" /> Used in this demo library only
        </p>
      </section>

      <section className="space-y-3 p-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs font-semibold leading-5 text-amber-800">
          {DEMO_DISCLOSURE}
        </div>
        <Button
          variant="outline"
          className="w-full text-red-500 hover:text-red-600"
          disabled={deleteBusy}
          onClick={() => void removeVideo()}
        >
          {deleteBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete demo video
        </Button>
      </section>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void changeThumbnail(async () => validateThumbnailFile(file));
          }
          event.currentTarget.value = "";
        }}
      />
      <DemoPurchaseBar compact />
      <main className="w-full">
        <VideoEditorWorkspace
          key={video.id}
          videoKey={video.id}
          title={video.title}
          mode={video.mode}
          durationMs={video.durationMs}
          src={videoUrl}
          screenSrc={screenUrl || undefined}
          cameraSrc={cameraUrl || undefined}
          poster={posterUrl || undefined}
          initialEditState={video.editState}
          initialZoomEffects={video.zoomEffects}
          initialCaptionTrack={video.captionTrack}
          transcript={{ status: "none", localMode: true }}
          backHref="/demo?view=library"
          environmentLabel="Private demo editor"
          className="min-h-[calc(100dvh-53px)] lg:h-[calc(100dvh-53px)] lg:min-h-[720px]"
          onSave={saveProject}
          onPlayerReady={(player) => {
            playerRef.current = player;
          }}
          ownerSettings={ownerSettings}
          graphicUrls={graphicUrls}
          onUploadGraphic={addGraphic}
          onAnalyticsEvent={(eventName, properties) => trackDemoEvent(eventName, properties)}
          renderEnhancePanel={(editor) => <DemoV2Panel video={video} editor={editor} onPatch={patchVideo} />}
          headerActions={
            <div className="hidden items-center gap-2 xl:flex">
              <DemoTimeRemaining expiresAt={expiresAt} />
              <span
                title={DEMO_DISCLOSURE}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Test mode
              </span>
            </div>
          }
        />
      </main>
    </div>
  );
}
