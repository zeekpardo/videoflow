"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useAction, useMutation, useQuery } from "convex/react";
import { Captions, Check, ChevronRight, Copy, Download, Eye, FolderCog, Gauge, ImageIcon, Link2, ListChecks, Loader2, MousePointerClick, Plus, Save, Sparkles, Upload, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { EditorEnhanceContext, EditorTranscript } from "@/components/videos/video-editor-workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { VideoSocialPublishing } from "@/components/videos/video-social-publishing";
import { appConfig } from "@/lib/config";
import {
  applyTemplateToEditState,
  captionsToSrt,
  captionsToVtt,
  cutsFromPolishSuggestions,
  detectAudioSilences,
  magicPolishSuggestions,
  normalizeCaptionCues,
  normalizeCaptionStyle,
  parseCaptionFile,
  smartFocusZooms,
  transcriptToCaptionCues,
  type CaptionCue,
  type CaptionStyle,
  type DirectorPlan,
  type VideoTemplateSettings,
} from "@/lib/video-v2";

const DEFAULT_STYLE = normalizeCaptionStyle();

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Section({ title, description, icon, children, defaultOpen = false }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return <details open={defaultOpen} className="group overflow-hidden rounded-xl border border-slate-200 bg-white"><summary className="flex cursor-pointer list-none items-center gap-3 p-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{title}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-400">{description}</span></span><ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" /></summary><div className="space-y-3 border-t border-slate-100 p-3.5">{children}</div></details>;
}

export function VideoV2Panel({
  videoId,
  title,
  durationMs,
  transcript,
  editor,
  primarySrc,
  onCaptureSopVisual,
}: {
  videoId: Id<"videos">;
  title: string;
  durationMs: number;
  transcript: EditorTranscript;
  editor: EditorEnhanceContext;
  primarySrc: string;
  onCaptureSopVisual?: (timestampMs: number) => Promise<{ assetId: string }>;
}) {
  const captionTrack = useQuery(api.videoFlowV2.getCaptionTrack, { videoId });
  const interactions = useQuery(api.videoFlowV2.listInteractiveElements, { videoId });
  const templates = useQuery(api.videoFlowV2.listTemplates, {});
  const documents = useQuery(api.videoFlowV2.listDocuments, { videoId });
  const jobs = useQuery(api.videoFlowV2.listMediaJobs, { videoId });
  const taskProposals = useQuery(api.videoFlowV2.listTaskProposals, { videoId });
  const tasks = useQuery(api.videoFlowV2.listTasks, { videoId });
  const saveCaptions = useMutation(api.videoFlowV2.saveCaptionTrack);
  const saveInteraction = useMutation(api.videoFlowV2.saveInteractiveElement);
  const removeInteraction = useMutation(api.videoFlowV2.removeInteractiveElement);
  const saveTemplate = useMutation(api.videoFlowV2.saveTemplate);
  const updateVideo = useMutation(api.videos.update);
  const enqueueRender = useMutation(api.videoFlowV2.enqueueRender);
  const cancelMediaJob = useMutation(api.videoFlowV2.cancelMediaJob);
  const attachDocumentVisuals = useMutation(api.videoFlowV2.attachDocumentVisuals);
  const acceptTaskProposal = useMutation(api.videoFlowV2.acceptTaskProposal);
  const rejectTaskProposal = useMutation(api.videoFlowV2.rejectTaskProposal);
  const createTask = useMutation(api.videoFlowV2.createTask);
  const updateTask = useMutation(api.videoFlowV2.updateTask);
  const generateDocument = useAction(api.videoFlowV2Actions.generateDocument);
  const generateDirectorPlan = useAction(api.videoFlowV2Actions.generateDirectorPlan);
  const generateMetadata = useAction(api.videoFlowV2Actions.generateMetadata);
  const generateTaskProposals = useAction(api.videoFlowV2Actions.generateTaskProposals);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [captionDirty, setCaptionDirty] = useState(false);
  const [silenceRanges, setSilenceRanges] = useState<Array<{ startMs: number; endMs: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [directorGoal, setDirectorGoal] = useState("Make this concise, polished, and easy to follow");
  const [directorPlan, setDirectorPlan] = useState<(DirectorPlan & { usedAi?: boolean }) | null>(null);
  const [documentPreviewId, setDocumentPreviewId] = useState<Id<"videoDocuments"> | null>(null);
  const previewDocument = documents?.find((document) => document._id === documentPreviewId) ?? null;
  const syncCaptionTrack = editor.setCaptionTrack;
  const baseSuggestions = useMemo(() => magicPolishSuggestions({
    durationMs,
    transcript: transcript.segments,
    silenceRanges,
    hasCaptionTrack: !!captionTrack,
    hasTemplate: !!templates?.length,
  }), [captionTrack, durationMs, silenceRanges, templates?.length, transcript.segments]);
  const suggestions = baseSuggestions;

  useEffect(() => {
    if (captionTrack === undefined) return;
    const handle = window.setTimeout(() => {
      setCues(captionTrack?.cues ?? []);
      setStyle(normalizeCaptionStyle(captionTrack?.style));
      setCaptionDirty(false);
      syncCaptionTrack(captionTrack ? { language: captionTrack.language, revision: captionTrack.revision, cues: captionTrack.cues, style: normalizeCaptionStyle(captionTrack.style) } : null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [captionTrack, syncCaptionTrack]);

  const persistCaptions = async (nextCues = cues, nextStyle = style) => {
    setBusy("captions");
    try {
      const normalized = normalizeCaptionCues(nextCues, durationMs);
      await saveCaptions({ videoId, language: captionTrack?.language ?? "en", cues: normalized, style: nextStyle });
      setCues(normalized);
      editor.setCaptionTrack({ language: captionTrack?.language ?? "en", revision: (captionTrack?.revision ?? 0) + 1, cues: normalized, style: nextStyle });
      setCaptionDirty(false);
      toast.success("Caption track saved");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save captions");
    } finally { setBusy(null); }
  };

  const createCaptions = async () => {
    if (!transcript.segments?.length) return toast.error("Connect transcription or import an SRT/VTT file first");
    const next = transcriptToCaptionCues(transcript.segments, durationMs);
    setCues(next);
    await persistCaptions(next, style);
  };

  const applyMagic = async (plan = directorPlan) => {
    setBusy("polish");
    try {
      const planKinds = new Set<string>(plan?.items.filter((item) => item.selected).map((item) => item.kind) ?? []);
      const planIds = new Set(plan?.items.filter((item) => item.selected).map((item) => item.id) ?? []);
      const selected = plan ? suggestions.filter((item) => {
        const kind = item.kind === "silence" || item.kind === "trim" ? "cut" : item.kind;
        return planIds.has(item.id) || (kind !== "cut" && planKinds.has(kind));
      }) : suggestions.filter((item) => item.selected);
      if (selected.some((item) => item.kind === "captions") && !captionTrack && transcript.segments?.length) {
        const next = transcriptToCaptionCues(transcript.segments, durationMs);
        setCues(next);
        const nextStyle = { ...style, preset: "karaoke" as const };
        await saveCaptions({ videoId, language: "en", cues: next, style: nextStyle });
        syncCaptionTrack({ language: "en", revision: 1, cues: next, style: nextStyle });
      }
      if (selected.some((item) => item.kind === "audio")) editor.updateEditState((state) => ({ ...state, audio: { ...state.audio, muted: false, gain: 1 } }));
      const suggestedCuts = cutsFromPolishSuggestions(selected);
      const trimSuggestions = selected.filter((item) => item.kind === "trim" && item.startMs !== undefined && item.endMs !== undefined);
      if (suggestedCuts.length || trimSuggestions.length) editor.updateEditState((state) => {
        let trim = state.trim;
        for (const suggestion of trimSuggestions) {
          if ((suggestion.startMs ?? 0) < 1_500) trim = { ...trim, startMs: Math.min(trim.endMs - 100, suggestion.endMs!) };
          else if (durationMs - (suggestion.endMs ?? durationMs) < 1_500) trim = { ...trim, endMs: Math.max(trim.startMs + 100, suggestion.startMs!) };
        }
        return { ...state, trim, cuts: [...state.cuts, ...suggestedCuts] };
      });
      if (selected.some((item) => item.kind === "template")) {
        const builtIn: VideoTemplateSettings = { name: "Polished product demo", background: "#eef1f7", screenPadding: 32, screenRadius: 18, screenShadow: true, cameraPosition: "bottom_right", captionPreset: "karaoke" };
        editor.updateEditState((state) => applyTemplateToEditState(state, builtIn));
        setStyle((current) => ({ ...current, preset: "karaoke" }));
      }
      if ((planKinds.has("title") || planKinds.has("summary")) && plan) await updateVideo({ videoId, title: planKinds.has("title") ? plan.suggestedTitle : undefined, description: planKinds.has("summary") ? plan.suggestedSummary : undefined });
      if (planKinds.has("smart_focus")) editor.updateZooms(() => smartFocusZooms(editor.project.editState.interactions.clicks, "moderate", durationMs));
      if ((selected.some((item) => item.kind === "chapters" || item.kind === "title") || planKinds.has("chapters")) && transcript.segments?.length) {
        const metadata = plan ? { title: plan.suggestedTitle, summary: plan.suggestedSummary, chapters: plan.chapters } : await generateMetadata({ videoId });
        if (!plan && selected.some((item) => item.kind === "title")) await updateVideo({ videoId, title: metadata.title, description: metadata.summary });
        if (planKinds.has("chapters") || selected.some((item) => item.kind === "chapters")) await Promise.all(metadata.chapters.map((chapter) => saveInteraction({
          videoId, kind: "chapter", startMs: chapter.startMs, endMs: Math.min(durationMs, chapter.startMs + 500), label: chapter.label, x: .5, y: .5, width: .4, height: .12, required: false,
        })));
      }
      toast.success("Magic Polish changes applied for review");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Magic Polish could not finish");
    } finally { setBusy(null); }
  };

  const createPlan = async () => {
    setBusy("director");
    try {
      const plan = await generateDirectorPlan({
        videoId, instruction: directorGoal, silenceRanges,
        hasCaptionTrack: !!captionTrack, hasTemplate: !!templates?.length,
        hasClickMarkers: !!editor.project.editState.interactions.clicks.length,
      });
      setDirectorPlan(plan);
      toast.success("Edit plan ready to preview");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "AI Director could not create a plan");
    } finally { setBusy(null); }
  };

  const createVisualDocument = async (kind: "sop" | "tutorial" | "recap" | "release_notes" | "email") => {
    setBusy("document");
    try {
      const result = await generateDocument({ videoId, kind });
      if (onCaptureSopVisual && result.visuals.length && (kind === "sop" || kind === "tutorial")) {
        const visuals: Array<{ assetId: string; timestampMs: number; caption: string }> = [];
        for (const visual of result.visuals) {
          const asset = await onCaptureSopVisual(visual.timestampMs);
          visuals.push({ ...visual, assetId: asset.assetId });
        }
        await attachDocumentVisuals({ documentId: result.documentId as Id<"videoDocuments">, visuals });
      }
      setDocumentPreviewId(result.documentId as Id<"videoDocuments">);
      toast.success(result.usedAi ? "Visual AI document generated" : "Visual transcript document generated");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not generate document");
    } finally { setBusy(null); }
  };

  const addInteractive = async (kind: "chapter" | "hotspot" | "cta" | "poll") => {
    const label = window.prompt(kind === "chapter" ? "Chapter title" : kind === "poll" ? "Question" : "Button label");
    if (!label?.trim()) return;
    const url = kind === "cta" || kind === "hotspot" ? window.prompt("Destination URL (https://…)") || undefined : undefined;
    const options = kind === "poll" ? (window.prompt("Comma-separated answers") || "Yes,No").split(",") : undefined;
    try {
      await saveInteraction({ videoId, kind, startMs: editor.activeMs, endMs: Math.min(durationMs, editor.activeMs + (kind === "chapter" ? 500 : 5_000)), label, x: .5, y: kind === "chapter" ? .5 : .75, width: .4, height: .12, url, options, required: false });
      toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} added`);
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not add interaction"); }
  };

  const builtIns: VideoTemplateSettings[] = [
    { name: "Product demo", background: "#eef1f7", screenPadding: 32, screenRadius: 18, screenShadow: true, cameraPosition: "bottom_right", captionPreset: "minimal" },
    { name: "Social pop", background: "#111827", screenPadding: 54, screenRadius: 26, screenShadow: true, cameraPosition: "top_right", captionPreset: "pop" },
    { name: "Clean tutorial", background: "#ffffff", screenPadding: 24, screenRadius: 12, screenShadow: false, cameraPosition: "bottom_left", captionPreset: "lower_third" },
  ];

  return <div className="space-y-3">
    <Dialog open={!!documentPreviewId} onOpenChange={(open) => { if (!open) setDocumentPreviewId(null); }}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{previewDocument?.title ?? "Preparing document…"}</DialogTitle><DialogDescription>Saved in this video’s Documents collection. Copy it, download Markdown, or click a screenshot to return to that moment.</DialogDescription></DialogHeader>
        {previewDocument ? <div className="space-y-4"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(previewDocument.body); toast.success("Document copied"); }}><Copy className="h-3.5 w-3.5" />Copy</Button><Button size="sm" variant="outline" onClick={() => downloadText(`${previewDocument.title}.md`, previewDocument.body, "text/markdown")}><Download className="h-3.5 w-3.5" />Download .md</Button></div><div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{previewDocument.body}</div>{previewDocument.visuals?.length ? <div className="grid gap-3 sm:grid-cols-2">{previewDocument.visuals.map((visual) => <button key={`${visual.assetId}-${visual.timestampMs}`} type="button" onClick={() => { editor.seek(visual.timestampMs); setDocumentPreviewId(null); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left"><Image unoptimized src={visual.url} alt={visual.caption} width={640} height={360} className="aspect-video w-full object-cover" /><span className="block p-2 text-xs text-slate-600">{Math.floor(visual.timestampMs / 60_000)}:{String(Math.floor(visual.timestampMs / 1_000) % 60).padStart(2, "0")} · {visual.caption}</span></button>)}</div> : null}</div> : <p className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Saving document and screenshots…</p>}
      </DialogContent>
    </Dialog>
    <input ref={importRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="hidden" onChange={async (event) => { const file = event.currentTarget.files?.[0]; if (!file) return; const next = parseCaptionFile(await file.text(), durationMs); if (!next.length) toast.error("No valid caption cues were found"); else { setCues(next); setCaptionDirty(true); toast.success(`${next.length} caption cues imported`); } event.currentTarget.value = ""; }} />

    <div className="rounded-xl bg-gradient-to-br from-primary to-violet-700 p-4 text-white shadow-lg shadow-primary/15">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em]"><WandSparkles className="h-4 w-4" />V2 AI Director</p>
      <p className="mt-2 text-xs leading-5 text-white/75">Describe the outcome. Director proposes an edit plan first; you decide what gets applied.</p>
      <Input value={directorGoal} onChange={(event) => setDirectorGoal(event.target.value)} maxLength={1_000} aria-label="AI Director goal" className="mt-3 border-white/20 bg-white/10 text-xs text-white placeholder:text-white/45" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" disabled={busy !== null} onClick={async () => { setBusy("analysis"); try { const ranges = await detectAudioSilences(primarySrc); setSilenceRanges(ranges); toast.success(ranges.length ? `${ranges.length} quiet sections found` : "No long silent sections found"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Audio analysis failed"); } finally { setBusy(null); } }}>{busy === "analysis" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}Pauses</Button>
        <Button variant="secondary" disabled={busy !== null || !transcript.segments?.length} onClick={() => void createPlan()}>{busy === "director" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Create plan</Button>
      </div>
      {directorPlan && <div className="mt-3 rounded-xl bg-slate-950/25 p-3">
        <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold">{directorPlan.headline}</p><p className="mt-1 text-[10px] leading-4 text-white/65">{directorPlan.rationale}</p></div><span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold">{directorPlan.usedAi ? "AI" : "Local"}</span></div>
        <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{directorPlan.items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white/10 p-2"><input type="checkbox" checked={item.selected} onChange={(event) => setDirectorPlan((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? { ...row, selected: event.target.checked } : row) } : current)} className="mt-0.5 accent-white" /><span><span className="block text-[11px] font-semibold">{item.label}</span><span className="block text-[10px] leading-4 text-white/65">{item.description}</span></span></label>)}</div>
        <p className="mt-2 text-[10px] text-white/55">Preview only · Applying creates normal editor history, so Undo remains available.</p>
        <Button variant="secondary" className="mt-3 w-full" disabled={busy !== null || !directorPlan.items.some((item) => item.selected)} onClick={() => void applyMagic(directorPlan)}>{busy === "polish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Apply {directorPlan.items.filter((item) => item.selected).length} selected changes</Button>
      </div>}
    </div>

    <Section title="Editable & kinetic captions" description="Edit, import, style, and burn captions into published video." icon={<Captions className="h-4 w-4" />} defaultOpen>
      {!cues.length ? <Button className="w-full" variant="outline" onClick={() => void createCaptions()}><Sparkles className="h-4 w-4" />Create from transcript</Button> : <div className="max-h-56 space-y-2 overflow-y-auto">{cues.map((cue, index) => <div key={cue.id} className="rounded-lg border border-slate-200 p-2"><Input value={cue.text} onChange={(event) => { const next = cues.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value, words: undefined } : item); setCues(next); setCaptionDirty(true); }} className="h-8 text-xs" /><div className="mt-2 grid grid-cols-2 gap-2"><Input aria-label="Caption start seconds" type="number" step=".1" value={(cue.startMs / 1_000).toFixed(1)} onChange={(event) => { setCues(cues.map((item, itemIndex) => itemIndex === index ? { ...item, startMs: Number(event.target.value) * 1_000, words: undefined } : item)); setCaptionDirty(true); }} className="h-7 text-[10px]" /><Input aria-label="Caption end seconds" type="number" step=".1" value={(cue.endMs / 1_000).toFixed(1)} onChange={(event) => { setCues(cues.map((item, itemIndex) => itemIndex === index ? { ...item, endMs: Number(event.target.value) * 1_000, words: undefined } : item)); setCaptionDirty(true); }} className="h-7 text-[10px]" /></div></div>)}</div>}
      <div className="grid grid-cols-2 gap-2"><select aria-label="Caption animation" value={style.preset} onChange={(event) => { setStyle({ ...style, preset: event.target.value as CaptionStyle["preset"] }); setCaptionDirty(true); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="minimal">Minimal</option><option value="karaoke">Karaoke</option><option value="pop">Pop</option><option value="lower_third">Lower third</option></select><select aria-label="Caption position" value={style.position} onChange={(event) => { setStyle({ ...style, position: event.target.value as CaptionStyle["position"] }); setCaptionDirty(true); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></div>
      <label className="flex items-center justify-between text-xs text-slate-600"><span>Burn captions into exports</span><Switch checked={style.burnIn} onCheckedChange={(burnIn) => { setStyle({ ...style, burnIn }); setCaptionDirty(true); }} /></label>
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={() => importRef.current?.click()}><Upload className="h-3.5 w-3.5" />Import</Button><Button size="sm" disabled={!captionDirty || busy === "captions"} onClick={() => void persistCaptions()}>{busy === "captions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save</Button><Button size="sm" variant="outline" disabled={!cues.length} onClick={() => downloadText(`${title}.srt`, captionsToSrt(cues), "application/x-subrip")}><Download className="h-3.5 w-3.5" />SRT</Button><Button size="sm" variant="outline" disabled={!cues.length} onClick={() => downloadText(`${title}.vtt`, captionsToVtt(cues), "text/vtt")}><Download className="h-3.5 w-3.5" />VTT</Button></div>
    </Section>

    <Section title="Smart Focus" description="Turn manual click markers into connected zoom animations." icon={<MousePointerClick className="h-4 w-4" />}>
      <div className="grid grid-cols-3 gap-2">{(["subtle", "moderate", "energetic"] as const).map((intensity) => <Button key={intensity} size="sm" variant="outline" disabled={!editor.project.editState.interactions.clicks.length} onClick={() => { editor.updateZooms(() => smartFocusZooms(editor.project.editState.interactions.clicks, intensity, durationMs)); toast.success(`${intensity} Smart Focus applied`); }} className="px-1 text-[10px] capitalize">{intensity}</Button>)}</div>
      {!editor.project.editState.interactions.clicks.length && <p className="text-[11px] leading-4 text-slate-400">Add click markers with the Clicks tool first. Automatic desktop capture remains available through a future helper.</p>}
    </Section>

    <Section title="Branded templates" description="Reuse layouts, webcam placement, and caption styles." icon={<FolderCog className="h-4 w-4" />}>
      {[...builtIns, ...(templates ?? []).map((template) => ({ ...template, name: template.name }) as VideoTemplateSettings)].map((template) => <button type="button" key={template.name} onClick={() => { editor.updateEditState((state) => applyTemplateToEditState(state, template)); setStyle((current) => ({ ...current, preset: template.captionPreset })); toast.success(`${template.name} applied`); }} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:border-primary/30"><span>{template.name}</span><Check className="h-3.5 w-3.5 text-slate-300" /></button>)}
      <Button variant="outline" size="sm" className="w-full" onClick={async () => { const name = window.prompt("Template name", "My brand preset"); if (!name) return; try { await saveTemplate({ name, background: "#eef1f7", screenPadding: 32, screenRadius: editor.project.editState.screen.cornerRadius, screenShadow: true, cameraPosition: "bottom_right", captionPreset: style.preset }); toast.success("Template saved"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not save template"); } }}><Plus className="h-3.5 w-3.5" />Save current as template</Button>
    </Section>

    <Section title="Interactive video" description="Add chapters, hotspots, CTAs, and viewer polls." icon={<Link2 className="h-4 w-4" />}>
      <div className="grid grid-cols-2 gap-2">{(["chapter", "hotspot", "cta", "poll"] as const).map((kind) => <Button key={kind} size="sm" variant="outline" onClick={() => void addInteractive(kind)} className="capitalize"><Plus className="h-3.5 w-3.5" />{kind}</Button>)}</div>
      <div className="space-y-1">{interactions?.map((item) => <div key={item._id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{item.kind}: {item.label}</span><span className="text-[9px] text-slate-400">{item.analytics.clicked + item.analytics.answered} actions</span><button type="button" onClick={() => void removeInteraction({ elementId: item._id })} className="text-[10px] font-semibold text-red-500">Remove</button></div>)}</div>
    </Section>

    {appConfig.features.automaticTasks && <Section title="Tasks from this video" description="Propose concrete work from transcripts, comments, and requested changes before creating anything." icon={<ListChecks className="h-4 w-4" />} defaultOpen>
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={busy === "tasks"} onClick={async () => { setBusy("tasks"); try { const result = await generateTaskProposals({ videoId }); toast.success(result.count ? `${result.count} ${result.usedAi ? "AI-assisted" : "local"} task proposals ready` : "No concrete tasks found"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not analyze tasks"); } finally { setBusy(null); } }}>{busy === "tasks" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Analyze video</Button><Button size="sm" variant="outline" onClick={async () => { const taskTitle = window.prompt("Task title"); if (!taskTitle?.trim()) return; await createTask({ videoId, title: taskTitle, sourceTimestampMs: editor.activeMs }); toast.success("Task created"); }}><Plus className="h-3.5 w-3.5" />Add at playhead</Button></div>
      <p className="text-[10px] leading-4 text-slate-400">Proposals are private and require approval. AI is optional; deterministic extraction still uses explicit action language and reviewer change requests.</p>
      <div className="space-y-2">{taskProposals?.filter((proposal) => proposal.status === "proposed").map((proposal) => <div key={proposal._id} className="rounded-lg border border-slate-200 p-2.5"><div className="flex items-start gap-2"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => proposal.sourceTimestampMs !== undefined && editor.seek(proposal.sourceTimestampMs)}><span className="block text-[11px] font-semibold text-slate-700">{proposal.title}</span><span className="mt-0.5 block text-[9px] text-slate-400">{proposal.sourceKind}{proposal.sourceTimestampMs === undefined ? "" : ` · ${Math.floor(proposal.sourceTimestampMs / 1_000)}s`} · {Math.round(proposal.confidence * 100)}%</span></button><Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" aria-label={`Accept ${proposal.title}`} onClick={() => void acceptTaskProposal({ proposalId: proposal._id })}><Check className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" aria-label={`Reject ${proposal.title}`} onClick={() => void rejectTaskProposal({ proposalId: proposal._id })}><X className="h-3.5 w-3.5" /></Button></div></div>)}</div>
      <div className="space-y-1.5">{tasks?.map((task) => <button key={task._id} type="button" onClick={() => void updateTask({ taskId: task._id, status: task.status === "done" ? "todo" : "done" })} className="flex w-full items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-left"><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${task.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}>{task.status === "done" && <Check className="h-3 w-3" />}</span><span className="min-w-0 flex-1"><span className={`block text-[11px] font-semibold ${task.status === "done" ? "text-slate-400 line-through" : "text-slate-700"}`}>{task.title}</span><span className="block text-[9px] text-slate-400">{task.sourceKind}{task.sourceTimestampMs === undefined ? "" : ` · ${Math.floor(task.sourceTimestampMs / 1_000)}s`}</span></span></button>)}</div>
    </Section>}

    <Section title="Background publishing" description="Queue a revisioned MP4 and close the editor." icon={<Gauge className="h-4 w-4" />}>
      <div className="grid grid-cols-3 gap-2">{(["native", "1080p", "720p"] as const).map((preset) => <Button key={preset} size="sm" variant="outline" disabled={busy === "render"} onClick={async () => { setBusy("render"); try { await editor.save(); await enqueueRender({ videoId, preset, format: "mp4" }); toast.success(`${preset} MP4 queued`); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not queue render"); } finally { setBusy(null); } }}>{preset}</Button>)}</div>
      <div className="space-y-2">{jobs?.slice(0, 5).map((job) => <div key={job._id} className="rounded-lg border border-slate-200 p-2"><div className="flex items-center justify-between text-[11px]"><span className="font-semibold text-slate-700">{job.preset} {job.format.toUpperCase()}</span><span className="capitalize text-slate-400">{job.status.replace("_", " ")}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>{!["ready", "failed", "canceled", "superseded"].includes(job.status) && <button type="button" className="mt-2 text-[10px] font-semibold text-red-500" onClick={() => void cancelMediaJob({ jobId: job._id })}>Cancel</button>}</div>)}</div>
    </Section>

    {appConfig.features.socialPublishing && <VideoSocialPublishing videoId={videoId} defaultTitle={title} />}

    <Section title="Documents & visual SOPs" description="Saved with this video in its private Documents collection—open, copy, or download them here." icon={<ImageIcon className="h-4 w-4" />} defaultOpen>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] leading-4 text-indigo-800"><strong className="block">One clear destination</strong>Generated text and captured frames stay attached to this video. They are not placed in an unknown folder or downloaded automatically.</div>
      <div className="grid grid-cols-2 gap-2">{(["sop", "tutorial", "recap", "release_notes", "email"] as const).map((kind) => <Button key={kind} size="sm" variant="outline" disabled={busy === "document" || !transcript.segments?.length} onClick={() => void createVisualDocument(kind)} className="text-[10px] capitalize">{kind.replace("_", " ")}</Button>)}</div>
      {!transcript.segments?.length && <p className="text-[11px] text-slate-400">A transcript is required. Recording and publishing continue to work without AI.</p>}
      {documents?.map((document) => <div key={document._id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{document.title}</span><Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => setDocumentPreviewId(document._id)}><Eye className="h-3 w-3" />Open</Button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Download ${document.title}`} onClick={() => downloadText(`${document.title}.md`, document.body, "text/markdown")}><Download className="h-3.5 w-3.5" /></Button></div>{document.visuals?.length ? <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 p-2">{document.visuals.map((visual) => <button key={`${visual.assetId}-${visual.timestampMs}`} type="button" onClick={() => editor.seek(visual.timestampMs)} className="group overflow-hidden rounded-md bg-white text-left"><Image unoptimized src={visual.url} alt={visual.caption} width={320} height={180} className="aspect-video w-full object-cover" /><span className="block truncate px-1.5 py-1 text-[9px] text-slate-500">{Math.floor(visual.timestampMs / 60_000)}:{String(Math.floor(visual.timestampMs / 1_000) % 60).padStart(2, "0")} · {visual.caption}</span></button>)}</div> : null}</div>)}
    </Section>
  </div>;
}
