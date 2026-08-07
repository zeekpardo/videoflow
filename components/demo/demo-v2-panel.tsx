"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, Check, CheckCircle2, ChevronRight, Copy, Download, Eye, FileText, Gauge, ImageIcon, Link2, Loader2, MessageCircleQuestion, MousePointerClick, Palette, Save, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import type { EditorEnhanceContext } from "@/components/videos/video-editor-workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { DemoVideo } from "@/lib/demo-video-store";
import { demoAiConsentStorageKey, demoAiGenerate, demoAiTranscribe, demoCaptionCuesFromText } from "@/lib/demo-ai-client";
import { applyTemplateToEditState, smartFocusZooms, suggestVisualSopFrames, type CaptionCue, type CaptionStyle, type VideoCaptionTrack, type VideoTemplateSettings } from "@/lib/video-v2";
import { captureVideoBlobFrameAt } from "@/lib/video-thumbnail";

function Block({ title, description, icon, children, defaultOpen = false }: { title: string; description?: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return <details open={defaultOpen} className="group overflow-hidden rounded-xl border border-slate-200 bg-white"><summary className="flex cursor-pointer list-none items-center gap-3 p-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{title}</span>{description && <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{description}</span>}</span><ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" /></summary><div className="space-y-3 border-t border-slate-100 p-3.5">{children}</div></details>;
}

const defaultCaptionStyle: CaptionStyle = { preset: "karaoke", position: "bottom", textColor: "#ffffff", highlightColor: "#facc15", backgroundColor: "#0f172acc", fontScale: 1, burnIn: true };

type DemoPlan = { title: string; summary: string; captionPhrases: string[]; plan: Array<{ id: string; kind: "title" | "captions" | "template" | "smart_focus"; label: string; description: string; selected: boolean }> };
type DemoDocument = NonNullable<DemoVideo["generatedDocuments"]>[number];

function downloadText(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function VisualThumbnail({ image, caption }: { image: Blob; caption: string }) {
  const url = useMemo(() => URL.createObjectURL(image), [image]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={caption} className="aspect-video w-full rounded-md object-cover" />;
}

export function DemoV2Panel({ video, editor, onPatch }: { video: DemoVideo; editor: EditorEnhanceContext; onPatch: (patch: Partial<DemoVideo>) => Promise<DemoVideo> }) {
  const [cues, setCues] = useState<CaptionCue[]>(video.captionTrack?.cues ?? []);
  const [style, setStyle] = useState<CaptionStyle>(video.captionTrack?.style ?? defaultCaptionStyle);
  const [busy, setBusy] = useState<string | null>(null);
  const [remaining, setRemaining] = useState({ transcription: 3, generation: 3 });
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consented, setConsented] = useState(() => typeof window !== "undefined" && sessionStorage.getItem(demoAiConsentStorageKey()) === "accepted");
  const [directorGoal, setDirectorGoal] = useState("Make this concise and easy to follow");
  const [directorPlan, setDirectorPlan] = useState<DemoPlan | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; citations: Array<{ startMs: number; endMs: number; label: string }> } | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DemoDocument | null>(null);
  const pendingAction = useRef<null | (() => Promise<void>)>(null);

  const steps = [
    ["Kinetic captions", !!video.captionTrack?.cues.length],
    ["Smart Focus", editor.project.zoomEffects.length > 0],
    ["Brand template", !!video.templateName],
    ["Interactive viewer", !!video.interactiveElements?.length],
    ["Background publish", video.demoPublishStatus === "ready"],
  ] as const;
  const completed = steps.filter(([, done]) => done).length;

  useEffect(() => {
    if (!video.captionTrack) return;
    const handle = window.setTimeout(() => {
      setCues(video.captionTrack!.cues);
      setStyle(video.captionTrack!.style);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [video.captionTrack]);

  const withConsent = (action: () => Promise<void>) => {
    if (consented) { void action(); return; }
    pendingAction.current = action;
    setConsentChecked(false);
    setConsentOpen(true);
  };

  const acceptConsent = () => {
    if (!consentChecked) return;
    sessionStorage.setItem(demoAiConsentStorageKey(), "accepted");
    setConsented(true);
    setConsentOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) void action();
  };

  const transcript = () => cues.map((cue) => cue.text).join(" ").trim();

  const saveCaptionTrack = async (nextCues = cues, nextStyle = style, revealTranscript = false) => {
    const track: VideoCaptionTrack = { language: "en", revision: (video.captionTrack?.revision ?? 0) + 1, cues: nextCues, style: nextStyle };
    setCues(nextCues);
    setStyle(nextStyle);
    editor.setCaptionTrack(track);
    await onPatch({ captionTrack: track });
    if (revealTranscript) editor.openTranscript();
    return track;
  };

  const transcribe = async () => {
    setBusy("transcription");
    try {
      const result = await demoAiTranscribe(video.videoBlob);
      const nextCues = demoCaptionCuesFromText(result.text, video.durationMs);
      setCues(nextCues);
      setRemaining((value) => ({ ...value, transcription: result.remaining }));
      await saveCaptionTrack(nextCues, style, true);
      toast.success("AI transcript added as editable captions");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not transcribe this recording");
    } finally { setBusy(null); }
  };

  const polish = async () => {
    const source = transcript();
    if (!source) { toast.error("Generate or add captions first"); return; }
    setBusy("polish");
    try {
      const response = await demoAiGenerate({ mode: "polish", title: `${video.title}. Director goal: ${directorGoal}`, transcript: source });
      const result = response.result as unknown as DemoPlan;
      if (typeof result.title !== "string" || typeof result.summary !== "string" || !Array.isArray(result.captionPhrases) || !Array.isArray(result.plan)) throw new Error("The AI result was incomplete");
      setDirectorPlan(result);
      setRemaining((value) => ({ ...value, generation: response.remaining }));
      toast.success("AI edit plan ready to preview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not polish this video");
    } finally { setBusy(null); }
  };

  const applyPlan = async () => {
    if (!directorPlan) return;
    setBusy("apply-plan");
    try {
      const kinds = new Set(directorPlan.plan.filter((item) => item.selected).map((item) => item.kind));
      const patch: Partial<DemoVideo> = {};
      if (kinds.has("title")) { patch.title = directorPlan.title; patch.description = directorPlan.summary; }
      if (kinds.has("captions")) {
        const nextCues = demoCaptionCuesFromText(directorPlan.captionPhrases.join(" "), video.durationMs);
        setCues(nextCues);
        patch.captionTrack = { language: "en", revision: (video.captionTrack?.revision ?? 0) + 1, cues: nextCues, style };
        editor.setCaptionTrack(patch.captionTrack);
      }
      if (kinds.has("template")) {
        const template: VideoTemplateSettings = { name: "Product demo", background: "#eef1f7", screenPadding: 32, screenRadius: 18, screenShadow: true, cameraPosition: "bottom_right", captionPreset: "karaoke" };
        editor.updateEditState((state) => applyTemplateToEditState({ ...state, audio: { ...state.audio, gain: 1, muted: false } }, template));
        patch.templateName = template.name;
      }
      if (kinds.has("smart_focus")) editor.updateZooms(() => smartFocusZooms(editor.project.editState.interactions.clicks, "moderate", video.durationMs));
      await onPatch(patch);
      toast.success("Selected plan applied — Undo remains available");
    } finally { setBusy(null); }
  };

  const generateDocument = async () => {
    const source = transcript();
    if (!source) { toast.error("Generate or add captions first"); return; }
    setBusy("document");
    try {
      const response = await demoAiGenerate({ mode: "document", title: video.title, transcript: source });
      const result = response.result as { title?: unknown; body?: unknown };
      if (typeof result.title !== "string" || typeof result.body !== "string") throw new Error("The AI result was incomplete");
      setRemaining((value) => ({ ...value, generation: response.remaining }));
      const suggestions = suggestVisualSopFrames(cues.map((cue) => ({ start: cue.startMs, end: cue.endMs, text: cue.text })), video.durationMs, 4);
      const visuals = [] as Array<{ timestampMs: number; caption: string; image: Blob }>;
      for (const suggestion of suggestions) visuals.push({ ...suggestion, image: await captureVideoBlobFrameAt(video.videoBlob, suggestion.timestampMs) });
      const nextDocument: DemoDocument = { id: crypto.randomUUID(), title: result.title, body: result.body, visuals, createdAt: Date.now() };
      await onPatch({ generatedDocuments: [...(video.generatedDocuments ?? []), nextDocument] });
      setPreviewDocument(nextDocument);
      toast.success("Visual SOP saved in Enhance → Documents");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the SOP");
    } finally { setBusy(null); }
  };

  const ask = async () => {
    if (question.trim().length < 3) return;
    setBusy("answer");
    try {
      const timestamped = cues.map((cue) => `[${cue.startMs}-${cue.endMs}] ${cue.text}`).join("\n");
      const response = await demoAiGenerate({ mode: "answer", title: video.title, transcript: timestamped, question });
      const result = response.result as { answer?: unknown; citations?: unknown };
      if (typeof result.answer !== "string" || !Array.isArray(result.citations)) throw new Error("The AI result was incomplete");
      setAnswer({ answer: result.answer, citations: result.citations as Array<{ startMs: number; endMs: number; label: string }> });
      setRemaining((value) => ({ ...value, generation: response.remaining }));
    } catch (error) { toast.error(error instanceof Error ? error.message : "The viewer could not answer"); }
    finally { setBusy(null); }
  };

  return <div className="space-y-3">
    <Dialog open={!!previewDocument} onOpenChange={(open) => { if (!open) setPreviewDocument(null); }}>
      <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{previewDocument?.title ?? "Visual SOP"}</DialogTitle><DialogDescription>Saved privately with this demo recording in your browser. Open it here, copy it, or download a Markdown file.</DialogDescription></DialogHeader>
        {previewDocument && <div className="space-y-4"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(previewDocument.body); toast.success("SOP copied"); }}><Copy className="h-3.5 w-3.5" />Copy</Button><Button size="sm" variant="outline" onClick={() => downloadText(`${previewDocument.title}.md`, previewDocument.body)}><Download className="h-3.5 w-3.5" />Download .md</Button></div><div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{previewDocument.body}</div>{previewDocument.visuals?.length ? <div className="grid gap-3 sm:grid-cols-2">{previewDocument.visuals.map((visual, index) => <button key={`${visual.timestampMs}-${index}`} type="button" onClick={() => { editor.seek(visual.timestampMs); setPreviewDocument(null); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left"><VisualThumbnail image={visual.image} caption={visual.caption} /><span className="block p-2 text-xs text-slate-600">{Math.floor(visual.timestampMs / 60_000)}:{String(Math.floor(visual.timestampMs / 1_000) % 60).padStart(2, "0")} · {visual.caption}</span></button>)}</div> : null}</div>}
      </DialogContent>
    </Dialog>
    <Dialog open={consentOpen} onOpenChange={(open) => { setConsentOpen(open); if (!open) pendingAction.current = null; }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Use optional AI for this demo?</DialogTitle><DialogDescription>Recording and editing stay local unless you choose an AI tool.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <p>For transcription, only the first 60 seconds of recording audio is sent through VideoFlow to OpenRouter and its selected model provider. Director, SOP, and viewer-answer tools send the caption transcript plus the instruction or question needed for that result.</p>
          <p>You receive three transcript requests and three generation requests per verified trial. Do not submit confidential, regulated, or unauthorized third-party content. AI results may be inaccurate.</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 font-medium text-slate-800"><input type="checkbox" className="mt-1 h-4 w-4" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />I understand and consent to this limited AI processing.</label>
          <a href={process.env.NEXT_PUBLIC_DEMO_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">Read the privacy policy</a>
        </div>
        <Button disabled={!consentChecked} onClick={acceptConsent}>Accept and continue</Button>
      </DialogContent>
    </Dialog>

    <div className="rounded-xl bg-gradient-to-br from-primary to-violet-700 p-4 text-white"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.14em]">V2 AI Director</p><span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold">{completed}/5</span></div><p className="mt-2 text-[11px] leading-4 text-white/70">AI proposes the plan. Nothing changes until you apply the selected actions.</p><Input value={directorGoal} onChange={(event) => setDirectorGoal(event.target.value)} className="mt-3 border-white/20 bg-white/10 text-xs text-white" /><Button variant="secondary" className="mt-3 w-full" disabled={busy !== null || remaining.generation <= 0} onClick={() => withConsent(polish)}>{busy === "polish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Create edit plan <span className="ml-auto text-[10px] opacity-60">AI · {remaining.generation} left</span></Button>{directorPlan && <div className="mt-3 space-y-2 rounded-xl bg-slate-950/20 p-3"><p className="text-xs font-bold">Preview proposed changes</p>{directorPlan.plan.map((item) => <label key={item.id} className="flex items-start gap-2 rounded-lg bg-white/10 p-2"><input type="checkbox" checked={item.selected} onChange={(event) => setDirectorPlan((current) => current ? { ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, selected: event.target.checked } : row) } : current)} className="mt-0.5" /><span><span className="block text-[11px] font-semibold">{item.label}</span><span className="block text-[10px] leading-4 text-white/60">{item.description}</span></span></label>)}<Button variant="secondary" className="w-full" disabled={busy !== null || !directorPlan.plan.some((item) => item.selected)} onClick={() => void applyPlan()}>{busy === "apply-plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Apply selected plan</Button><p className="text-[9px] text-white/50">Applied through the normal editor history, so every change remains undoable.</p></div>}</div>

    <Block title="Transcript & on-screen captions" description="Generate once, edit the words, preview them on the canvas, and keep the Transcript tool synchronized." icon={<Captions className="h-4 w-4" />} defaultOpen><Button size="sm" variant="outline" className="w-full" disabled={busy !== null || remaining.transcription <= 0} onClick={() => withConsent(transcribe)}>{busy === "transcription" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}Generate transcript · {remaining.transcription} left</Button><p className="text-[10px] leading-4 text-slate-400">Only the first 60 seconds of audio are sent. When complete, VideoFlow opens the Transcript tool and puts captions on the video canvas.</p><div className="max-h-52 space-y-2 overflow-y-auto">{cues.map((cue, index) => <Input key={cue.id} value={cue.text} onChange={(event) => setCues(cues.map((item, cueIndex) => cueIndex === index ? { ...item, text: event.target.value, words: undefined } : item))} className="h-8 text-xs" />)}</div><div className="grid grid-cols-2 gap-2"><select aria-label="Caption style" value={style.preset} onChange={(event) => setStyle({ ...style, preset: event.target.value as CaptionStyle["preset"] })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="minimal">Minimal</option><option value="karaoke">Karaoke</option><option value="pop">Pop</option><option value="lower_third">Lower third</option></select><select aria-label="Caption position" value={style.position} onChange={(event) => setStyle({ ...style, position: event.target.value as CaptionStyle["position"] })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></div><label className="flex items-center justify-between text-xs text-slate-600"><span><span className="block font-semibold text-slate-700">Include in downloads</span><span className="text-[10px] text-slate-400">Burn these captions into exported video.</span></span><Switch checked={style.burnIn} onCheckedChange={(burnIn) => setStyle({ ...style, burnIn })} /></label><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={!cues.length} onClick={editor.openTranscript}><Eye className="h-3.5 w-3.5" />Open transcript</Button><Button size="sm" disabled={!cues.length} onClick={async () => { await saveCaptionTrack(); toast.success("Captions saved and synchronized"); }}><Save className="h-3.5 w-3.5" />Save captions</Button></div></Block>

    <Block title="Smart Focus" icon={<MousePointerClick className="h-4 w-4" />}><div className="grid grid-cols-3 gap-2">{(["subtle", "moderate", "energetic"] as const).map((intensity) => <Button key={intensity} size="sm" variant="outline" className="px-1 text-[10px] capitalize" onClick={() => { editor.updateZooms(() => smartFocusZooms(editor.project.editState.interactions.clicks, intensity, video.durationMs)); toast.success(`${intensity} focus applied`); }}>{intensity}</Button>)}</div></Block>

    <Block title="Brand templates" icon={<Palette className="h-4 w-4" />}><div className="grid grid-cols-3 gap-2">{["Product demo", "Social pop", "Clean tutorial"].map((name) => <Button key={name} size="sm" variant="outline" className="h-auto px-1 py-2 text-[9px]" onClick={async () => { await onPatch({ templateName: name }); toast.success(`${name} applied`); }}>{name}</Button>)}</div></Block>

    <Block title="Interactive viewer" icon={<Link2 className="h-4 w-4" />}><div className="space-y-1">{video.interactiveElements?.map((item) => <p key={item.id} className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-600">{item.kind}: {item.label}</p>)}</div><Button size="sm" variant="outline" className="w-full" onClick={async () => { const label = window.prompt("CTA label", "Book a demo"); if (!label) return; await onPatch({ interactiveElements: [...(video.interactiveElements ?? []), { id: crypto.randomUUID(), kind: "cta", startMs: editor.activeMs, endMs: Math.min(video.durationMs, editor.activeMs + 2_000), label, url: "https://example.com" }] }); toast.success("Interactive CTA added"); }}><Link2 className="h-3.5 w-3.5" />Add timed CTA</Button></Block>

    <Block title="Askable viewer preview" icon={<MessageCircleQuestion className="h-4 w-4" />}><p className="text-[10px] leading-4 text-slate-400">Try the same transcript-grounded experience viewers get. Answers jump back to cited moments.</p><div className="flex gap-2"><Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What are the key steps?" className="h-8 text-xs" /><Button size="sm" disabled={busy !== null || remaining.generation <= 0 || !cues.length || question.trim().length < 3} onClick={() => withConsent(ask)}>{busy === "answer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}</Button></div>{answer && <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] leading-4 text-slate-700">{answer.answer}</p><div className="mt-2 flex flex-wrap gap-1">{answer.citations.map((citation, index) => <button type="button" key={`${citation.startMs}-${index}`} onClick={() => editor.seek(citation.startMs)} className="rounded-full bg-primary px-2 py-1 text-[9px] font-bold text-white">{Math.floor(citation.startMs / 60_000)}:{String(Math.floor(citation.startMs / 1_000) % 60).padStart(2, "0")} · Watch</button>)}</div></div>}<p className="text-[9px] text-slate-400">Each question uses one of the three protected generation requests.</p></Block>

    <Block title="Background publishing" icon={<Gauge className="h-4 w-4" />}><p className="text-[11px] leading-4 text-slate-400">The sales demo simulates the durable worker queue without uploading your media.</p><Button size="sm" className="w-full" disabled={video.demoPublishStatus === "processing"} onClick={async () => { await onPatch({ demoPublishStatus: "processing" }); setTimeout(() => void onPatch({ demoPublishStatus: "ready" }), 1_500); toast.success("MP4 background job queued"); }}>{video.demoPublishStatus === "processing" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing…</> : video.demoPublishStatus === "ready" ? <><CheckCircle2 className="h-3.5 w-3.5" />Published MP4 ready</> : <><Gauge className="h-3.5 w-3.5" />Queue 1080p MP4</>}</Button></Block>

    <Block title="Documents" description="Visual SOPs are saved with this recording—not hidden in another folder. Open, copy, or download them here." icon={<ImageIcon className="h-4 w-4" />} defaultOpen><div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] leading-4 text-indigo-800"><strong className="block">Stored with this demo video</strong>The SOP text and timestamped screenshots stay in this browser’s private demo storage for 72 hours.</div><Button size="sm" variant="outline" className="w-full" disabled={busy !== null || remaining.generation <= 0 || !cues.length} onClick={() => withConsent(generateDocument)}>{busy === "document" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Generate visual SOP <span className="ml-auto text-[10px] text-slate-400">AI · {remaining.generation} left</span></Button>{video.generatedDocuments?.map((document) => <div key={document.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{document.title}</p><Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => setPreviewDocument(document)}><Eye className="h-3 w-3" />Open</Button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Download ${document.title}`} onClick={() => downloadText(`${document.title}.md`, document.body)}><Download className="h-3.5 w-3.5" /></Button></div>{document.visuals?.length ? <div className="mt-2 grid grid-cols-2 gap-1.5">{document.visuals.map((visual, index) => <button key={`${visual.timestampMs}-${index}`} type="button" onClick={() => editor.seek(visual.timestampMs)} className="text-left"><VisualThumbnail image={visual.image} caption={visual.caption} /><span className="mt-1 block truncate text-[9px] text-slate-400">{Math.floor(visual.timestampMs / 60_000)}:{String(Math.floor(visual.timestampMs / 1_000) % 60).padStart(2, "0")} · {visual.caption}</span></button>)}</div> : null}</div>)}</Block>
  </div>;
}
