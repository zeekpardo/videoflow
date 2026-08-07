"use client";

import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Mic, Monitor, Pause, ShieldCheck, Square } from "lucide-react";
import { RecordVideoButton } from "@/components/videos/record-video-button";
import { appConfig } from "@/lib/config";
import { videoEditorHref } from "@/lib/video-routes";

export default function RecordPage() {
  const router = useRouter();
  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-primary">Ready to record</p>
          <h1 className="text-3xl font-bold tracking-[-.04em] text-slate-950 sm:text-4xl">Create a new video</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Capture your screen, camera, or both. Review it privately before anything is uploaded.</p>
        </div>
        <div className="self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500 shadow-sm sm:self-auto">Up to 1080p · 30 fps</div>
      </div>

      <section className="relative overflow-hidden rounded-[28px] border border-[#dce2ef] bg-[#eef2fa] p-4 shadow-[0_24px_70px_rgba(39,47,88,.08)] sm:p-7 lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_65%_0%,rgba(109,91,252,.14),transparent_40%)]" />
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_28px_70px_rgba(42,50,90,.13)]">
          <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5 sm:px-7">
            <div className="h-2.5 w-24 rounded-full bg-slate-100" />
            <div className="h-8 w-20 rounded-lg bg-primary" />
          </div>
          <div className="grid min-h-[340px] sm:grid-cols-[210px_1fr] lg:min-h-[460px]">
            <div className="hidden border-r border-slate-100 p-6 sm:block">
              <div className="h-3 w-28 rounded-full bg-slate-200" />
              <div className="mt-5 space-y-3"><div className="h-2.5 w-full rounded-full bg-slate-100" /><div className="h-2.5 w-3/4 rounded-full bg-slate-100" /><div className="h-2.5 w-2/3 rounded-full bg-slate-100" /></div>
            </div>
            <div className="relative flex flex-col items-center justify-center p-7 text-center">
              <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary"><Monitor className="h-7 w-7" /></div>
              <h2 className="text-2xl font-bold tracking-[-.035em] text-slate-900">What would you like to record?</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Choose your capture mode, microphone, and camera in the next step.</p>
              <RecordVideoButton
                label="Set up recording"
                size="lg"
                className="mt-6 h-12 rounded-xl px-6 font-semibold shadow-lg shadow-primary/20"
                onSaved={(id) => router.push(videoEditorHref(id))}
              />
              <div className="mt-7 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-50 px-3 py-1.5"><Monitor className="mr-1.5 inline h-3.5 w-3.5" /> Screen</span>
                <span className="rounded-full bg-slate-50 px-3 py-1.5"><Camera className="mr-1.5 inline h-3.5 w-3.5" /> Camera</span>
                <span className="rounded-full bg-slate-50 px-3 py-1.5"><Mic className="mr-1.5 inline h-3.5 w-3.5" /> Microphone</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mx-auto -mt-7 flex w-fit items-center gap-2 rounded-full border border-white/90 bg-white p-2 shadow-[0_18px_45px_rgba(33,40,75,.16)]">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500"><Mic className="h-4 w-4" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500"><Camera className="h-4 w-4" /></span>
          <span className="grid h-14 w-14 place-items-center rounded-full border-[5px] border-red-400 bg-white"><Square className="h-5 w-5 fill-red-400 text-red-400" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500"><Pause className="h-4 w-4" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><Monitor className="h-4 w-4" /></span>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-500"><CheckCircle2 className="h-4 w-4" /></span><div><p className="text-sm font-semibold">R2 storage</p><p className="text-xs text-slate-400">Private by default</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-4 w-4" /></span><div><p className="text-sm font-semibold">Review before upload</p><p className="text-xs text-slate-400">Nothing is auto-published</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><Monitor className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{appConfig.maxRecordingMinutes}-minute limit</p><p className="text-xs text-slate-400">Auto-stops safely</p></div></div>
      </div>
    </div>
  );
}
