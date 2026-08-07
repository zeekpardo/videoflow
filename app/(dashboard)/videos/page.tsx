"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Search, Video as VideoIcon, Loader2, Library, FolderPlus, Folder, Star, Archive, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { RecordVideoButton } from "@/components/videos/record-video-button";
import { VideoCard } from "@/components/videos/video-card";
import { ProductionVideoQuickPreview } from "@/components/videos/production-video-quick-preview";
import { videoEditorHref } from "@/lib/video-routes";
import type { Id } from "@/convex/_generated/dataModel";
import { appConfig } from "@/lib/config";

export default function VideosPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<Id<"videos"> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState("all");
  const videos = useQuery(api.videos.list, {});
  const workspace = useQuery(api.videoFlowV2.workspace, {});
  const searchMatches = useQuery(api.videoFlowV2.searchLibrary, search.trim() ? { query: search } : "skip");
  const createFolder = useMutation(api.videoFlowV2.createFolder);
  const organizeVideos = useMutation(api.videoFlowV2.organizeVideos);
  const removeVideo = useMutation(api.videos.remove);
  const [deleting, setDeleting] = useState(false);
  const org = new Map((workspace?.organization ?? []).map((row) => [String(row.videoId), row]));
  const matchedIds = searchMatches ? new Set(searchMatches.map(String)) : null;
  const filtered = videos?.filter((video) => {
    const row = org.get(String(video._id));
    if (search.trim() && matchedIds && !matchedIds.has(String(video._id))) return false;
    if (activeView === "favorites") return !!row?.favorite && !row.archivedAt;
    if (activeView === "archive") return !!row?.archivedAt;
    if (activeView.startsWith("folder:")) return !row?.archivedAt && String(row?.folderId ?? "") === activeView.slice(7);
    return !row?.archivedAt;
  });

  const changeSelection = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  const bulkOrganize = async (patch: { folderId?: Id<"videoFolders"> | null; tags?: string[]; favorite?: boolean; archived?: boolean }, message: string) => {
    try {
      await organizeVideos({ videoIds: [...selected] as Id<"videos">[], ...patch });
      setSelected(new Set());
      toast.success(message);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not organize videos");
    }
  };

  const deleteSelected = async () => {
    const ids = [...selected] as Id<"videos">[];
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? "video" : "videos"} permanently?`)) return;
    setDeleting(true);
    try {
      await Promise.all(ids.map((videoId) => removeVideo({ videoId })));
      setSelected(new Set());
      setSelectedVideoId(null);
      toast.success(`${ids.length} ${ids.length === 1 ? "video" : "videos"} deleted`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not delete the selected videos");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Your workspace</p>
          <h1 className="text-3xl font-bold tracking-[-.04em] text-slate-950 sm:text-4xl">Video library</h1>
          <p className="mt-2 text-sm text-slate-500">Every recording, transcript, and share link in one place.</p>
        </div>
        <RecordVideoButton className="h-11 rounded-xl px-5 font-semibold shadow-lg shadow-primary/15" onSaved={(id) => router.push(videoEditorHref(id))} label="New recording" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search your videos" value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 border-0 bg-slate-50 pl-10 shadow-none focus-visible:ring-1" />
        </div>
        <div className="flex items-center gap-2 px-2 text-xs text-slate-400"><Library className="h-4 w-4" /> {videos?.length ?? 0} videos</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setActiveView("all")} className={`rounded-xl px-3 py-2 text-xs font-semibold ${activeView === "all" ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600"}`}><Library className="mr-1.5 inline h-3.5 w-3.5" />All</button>
        <button type="button" onClick={() => setActiveView("favorites")} className={`rounded-xl px-3 py-2 text-xs font-semibold ${activeView === "favorites" ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600"}`}><Star className="mr-1.5 inline h-3.5 w-3.5" />Favorites</button>
        <button type="button" onClick={() => setActiveView("archive")} className={`rounded-xl px-3 py-2 text-xs font-semibold ${activeView === "archive" ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600"}`}><Archive className="mr-1.5 inline h-3.5 w-3.5" />Archive</button>
        {(workspace?.folders ?? []).map((folder) => <button key={folder._id} type="button" onClick={() => setActiveView(`folder:${folder._id}`)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${activeView === `folder:${folder._id}` ? "bg-primary text-white" : "border border-slate-200 bg-white text-slate-600"}`}><Folder className="mr-1.5 inline h-3.5 w-3.5" />{folder.name}</button>)}
        <button type="button" onClick={async () => { const name = window.prompt("Folder name"); if (!name?.trim()) return; try { await createFolder({ name }); toast.success("Folder created"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not create folder"); } }} className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-500"><FolderPlus className="mr-1.5 inline h-3.5 w-3.5" />New folder</button>
      </div>

      {selected.size > 0 && <div className="sticky top-[84px] z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-white p-3 shadow-xl shadow-primary/10">
        <span className="mr-2 text-xs font-bold text-slate-700">{selected.size} selected</span>
        <select aria-label="Move selected videos" defaultValue="" onChange={(event) => { const value = event.target.value; event.currentTarget.value = ""; if (value) void bulkOrganize({ folderId: value === "root" ? null : value as Id<"videoFolders"> }, "Videos moved"); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="" disabled>Move to…</option><option value="root">No folder</option>{(workspace?.folders ?? []).map((folder) => <option key={folder._id} value={folder._id}>{folder.name}</option>)}</select>
        <button type="button" onClick={() => void bulkOrganize({ favorite: true }, "Added to favorites")} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Star className="mr-1.5 inline h-3.5 w-3.5" />Favorite</button>
        <button type="button" onClick={() => { const tags = window.prompt("Comma-separated tags"); if (tags !== null) void bulkOrganize({ tags: tags.split(",") }, "Tags updated"); }} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Tag className="mr-1.5 inline h-3.5 w-3.5" />Tag</button>
        <button type="button" onClick={() => void bulkOrganize({ archived: activeView !== "archive" }, activeView === "archive" ? "Videos restored" : "Videos archived")} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Archive className="mr-1.5 inline h-3.5 w-3.5" />{activeView === "archive" ? "Restore" : "Archive"}</button>
        {appConfig.features.libraryDelete && <button type="button" disabled={deleting} onClick={() => void deleteSelected()} className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 disabled:opacity-50">{deleting ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 inline h-3.5 w-3.5" />}Delete</button>}
        <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>}

      {videos === undefined ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !filtered?.length ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
          <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><VideoIcon className="h-6 w-6" /></span>
          <h2 className="text-lg font-bold text-slate-900">{videos.length === 0 ? "Your first video starts here" : "No videos found"}</h2>
          <p className="mx-auto mb-6 mt-2 max-w-sm text-sm leading-6 text-slate-500">{videos.length === 0 ? "Record a screen walkthrough, camera message, or both. You can review it before saving." : "Try a different title or clear your search."}</p>
          {videos.length === 0 && <RecordVideoButton onSaved={(id) => router.push(videoEditorHref(id))} label="Record your first video" className="rounded-xl" />}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map((video) => <VideoCard key={video._id} video={video} onPreview={() => setSelectedVideoId(video._id)} selected={selected.has(String(video._id))} onSelectedChange={(checked) => changeSelection(String(video._id), checked)} />)}</div>
      )}
      <ProductionVideoQuickPreview
        videoId={selectedVideoId}
        onClose={() => setSelectedVideoId(null)}
        onDeleted={(id) => setSelected((current) => {
          const next = new Set(current);
          next.delete(String(id));
          return next;
        })}
      />
    </div>
  );
}
