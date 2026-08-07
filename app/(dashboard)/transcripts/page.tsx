"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Captions, CheckCircle2, Clock3, FileText, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

const statusCopy = {
  done: { label: "Ready", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  pending: { label: "Processing", icon: Clock3, className: "bg-amber-50 text-amber-600" },
  too_large: { label: "Audio too large", icon: FileText, className: "bg-slate-100 text-slate-500" },
  error: { label: "Needs attention", icon: FileText, className: "bg-red-50 text-red-500" },
  none: { label: "Not generated", icon: FileText, className: "bg-slate-100 text-slate-500" },
} as const;

export default function TranscriptsPage() {
  const videos = useQuery(api.videos.list, {});
  return (
    <div className="space-y-7">
      <div><p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Searchable content</p><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">Transcripts</h1><p className="mt-2 text-sm text-slate-500">Open a video to search its transcript and jump to a moment.</p></div>
      {videos === undefined ? <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : videos.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white py-20 text-center"><Captions className="mx-auto mb-4 h-8 w-8 text-primary" /><p className="font-semibold">No transcripts yet</p><p className="mt-1 text-sm text-slate-500">Transcripts appear after you record a video with microphone audio.</p></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {videos.map((video, index) => {
            const status = statusCopy[video.transcriptStatus];
            const Icon = status.icon;
            return <Link key={video._id} href={`/videos/${video._id}`} className={`flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 ${index ? "border-t border-slate-100" : ""}`}><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{video.title}</p><p className="mt-1 text-xs text-slate-400">{new Date(video.createdAt).toLocaleDateString()}</p></div><span className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status.className}`}><Icon className="h-3.5 w-3.5" />{status.label}</span></Link>;
          })}
        </div>
      )}
    </div>
  );
}
