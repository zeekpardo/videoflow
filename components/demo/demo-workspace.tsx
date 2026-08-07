"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Camera,
  Library,
  Loader2,
  Menu,
  Monitor,
  MonitorSmartphone,
  MonitorUp,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLogo } from "@/components/app-logo";
import {
  DemoRecorder,
  type DemoRecordingDraft,
} from "@/components/demo/demo-recorder";
import {
  DemoDisclosure,
  DemoPurchaseBar,
  DemoTimeRemaining,
} from "@/components/demo/demo-purchase-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordMode } from "@/components/videos/use-media-recorder";
import {
  openDemoMediaStore,
  type DemoMediaStore,
  type DemoVideo,
} from "@/lib/demo-video-store";
import { demoConfig } from "@/lib/config";
import { stableObjectUrl } from "@/lib/stable-object-url";
import { captureVideoBlobFrame } from "@/lib/video-thumbnail";
import { cn } from "@/lib/utils";
import { trackDemoEvent } from "@/lib/demo-analytics";
import { ensureDemoV2Sample } from "@/lib/demo-v2-seed";

type WorkspaceView = "record" | "library";

const modes: {
  mode: RecordMode;
  title: string;
  description: string;
  note: string;
  icon: typeof Monitor;
}[] = [
  {
    mode: "screen_camera",
    title: "Screen + camera",
    description: "Walk through your screen with a movable camera bubble.",
    note: "Recommended",
    icon: MonitorSmartphone,
  },
  {
    mode: "screen",
    title: "Screen + microphone",
    description: "Record a tab, window, or display with narration.",
    note: "Best for demos",
    icon: Monitor,
  },
  {
    mode: "camera",
    title: "Camera only",
    description: "Create a direct face-to-camera video message.",
    note: "Best for updates",
    icon: Video,
  },
];

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function DemoVideoCard({
  video,
  onOpen,
  onDelete,
  onThumbnail,
}: {
  video: DemoVideo;
  onOpen: () => void;
  onDelete: () => void;
  onThumbnail: (blob: Blob) => Promise<void>;
}) {
  const [generatedThumbnail, setGeneratedThumbnail] = useState<Blob>();
  const thumbnail = video.thumbnailBlob ?? generatedThumbnail;
  const thumbnailUrl = stableObjectUrl(thumbnail);
  const videoUrl = stableObjectUrl(video.videoBlob);

  useEffect(() => {
    if (thumbnail) return;
    let active = true;
    void captureVideoBlobFrame(video.videoBlob, video.durationMs)
      .then(async (blob) => {
        if (!active) return;
        setGeneratedThumbnail(blob);
        await onThumbnail(blob);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onThumbnail, thumbnail, video.durationMs, video.videoBlob]);

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(35,42,80,.10)]">
      <button
        onClick={onOpen}
        className="relative block aspect-video w-full overflow-hidden bg-[#eef1f7] text-left"
      >
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={`${video.title} thumbnail`}
            fill
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            src={videoUrl}
            muted
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        <span className="absolute inset-0 grid place-items-center bg-slate-950/0 transition-colors group-hover:bg-slate-950/10">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            <Play className="h-5 w-5 fill-current" />
          </span>
        </span>
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white">
          {formatDuration(video.durationMs)}
        </span>
      </button>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button onClick={onOpen} className="min-w-0 text-left">
            <p className="truncate text-sm font-semibold text-slate-900">
              {video.title}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {(video.sizeBytes / 1024 / 1024).toFixed(1)} MB · This device
            </p>
          </button>
          <button
            onClick={onDelete}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
            aria-label={`Delete ${video.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={onOpen}
          className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary transition hover:opacity-70"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> Open editor
        </button>
      </div>
    </article>
  );
}

export function DemoWorkspace({
  sessionId,
  expiresAt,
  initialView = "record",
}: {
  sessionId: string;
  expiresAt: number;
  initialView?: WorkspaceView;
}) {
  const router = useRouter();
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [store, setStore] = useState<DemoMediaStore | null>(null);
  const [videos, setVideos] = useState<DemoVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [preferredMode, setPreferredMode] = useState<RecordMode>("screen_camera");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);

  useEffect(() => {
    if (view === "library") trackDemoEvent("library_viewed", { savedVideos: videos.length });
  }, [view, videos.length]);

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
        const rows = await nextStore.listVideos();
        if (!active) return;
        setStore(nextStore);
        setVideos(rows);
      })
      .catch((caught) => {
        if (active) {
          toast.error(
            caught instanceof Error ? caught.message : "Could not open demo storage",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      current?.dispose();
    };
  }, [expiresAt, router, sessionId]);

  const refresh = useCallback(async () => {
    if (!store) return;
    setVideos(await store.listVideos());
  }, [store]);

  const openRecorder = (mode: RecordMode = "screen_camera") => {
    if (videos.length >= demoConfig.maxVideos) {
      toast.error(
        `This demo keeps up to ${demoConfig.maxVideos} videos. Delete one from the library before recording another.`,
      );
      setView("library");
      return;
    }
    setPreferredMode(mode);
    setRecorderOpen(true);
    trackDemoEvent("recording_setup_opened", { mode, savedVideos: videos.length });
  };

  const saveRecording = async (draft: DemoRecordingDraft) => {
    if (!store) throw new Error("Demo storage is still loading");
    const existing = await store.listVideos();
    if (existing.length >= demoConfig.maxVideos) {
      setVideos(existing);
      throw new Error(
        `This demo keeps up to ${demoConfig.maxVideos} videos. Delete one before saving another.`,
      );
    }
    const id = crypto.randomUUID();
    await store.saveVideo({
      ...draft,
      id,
      createdAt: Date.now(),
    });
    trackDemoEvent("recording_saved", {
      mode: draft.mode, durationMs: draft.durationMs, sizeBytes: draft.sizeBytes,
      width: draft.width ?? 0, height: draft.height ?? 0,
      separateScreen: !!draft.screenBlob, separateCamera: !!draft.cameraBlob,
    });
    await refresh();
    router.push(`/demo/videos/${id}`);
  };

  const remove = async (video: DemoVideo) => {
    if (!store || !window.confirm(`Delete “${video.title}” from this demo?`)) return;
    await store.deleteVideo(video.id);
    trackDemoEvent("recording_deleted", { mode: video.mode, durationMs: video.durationMs });
    await refresh();
    toast.success("Video deleted");
  };

  const navigation = (
    <nav className="space-y-1.5" aria-label="Demo workspace navigation">
      {[
        { id: "record" as const, label: "Record", icon: MonitorUp },
        { id: "library" as const, label: "Library", icon: Library },
      ].map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            setView(id);
            setMobileOpen(false);
          }}
          className={cn(
            "flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition-all",
            view === id
              ? "bg-primary/10 text-primary"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
          {label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
      <DemoPurchaseBar />
      <div className="min-h-[calc(100vh-53px)] lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
        <aside className="hidden border-r border-slate-200/80 bg-white lg:flex lg:flex-col">
          <div className="flex h-[88px] items-center border-b border-slate-100 px-7">
            <AppLogo href="/demo" />
          </div>
          <div className="flex-1 px-5 py-7">{navigation}</div>
          <DemoDisclosure className="m-5" />
        </aside>

        {mobileOpen && (
          <button
            className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col bg-white p-5 shadow-2xl transition-transform lg:hidden",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-8 flex items-center justify-between">
            <AppLogo href="/demo" />
            <button onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1">{navigation}</div>
          <DemoDisclosure className="mt-5" />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200/70 bg-[#f6f8fc]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Test mode
              </span>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <span className="text-xs text-slate-400">Stored only for this private demo session</span>
              <DemoTimeRemaining expiresAt={expiresAt} />
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-7 lg:p-10">
            {view === "record" ? (
              <div className="space-y-7">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">
                    New recording
                  </p>
                  <h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">
                    What do you want to record?
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    Choose a recording mode, then select your devices before capture
                    begins.
                  </p>
                </div>
                <section className="overflow-hidden rounded-[24px] border border-primary/20 bg-gradient-to-br from-primary to-violet-700 p-6 text-white shadow-xl shadow-primary/15 sm:flex sm:items-center sm:justify-between sm:gap-6">
                  <div><p className="text-xs font-bold uppercase tracking-[.18em] text-white/65">New in VideoFlow V2</p><h2 className="mt-2 text-2xl font-bold tracking-tight">See the wow moment first</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Open a safe sample project with Magic Polish, kinetic captions, Smart Focus, templates, interactive CTAs, document generation, and background publishing—no device permissions required.</p></div>
                  <Button variant="secondary" className="mt-5 shrink-0 sm:mt-0" disabled={!store || sampleBusy} onClick={async () => { if (!store) return; setSampleBusy(true); try { const sample = await ensureDemoV2Sample(store); await refresh(); trackDemoEvent("video_opened", { mode: sample.mode, durationMs: sample.durationMs, guidedV2: true }); router.push(`/demo/videos/${sample.id}`); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create the guided sample"); setSampleBusy(false); } }}>
                    {sampleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Explore guided V2 sample
                  </Button>
                </section>
                <div className="grid gap-4 lg:grid-cols-3">
                  {modes.map(({ mode, title, description, note, icon: Icon }) => (
                    <button
                      key={mode}
                      onClick={() => openRecorder(mode)}
                      className="group relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_22px_55px_rgba(45,51,90,.12)]"
                    >
                      <span className="absolute right-4 top-4 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 group-hover:bg-primary/10 group-hover:text-primary">
                        {note}
                      </span>
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <h2 className="mt-8 text-lg font-bold">{title}</h2>
                      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">
                        {description}
                      </p>
                      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                        Set up this recording <Camera className="h-4 w-4" />
                      </span>
                    </button>
                  ))}
                </div>
                <section className="grid gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
                  <div>
                    <h2 className="font-bold">A real editor, running locally</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      Record, trim, crop, add text and graphics, mix audio, and export
                      without uploading your media.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-3 py-2">
                      <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" /> No uploads
                    </span>
                    <span className="rounded-full bg-primary/10 px-3 py-2 font-semibold text-primary">
                      {videos.length} of {demoConfig.maxVideos} saved
                    </span>
                  </div>
                </section>
              </div>
            ) : (
              <DemoLibrary
                videos={videos}
                loading={loading}
                onRecord={() => openRecorder()}
                onOpen={(video) => { trackDemoEvent("video_opened", { mode: video.mode, durationMs: video.durationMs }); router.push(`/demo/videos/${video.id}`); }}
                onDelete={remove}
                onThumbnail={async (video, blob) => {
                  if (!store) return;
                  await store.patchVideo(video.id, { thumbnailBlob: blob });
                }}
              />
            )}
          </main>
        </div>
      </div>
      <DemoRecorder
        key={`${preferredMode}-${recorderOpen}`}
        initialMode={preferredMode}
        open={recorderOpen}
        onOpenChange={setRecorderOpen}
        onSaved={saveRecording}
      />
    </div>
  );
}

function DemoLibrary({
  videos,
  loading,
  onRecord,
  onOpen,
  onDelete,
  onThumbnail,
}: {
  videos: DemoVideo[];
  loading: boolean;
  onRecord: () => void;
  onOpen: (video: DemoVideo) => void;
  onDelete: (video: DemoVideo) => void;
  onThumbnail: (video: DemoVideo, blob: Blob) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const filtered = videos.filter((video) =>
    video.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">
            Your workspace
          </p>
          <h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">
            Video library
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Your recordings and edits for this private demo session.
          </p>
        </div>
        <Button onClick={onRecord} className="rounded-xl">
          <MonitorUp className="h-4 w-4" /> New recording
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Search your videos"
            placeholder="Search your videos"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 border-0 bg-slate-50 pl-10 shadow-none focus-visible:ring-1"
          />
        </div>
        <div className="flex items-center gap-2 px-2 text-xs text-slate-400">
          <Library className="h-4 w-4" /> {videos.length} videos
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
          <MonitorUp className="mx-auto mb-4 h-9 w-9 text-primary" />
          <h2 className="font-bold">Your first video starts here</h2>
          <p className="mt-2 text-sm text-slate-500">
            Record your screen, camera, or both and open the full editor.
          </p>
          <Button onClick={onRecord} className="mt-6 rounded-xl">
            Record your first video
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
          <Search className="mx-auto mb-4 h-9 w-9 text-primary" />
          <h2 className="font-bold">No videos found</h2>
          <p className="mt-2 text-sm text-slate-500">Try a different title.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((video) => (
            <DemoVideoCard
              key={video.id}
              video={video}
              onOpen={() => onOpen(video)}
              onDelete={() => onDelete(video)}
              onThumbnail={(blob) => onThumbnail(video, blob)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
