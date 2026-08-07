"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Camera, Check, CirclePlay, ExternalLink, Eye, HardDrive, Library, Loader2, Menu, Monitor, MonitorSmartphone, MonitorUp, Play, Search, ShieldCheck, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LocalRecorder } from "@/components/test-mode/local-recorder";
import { VideoQuickPreview } from "@/components/videos/video-quick-preview";
import { clearLocalVideos, deleteLocalVideo, listLocalVideos, patchLocalVideo, type LocalVideo } from "@/lib/local-video-store";
import { cn } from "@/lib/utils";
import type { RecordMode } from "@/components/videos/use-media-recorder";
import { captureVideoBlobFrame } from "@/lib/video-thumbnail";
import { stableObjectUrl } from "@/lib/stable-object-url";
import { videoEditorHref } from "@/lib/video-routes";

type View = "record" | "library" | "analytics" | "about";

const modeChoices: { mode: RecordMode; title: string; description: string; note: string; icon: typeof Monitor }[] = [
  { mode: "screen_camera", title: "Screen + camera", description: "Walk through your screen with a movable camera bubble.", note: "Recommended", icon: MonitorSmartphone },
  { mode: "screen", title: "Screen + microphone", description: "Record a tab, window, or display with narration.", note: "Best for demos", icon: Monitor },
  { mode: "camera", title: "Camera only", description: "Create a direct face-to-camera video message.", note: "Best for updates", icon: Video },
];

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function LocalVideoCard({ video, onOpen, onDelete }: { video: LocalVideo; onOpen: () => void; onDelete: () => void }) {
  const url = stableObjectUrl(video.videoBlob);
  const [generatedThumbnail, setGeneratedThumbnail] = useState<Blob | undefined>();
  const [ignoreStoredThumbnail, setIgnoreStoredThumbnail] = useState(false);
  const thumbnail = ignoreStoredThumbnail ? generatedThumbnail : video.thumbnailBlob ?? generatedThumbnail;
  const thumbnailUrl = stableObjectUrl(thumbnail);
  useEffect(() => {
    if (thumbnail) return;
    let active = true;
    captureVideoBlobFrame(video.videoBlob, video.durationMs).then(async (blob) => {
      if (!active) return;
      setGeneratedThumbnail(blob);
      await patchLocalVideo(video.id, { thumbnailBlob: blob });
    }).catch(() => {});
    return () => { active = false; };
  }, [thumbnail, video.durationMs, video.id, video.videoBlob]);
  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(35,42,80,.10)]">
      <button onClick={onOpen} className="relative block aspect-video w-full overflow-hidden bg-[#eef1f7] text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumbnailUrl ? <img src={thumbnailUrl} alt={`${video.title} thumbnail`} className="h-full w-full object-cover" onError={() => { if (ignoreStoredThumbnail) return; setIgnoreStoredThumbnail(true); captureVideoBlobFrame(video.videoBlob, video.durationMs).then(async (blob) => { setGeneratedThumbnail(blob); await patchLocalVideo(video.id, { thumbnailBlob: blob }); }).catch(() => {}); }} /> : <video src={url} muted preload="auto" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 grid place-items-center bg-slate-950/0 transition-colors group-hover:bg-slate-950/10"><span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100"><Play className="h-5 w-5 fill-current" /></span></span>
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white">{formatDuration(video.durationMs)}</span>
        {video.shareToken && <span className="absolute left-2.5 top-2.5 rounded-full border border-white/70 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm">Share link on</span>}
      </button>
      <div className="p-4"><div className="flex items-start justify-between gap-3"><button onClick={onOpen} className="min-w-0 text-left"><p className="truncate text-sm font-semibold text-slate-900">{video.title}</p><p className="mt-1 text-xs text-slate-400">{video.views?.length ?? 0} viewers · {(video.sizeBytes / 1024 / 1024).toFixed(1)} MB</p></button><button onClick={onDelete} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label={`Delete ${video.title}`}><Trash2 className="h-4 w-4" /></button></div><button onClick={onOpen} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary transition hover:opacity-70"><Play className="h-3.5 w-3.5 fill-current" /> Quick preview</button></div>
    </article>
  );
}

function LocalVideoQuickPreview({ video, onClose, onDelete, onEdit }: { video: LocalVideo | null; onClose: () => void; onDelete: (video: LocalVideo) => void; onEdit: (video: LocalVideo) => void }) {
  const url = stableObjectUrl(video?.videoBlob);
  const screenUrl = stableObjectUrl(video?.screenBlob);
  const cameraUrl = stableObjectUrl(video?.cameraBlob);
  const posterUrl = stableObjectUrl(video?.thumbnailBlob);
  const shareUrl = video?.shareToken && typeof window !== "undefined" ? `${window.location.origin}/test/v/${video.shareToken}` : "";
  const views = video?.views ?? [];
  const completed = views.filter((view) => view.completed).length;
  const avgWatched = views.length ? Math.round(views.reduce((sum, view) => sum + view.percentWatched, 0) / views.length) : 0;
  const modeLabel = video?.mode === "screen_camera" ? "Screen + camera" : video?.mode === "screen" ? "Screen + microphone" : "Camera only";

  return (
    <VideoQuickPreview
      open={!!video}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={video?.title ?? "Video preview"}
      description={video?.description}
      src={url || undefined}
      screenSrc={screenUrl || undefined}
      cameraSrc={cameraUrl || undefined}
      poster={posterUrl || undefined}
      editState={video?.editState}
      zoomEffects={video?.zoomEffects}
      durationLabel={video ? formatDuration(video.durationMs) : undefined}
      sizeLabel={video ? `${(video.sizeBytes / 1024 / 1024).toFixed(1)} MB` : undefined}
      modeLabel={video ? modeLabel : undefined}
      stats={video ? [
        { label: "Viewers", value: views.length },
        { label: "Avg watched", value: `${avgWatched}%` },
        { label: "Completed", value: completed },
      ] : []}
      shareEnabled={!!shareUrl}
      shareLabel={shareUrl ? "Enabled in this browser" : "Enable sharing in the editor"}
      onOpenEditor={() => { if (video) onEdit(video); }}
      onOpenViewer={shareUrl ? () => window.open(shareUrl, "_blank", "noopener,noreferrer") : undefined}
      onCopyShare={shareUrl ? async () => { await navigator.clipboard.writeText(shareUrl); toast.success("Share link copied"); } : undefined}
      onDelete={video ? () => onDelete(video) : undefined}
    />
  );
}

export function TestModeWorkspace({ initialView = "record" }: { initialView?: View }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [preferredMode, setPreferredMode] = useState<RecordMode>("screen_camera");
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LocalVideo | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setVideos(await listLocalVideos()); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not read videos"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { let active = true; listLocalVideos().then((rows) => { if (active) setVideos(rows); }).catch((caught) => { if (active) toast.error(caught instanceof Error ? caught.message : "Could not read videos"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);

  const openRecorder = (mode: RecordMode = "screen_camera") => { setPreferredMode(mode); setRecorderOpen(true); };
  const remove = async (video: LocalVideo) => { if (!window.confirm(`Delete “${video.title}” from this browser?`)) return; await deleteLocalVideo(video.id); setSelected(null); await refresh(); toast.success("Video deleted"); };
  const clear = async () => { if (!window.confirm("Delete every video stored in this browser?")) return; await clearLocalVideos(); await refresh(); toast.success("Library cleared"); };
  const nav = [{ id: "record" as const, label: "Record", icon: MonitorUp }, { id: "library" as const, label: "Library", icon: Library }, { id: "analytics" as const, label: "Analytics", icon: BarChart3 }, { id: "about" as const, label: "Test mode", icon: ShieldCheck }];
  const navigation = <nav className="space-y-1.5" aria-label="Workspace navigation">{nav.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setView(id); setMobileOpen(false); }} className={cn("flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition-all", view === id ? "bg-primary/10 text-primary" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}><Icon className="h-[18px] w-[18px]" />{label}</button>)}</nav>;

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] border-r border-slate-200/80 bg-white lg:flex lg:flex-col"><div className="flex h-[88px] items-center border-b border-slate-100 px-7"><AppLogo href="/test" /></div><div className="flex-1 px-5 py-7">{navigation}</div><div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase tracking-[.16em] text-amber-700">Test mode</p><p className="mt-2 text-xs leading-5 text-amber-800/75">Everything on this device stays local. AI and real external delivery remain off.</p></div></aside>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-white p-5 shadow-2xl transition-transform lg:hidden", mobileOpen ? "translate-x-0" : "-translate-x-full")}><div className="mb-8 flex items-center justify-between"><AppLogo href="/test" /><button onClick={() => setMobileOpen(false)}><X className="h-5 w-5" /></button></div><div className="flex-1">{navigation}</div><div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase tracking-[.16em] text-amber-700">Test mode</p><p className="mt-2 text-xs leading-5 text-amber-800/75">Everything on this device stays local. AI and real external delivery remain off.</p></div></aside>
      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200/70 bg-[#f6f8fc]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button><span className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-400" /> Test mode</span></div><div className="hidden text-xs text-slate-400 sm:block">Stored only in this browser</div></header>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-7 lg:p-10">
          {view === "record" && <RecordView onChoose={openRecorder} videos={videos} />}
          {view === "library" && <LibraryView videos={videos} loading={loading} onRecord={() => openRecorder()} onOpen={setSelected} onDelete={remove} onClear={clear} />}
          {view === "analytics" && <AnalyticsView videos={videos} onOpen={setSelected} />}
          {view === "about" && <AboutView />}
        </main>
      </div>
      <LocalRecorder key={`${preferredMode}-${recorderOpen}`} initialMode={preferredMode} open={recorderOpen} onOpenChange={setRecorderOpen} onSaved={(video) => { router.push(videoEditorHref(video.id, "local")); }} />
      <LocalVideoQuickPreview key={selected?.id ?? "no-selection"} video={selected} onClose={() => setSelected(null)} onDelete={remove} onEdit={(video) => { setSelected(null); router.push(videoEditorHref(video.id, "local")); }} />
    </div>
  );
}

function RecordView({ onChoose, videos }: { onChoose: (mode: RecordMode) => void; videos: LocalVideo[] }) {
  return <div className="space-y-7"><div><p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">New recording</p><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">What do you want to record?</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Choose a recording mode, then select your devices before capture begins.</p></div><div className="grid gap-4 lg:grid-cols-3">{modeChoices.map(({ mode, title, description, note, icon: Icon }) => <button key={mode} onClick={() => onChoose(mode)} className="group relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_22px_55px_rgba(45,51,90,.12)]"><span className="absolute right-4 top-4 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 group-hover:bg-primary/10 group-hover:text-primary">{note}</span><span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><h2 className="mt-8 text-lg font-bold">{title}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{description}</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">Set up this recording <Camera className="h-4 w-4" /></span></button>)}</div><section className="grid gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center sm:p-6"><div><h2 className="font-bold">Everything stays local while you explore</h2><p className="mt-1 text-sm leading-6 text-slate-500">After recording, enable a browser-only share link to try passwords, comments, reactions, downloads, and analytics.</p></div><div className="flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-2"><HardDrive className="mr-1.5 inline h-3.5 w-3.5" /> IndexedDB</span><span className="rounded-full bg-slate-100 px-3 py-2"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" /> No uploads</span><span className="rounded-full bg-primary/10 px-3 py-2 font-semibold text-primary">{videos.length} saved</span></div></section></div>;
}

function LibraryView({ videos, loading, onRecord, onOpen, onDelete, onClear }: { videos: LocalVideo[]; loading: boolean; onRecord: () => void; onOpen: (video: LocalVideo) => void; onDelete: (video: LocalVideo) => void; onClear: () => void }) {
  const [search, setSearch] = useState("");
  const filtered = videos.filter((video) => video.title.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Your workspace</p>
          <h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">Video library</h1>
          <p className="mt-2 text-sm text-slate-500">Every recording, edit, and browser-only share link in one place.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onRecord} className="rounded-xl"><MonitorUp className="h-4 w-4" /> New recording</Button>
          {videos.length > 0 && <Button variant="outline" onClick={onClear} className="rounded-xl text-red-500"><Trash2 className="h-4 w-4" /> Clear all</Button>}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input aria-label="Search your videos" placeholder="Search your videos" value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 border-0 bg-slate-50 pl-10 shadow-none focus-visible:ring-1" />
        </div>
        <div className="flex items-center gap-2 px-2 text-xs text-slate-400"><Library className="h-4 w-4" /> {videos.length} videos</div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : videos.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><CirclePlay className="mx-auto mb-4 h-9 w-9 text-primary" /><h2 className="font-bold">Your first video starts here</h2><p className="mt-2 text-sm text-slate-500">Record a screen walkthrough, camera message, or both. You can review it before saving.</p><Button onClick={onRecord} className="mt-6 rounded-xl">Record your first video</Button></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center"><Search className="mx-auto mb-4 h-9 w-9 text-primary" /><h2 className="font-bold">No videos found</h2><p className="mt-2 text-sm text-slate-500">Try a different title or clear your search.</p></div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((video) => <LocalVideoCard key={video.id} video={video} onOpen={() => onOpen(video)} onDelete={() => onDelete(video)} />)}</div>
      )}
    </div>
  );
}

function AnalyticsView({ videos, onOpen }: { videos: LocalVideo[]; onOpen: (video: LocalVideo) => void }) {
  const views = videos.flatMap((video) => video.views ?? []);
  const shared = videos.filter((video) => video.shareToken).length;
  const completed = views.filter((view) => view.completed).length;
  const avg = views.length ? Math.round(views.reduce((sum, view) => sum + view.percentWatched, 0) / views.length) : 0;
  return <div className="space-y-7"><div><p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Viewer insights</p><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">Analytics</h1><p className="mt-2 text-sm text-slate-500">Open browser-only share links and simulate viewers to populate these metrics.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Viewers" value={views.length} icon={Eye} /><Stat label="Shared videos" value={shared} icon={ExternalLink} /><Stat label="Avg watched" value={`${avg}%`} icon={BarChart3} /><Stat label="Completed views" value={completed} icon={Check} /></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Video performance</h2>{videos.length ? <div className="mt-4 divide-y divide-slate-100">{[...videos].sort((a, b) => (b.views?.length ?? 0) - (a.views?.length ?? 0)).map((video) => { const rows = video.views ?? []; const watched = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.percentWatched, 0) / rows.length) : 0; return <button key={video.id} onClick={() => onOpen(video)} className="grid w-full grid-cols-[minmax(0,1fr)_70px_90px] items-center gap-4 py-4 text-left text-sm hover:text-primary"><span className="truncate font-semibold">{video.title}</span><span className="text-xs text-slate-500">{rows.length} views</span><span className="text-right text-xs text-slate-500">{watched}% watched</span></button>; })}</div> : <p className="py-12 text-center text-sm text-slate-400">Record a video, enable its share link, and open the viewer preview to generate analytics.</p>}</div></div>;
}

function AboutView() { return <div className="mx-auto max-w-3xl space-y-7"><div><p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Setup status</p><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">What test mode includes</h1></div><div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="grid gap-6 sm:grid-cols-2"><About title="Works in this browser" items={["Screen, camera, and microphone capture", "Password-protected browser-only share links", "Comments, reactions, and downloads", "Unique viewers and watch analytics"]} /><About title="Requires full setup" items={["Authentication and separate user libraries", "Cloudflare R2 and cross-device links", "AI transcription and Resend email", "Production-grade server authorization"]} /></div><div className="mt-8 rounded-2xl bg-slate-950 p-5 text-slate-200"><p className="text-sm font-semibold">Ready to connect real services?</p><pre className="mt-3 text-xs text-slate-400"><code>npm run setup</code></pre><p className="mt-3 text-xs leading-5 text-slate-400">Choose full provider setup or edit individual sections. Test-mode recordings are never uploaded automatically.</p></div></div></div>; }

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon?: typeof Eye }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{Icon && <span className="mb-4 grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>}<p className="text-2xl font-bold tracking-[-.035em]">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>; }
function About({ title, items }: { title: string; items: string[] }) { return <section><h2 className="text-sm font-bold">{title}</h2><ul className="mt-4 space-y-3">{items.map((item) => <li key={item} className="flex gap-2 text-sm leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{item}</li>)}</ul></section>; }
