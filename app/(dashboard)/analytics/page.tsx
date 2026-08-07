"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { BarChart3, Eye, Film, Loader2, Share2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

export default function AnalyticsPage() {
  const videos = useQuery(api.videos.list, {});
  if (videos === undefined) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const views = videos.reduce((total, video) => total + video.viewCount, 0);
  const shared = videos.filter((video) => video.visibility === "public").length;
  const cards = [{ label: "Total videos", value: videos.length, icon: Film }, { label: "Total views", value: views, icon: Eye }, { label: "Shared links", value: shared, icon: Share2 }];
  return (
    <div className="space-y-7">
      <div><p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Viewer insights</p><h1 className="text-3xl font-bold tracking-[-.04em] sm:text-4xl">Analytics</h1><p className="mt-2 text-sm text-slate-500">See reach at a glance, then open any video for completion data.</p></div>
      <div className="grid gap-4 sm:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="mb-5 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><p className="text-3xl font-bold tracking-[-.04em]">{value}</p><p className="mt-1 text-sm text-slate-500">{label}</p></div>)}</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h2 className="font-semibold">Top videos</h2></div>{videos.length ? <div className="space-y-2">{[...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 8).map((video) => <Link href={`/videos/${video._id}`} key={video._id} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-slate-50"><span className="min-w-0 truncate text-sm font-medium">{video.title}</span><span className="ml-4 flex shrink-0 items-center gap-1.5 text-xs text-slate-400"><Eye className="h-3.5 w-3.5" />{video.viewCount}</span></Link>)}</div> : <p className="py-10 text-center text-sm text-slate-500">Analytics will appear after your first recording.</p>}</div>
    </div>
  );
}
