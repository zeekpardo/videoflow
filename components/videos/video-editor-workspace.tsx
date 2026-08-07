"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  Camera,
  Captions,
  Check,
  Crop,
  Keyboard,
  Loader2,
  Maximize2,
  Monitor,
  MousePointerClick,
  MousePointer2,
  Redo2,
  RotateCcw,
  Save,
  ScanSearch,
  Scissors,
  Settings2,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  Volume2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TranscriptPanel } from "@/components/videos/transcript-panel";
import { VideoPlayer, type VideoLayerStatus } from "@/components/videos/player/video-player";
import { EditorTimeline, type EditorSelection } from "@/components/videos/editor-timeline";
import { EditorZoomInspector, type ZoomPlacement } from "@/components/videos/editor-zoom-inspector";
import { EditorAudioInspector } from "@/components/videos/editor-audio-inspector";
import { EditorObjectsInspector } from "@/components/videos/editor-objects-inspector";
import { EditorInteractionsInspector, type InteractionSelection } from "@/components/videos/editor-interactions-inspector";
import { VideoDownloadMenu } from "@/components/videos/video-download-menu";
import { VideoPublishButton, type EditorPublishAdapter } from "@/components/videos/video-publish-button";
import {
  defaultVideoEditState,
  buildVideoTimelineMap,
  editedTimeToSourceMs,
  formatEditTime,
  normalizeVideoEditState,
  snapSourceTimeToKeptMs,
  sourceTimeToEditedMs,
  type VideoEditState,
  type VideoEditStateV2,
  type VideoClickOverlay,
  type VideoKeyOverlay,
  type VideoObjectKind,
  type VideoObjectOverlay,
  type VideoTextOverlay,
  type VideoZoomEffect,
} from "@/lib/video-edits";
import { cn } from "@/lib/utils";
import {
  captionTrackToTextOverlays,
  captionTrackToTranscriptSegments,
  type VideoCaptionTrack,
} from "@/lib/video-v2";

export interface EditorProject {
  editState: VideoEditStateV2;
  zoomEffects: VideoZoomEffect[];
}

export interface EditorTranscript {
  status: "none" | "pending" | "done" | "error" | "too_large";
  segments?: { start: number; end: number; text: string }[];
  localMode?: boolean;
}

export interface EditorEnhanceContext {
  project: EditorProject;
  activeMs: number;
  transcript: EditorTranscript;
  captionTrack: VideoCaptionTrack | null;
  seek: (timeMs: number) => void;
  openTranscript: () => void;
  setCaptionTrack: (track: VideoCaptionTrack | null) => void;
  updateEditState: (updater: (state: VideoEditStateV2) => VideoEditStateV2) => void;
  updateZooms: (updater: (zooms: VideoZoomEffect[]) => VideoZoomEffect[]) => void;
  save: () => Promise<void>;
}

interface VideoEditorWorkspaceProps {
  videoKey: string;
  title: string;
  mode: "screen" | "screen_camera" | "camera";
  durationMs: number;
  src: string;
  sourceMimeType?: string | null;
  screenSrc?: string | null;
  cameraSrc?: string | null;
  poster?: string | null;
  initialEditState?: VideoEditState;
  initialZoomEffects?: VideoZoomEffect[];
  initialCaptionTrack?: VideoCaptionTrack | null;
  transcript: EditorTranscript;
  backHref: string;
  environmentLabel?: string;
  className?: string;
  headerActions?: React.ReactNode;
  ownerSettings?: React.ReactNode;
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  onUploadGraphic?: (file: File) => Promise<{ assetId: string; url: string }>;
  publishAdapter?: EditorPublishAdapter;
  renderEnhancePanel?: (context: EditorEnhanceContext) => React.ReactNode;
  onSave: (project: EditorProject) => Promise<unknown>;
  onPlayerReady?: (player: HTMLVideoElement | null) => void;
  onAnalyticsEvent?: (eventName: "export_started" | "export_completed" | "export_failed", properties?: Record<string, string | number | boolean | null>) => void;
}

type EditorTool = "select" | "cut" | "text" | "crop" | "zoom" | "screen" | "camera" | "audio" | "objects" | "interactions" | "transcript" | "enhance" | "settings";

const tools: { id: EditorTool; label: string; shortcut: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { id: "cut", label: "Cut", shortcut: "C", icon: Scissors },
  { id: "text", label: "Text", shortcut: "T", icon: Type },
  { id: "crop", label: "Crop", shortcut: "R", icon: Crop },
  { id: "zoom", label: "Zoom", shortcut: "Z", icon: ScanSearch },
  { id: "screen", label: "Screen", shortcut: "S", icon: Monitor },
  { id: "camera", label: "Camera", shortcut: "W", icon: Camera },
  { id: "audio", label: "Audio", shortcut: "A", icon: Volume2 },
  { id: "objects", label: "Objects", shortcut: "O", icon: Box },
  { id: "interactions", label: "Clicks", shortcut: "I", icon: MousePointerClick },
  { id: "transcript", label: "Transcript", shortcut: "P", icon: Captions },
  { id: "enhance", label: "Enhance", shortcut: "E", icon: Sparkles },
  { id: "settings", label: "Settings", shortcut: "G", icon: Settings2 },
];

const toolShortcuts: Record<string, EditorTool> = {
  v: "select",
  c: "cut",
  t: "text",
  r: "crop",
  z: "zoom",
  s: "screen",
  w: "camera",
  a: "audio",
  o: "objects",
  i: "interactions",
  p: "transcript",
  e: "enhance",
  g: "settings",
};

const CANVAS_ZOOM_MIN = 0.5;
const CANVAS_ZOOM_MAX = 2;
const CANVAS_ZOOM_STEP = 0.25;

const shortcutGroups = [
  {
    title: "Playback",
    items: [
      ["Play or pause", "Space / K"],
      ["Seek one second", "← / →"],
      ["Seek five seconds", "Shift + ← / →"],
    ],
  },
  {
    title: "Editing",
    items: [
      ["Undo", "⌘/Ctrl + Z"],
      ["Redo", "⌘/Ctrl + Shift + Z"],
      ["Save now", "⌘/Ctrl + S"],
      ["Delete selection", "Delete / Backspace"],
      ["Cancel or clear selection", "Esc"],
    ],
  },
  {
    title: "Tools",
    items: [
      ["Select · Cut · Text · Crop", "V · C · T · R"],
      ["Zoom effect · Screen · Camera", "Z · S · W"],
      ["Audio · Objects · Clicks", "A · O · I"],
      ["Transcript · Enhance · Settings", "P · E · G"],
    ],
  },
  {
    title: "Canvas view",
    items: [
      ["Zoom in or out", "⌘/Ctrl +  + / −"],
      ["Fit canvas", "⌘/Ctrl + 0"],
    ],
  },
] as const;

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select, [role='textbox']")) return true;
  const editable = target.closest<HTMLElement>("[contenteditable]");
  return !!editable && editable.getAttribute("contenteditable") !== "false";
}

function isRangeInputTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest("input[type='range']");
}

function cloneProject(project: EditorProject): EditorProject {
  return structuredClone(project);
}

function editorProject(mode: VideoEditorWorkspaceProps["mode"], durationMs: number, editState: VideoEditState | undefined, zoomEffects: VideoZoomEffect[] | undefined, hasCamera: boolean): EditorProject {
  return {
    editState: normalizeVideoEditState(editState ?? defaultVideoEditState(mode, undefined, durationMs), durationMs, hasCamera),
    zoomEffects: (zoomEffects ?? []).map((effect) => ({ ...effect })),
  };
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>;
}

function RangeControl({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display?: string; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-xs font-medium text-slate-600"><span>{label}</span><span className="font-mono text-[11px] text-slate-400">{display ?? value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full cursor-pointer accent-primary" />
    </label>
  );
}

function TimeField({ label, valueMs, durationMs, onChange }: { label: string; valueMs: number; durationMs: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-500">
      <span>{label}</span>
      <Input type="number" min={0} max={durationMs / 1000} step={0.1} value={(valueMs / 1000).toFixed(1)} onChange={(event) => onChange(Math.round(Number(event.target.value) * 1000))} className="h-9 font-mono text-xs" />
    </label>
  );
}

export function VideoEditorWorkspace({
  videoKey,
  title,
  mode,
  durationMs,
  src,
  sourceMimeType,
  screenSrc,
  cameraSrc,
  poster,
  initialEditState,
  initialZoomEffects,
  initialCaptionTrack,
  transcript,
  backHref,
  environmentLabel = "Editor",
  className,
  headerActions,
  ownerSettings,
  graphicUrls,
  onUploadGraphic,
  publishAdapter,
  renderEnhancePanel,
  onSave,
  onPlayerReady,
  onAnalyticsEvent,
}: VideoEditorWorkspaceProps) {
  const [project, setProject] = useState(() => editorProject(mode, durationMs, initialEditState, initialZoomEffects, !!screenSrc && !!cameraSrc));
  const [captionTrack, setCaptionTrackState] = useState<VideoCaptionTrack | null>(initialCaptionTrack ?? null);
  const [generatedTranscript, setGeneratedTranscript] = useState<EditorTranscript | null>(() => initialCaptionTrack?.cues.length ? {
    status: "done",
    segments: captionTrackToTranscriptSegments(initialCaptionTrack),
    localMode: transcript.localMode,
  } : null);
  const resolvedTranscript = generatedTranscript ?? transcript;
  const [tool, setTool] = useState<EditorTool>(() => transcript.status === "done" && transcript.segments?.length ? "transcript" : "select");
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [activeMs, setActiveMs] = useState(0);
  const [zoomPlacement, setZoomPlacement] = useState<ZoomPlacement>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasAspect, setCanvasAspect] = useState(16 / 9);
  const [canvasViewport, setCanvasViewport] = useState({ width: 0, height: 0 });
  const [cameraMovePreview, setCameraMovePreview] = useState<{ x: number; y: number } | null>(null);
  const [objectMovePreview, setObjectMovePreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [interactionPlacementActive, setInteractionPlacementActive] = useState(false);
  const [uploadedGraphicUrls, setUploadedGraphicUrls] = useState<Record<string, string>>({});
  const [uploadingGraphic, setUploadingGraphic] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [layerStatus, setLayerStatus] = useState<VideoLayerStatus>(() => ({
    screen: screenSrc ? "loading" : "missing",
    camera: cameraSrc ? "loading" : "missing",
    editable: false,
  }));
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const graphicInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef(project);
  const pastRef = useRef<EditorProject[]>([]);
  const futureRef = useRef<EditorProject[]>([]);
  const pendingRef = useRef<EditorProject | null>(null);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRevealedRef = useRef(resolvedTranscript.status === "done");
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const setCaptionTrack = useCallback((track: VideoCaptionTrack | null) => {
    setCaptionTrackState(track);
    setGeneratedTranscript(track?.cues.length ? {
      status: "done",
      segments: captionTrackToTranscriptSegments(track),
      localMode: transcript.localMode,
    } : null);
  }, [transcript.localMode]);

  useEffect(() => {
    const handle = window.setTimeout(() => setCaptionTrack(initialCaptionTrack ?? null), 0);
    return () => window.clearTimeout(handle);
  }, [initialCaptionTrack, setCaptionTrack]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const measure = () => setCanvasViewport({ width: viewport.clientWidth, height: viewport.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (tool === "select" && resolvedTranscript.status === "done" && resolvedTranscript.segments?.length && !transcriptRevealedRef.current) {
      transcriptRevealedRef.current = true;
      setTool("transcript");
    }
  }, [resolvedTranscript.segments, resolvedTranscript.status, tool]);

  const runSave = useCallback(async () => {
    if (savingRef.current || !pendingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    while (pendingRef.current) {
      const next = pendingRef.current;
      pendingRef.current = null;
      try {
        await onSaveRef.current({
          ...next,
          editState: normalizeVideoEditState(next.editState, durationMs, !!screenSrc && !!cameraSrc),
        });
      } catch (caught) {
        pendingRef.current = next;
        setSaveState("error");
        toast.error(caught instanceof Error ? caught.message : "Could not save video edits");
        break;
      }
    }
    savingRef.current = false;
    if (!pendingRef.current) setSaveState("saved");
  }, [cameraSrc, durationMs, screenSrc]);

  const queueSave = useCallback((next: EditorProject) => {
    pendingRef.current = next;
    setSaveState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSave(), 450);
  }, [runSave]);

  const prepareForPublish = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The publish adapter persists the exact project snapshot it renders.
    // Let an already-running autosave finish, then discard any older queued
    // snapshot so it cannot advance the revision behind the renderer.
    while (savingRef.current) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
    pendingRef.current = null;
    setSaveState("saved");
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const changeProject = useCallback((create: (current: EditorProject) => EditorProject, recordHistory = true) => {
    const current = projectRef.current;
    const next = create(current);
    if (recordHistory) {
      pastRef.current = [...pastRef.current.slice(-39), cloneProject(current)];
      futureRef.current = [];
    }
    projectRef.current = next;
    setProject(next);
    queueSave(next);
  }, [queueSave]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [cloneProject(projectRef.current), ...futureRef.current].slice(0, 40);
    const next = cloneProject(previous);
    projectRef.current = next;
    setProject(next);
    queueSave(next);
  }, [queueSave]);

  const redo = useCallback(() => {
    const nextItem = futureRef.current[0];
    if (!nextItem) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-39), cloneProject(projectRef.current)];
    const next = cloneProject(nextItem);
    projectRef.current = next;
    setProject(next);
    queueSave(next);
  }, [queueSave]);

  const seek = (timeMs: number) => {
    const current = projectRef.current.editState;
    const map = buildVideoTimelineMap(durationMs, current.cuts, current.trim);
    const next = snapSourceTimeToKeptMs(Math.min(durationMs, Math.max(0, timeMs)), map, "forward");
    if (playerRef.current) {
      playerRef.current.currentTime = next / 1000;
      playerRef.current.pause();
    }
    setActiveMs(next);
  };

  const selectTimelineItem = (next: EditorSelection) => {
    setZoomPlacement(null);
    setSelection(next);
    if (next?.kind === "video") setTool("cut");
    if (next?.kind === "screen") setTool("screen");
    if (next?.kind === "camera") setTool("camera");
    if (next?.kind === "cut") setTool("cut");
    if (next?.kind === "zoom") setTool("zoom");
    if (next?.kind === "text") setTool("text");
    if (next?.kind === "object") setTool("objects");
    if (next?.kind === "click" || next?.kind === "key") setTool("interactions");
  };

  const updateEditState = useCallback((create: (state: VideoEditStateV2) => VideoEditState) => changeProject((current) => ({
    ...current,
    // Normalize immediately so the visible timeline always matches the saved
    // project (notably when cut ranges touch or overlap).
    editState: normalizeVideoEditState(create(current.editState), durationMs, !!screenSrc && !!cameraSrc),
  })), [cameraSrc, changeProject, durationMs, screenSrc]);
  const updateZooms = useCallback((create: (zooms: VideoZoomEffect[]) => VideoZoomEffect[]) => changeProject((current) => ({ ...current, zoomEffects: create(current.zoomEffects) })), [changeProject]);

  const addCutRange = (rangeStartMs: number, rangeEndMs: number) => {
    const startMs = Math.min(Math.max(0, durationMs - 100), Math.round(rangeStartMs));
    const endMs = Math.min(durationMs, Math.max(startMs + 100, Math.round(rangeEndMs)));
    const item = { id: crypto.randomUUID(), startMs, endMs };
    updateEditState((state) => ({ ...state, cuts: [...state.cuts, item] }));
    setSelection({ kind: "cut", id: item.id });
  };

  const addText = () => {
    const startMs = Math.min(Math.max(0, durationMs - 200), Math.round(activeMs));
    const item: VideoTextOverlay = {
      id: crypto.randomUUID(),
      startMs,
      endMs: Math.min(durationMs, startMs + 3_000),
      text: "Add your text",
      x: 0.5,
      y: 0.18,
      fontSize: 42,
      color: "#ffffff",
      background: "#111827cc",
    };
    updateEditState((state) => ({ ...state, textOverlays: [...state.textOverlays, item] }));
    setSelection({ kind: "text", id: item.id });
  };

  const addZoomAt = ({ x, y }: { x: number; y: number }) => {
    if (zoomPlacement?.mode === "retarget") {
      const id = zoomPlacement.id;
      updateZooms((zooms) => zooms.map((item) => item.id === id ? { ...item, x, y } : item));
      setSelection({ kind: "zoom", id });
      setZoomPlacement(null);
      return;
    }
    const startMs = Math.min(Math.max(0, durationMs - 200), Math.round(activeMs));
    const item: VideoZoomEffect = { id: crypto.randomUUID(), startMs, endMs: Math.min(durationMs, startMs + 2_000), x, y, scale: 2 };
    updateZooms((zooms) => [...zooms, item]);
    setSelection({ kind: "zoom", id: item.id });
    setZoomPlacement(null);
  };

  const addObject = (kind: Exclude<VideoObjectKind, "image">, graphic?: { assetId: string; url: string }) => {
    const startMs = Math.min(Math.max(0, durationMs - 200), Math.round(activeMs));
    const id = crypto.randomUUID();
    const item: VideoObjectOverlay = {
      id,
      kind: graphic ? "image" : kind,
      startMs,
      endMs: Math.min(durationMs, startMs + 3_000),
      x: 0.5,
      y: 0.5,
      width: kind === "arrow" ? 0.3 : 0.24,
      height: kind === "arrow" ? 0.1 : 0.2,
      rotation: 0,
      opacity: 1,
      zIndex: Math.max(-1, ...projectRef.current.editState.objects.map((object) => object.zIndex)) + 1,
      fill: kind === "callout" ? "#111827dd" : "#6d5bfc33",
      stroke: "#6d5bfc",
      strokeWidth: 3,
      ...(kind === "callout" ? { text: "Add your callout", textColor: "#ffffff", fontSize: 32 } : {}),
      ...(graphic ? { assetId: graphic.assetId, fill: "transparent", stroke: "transparent", strokeWidth: 0 } : {}),
    };
    if (graphic) setUploadedGraphicUrls((current) => ({ ...current, [graphic.assetId]: graphic.url }));
    updateEditState((state) => ({ ...state, objects: [...state.objects, item] }));
    setSelection({ kind: "object", id });
    setTool("objects");
  };

  const uploadGraphicFile = async (file: File) => {
    if (!onUploadGraphic) {
      toast.error("Graphic uploads are not configured for this installation yet");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Choose a PNG, JPEG, or WebP image");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Graphics must be 10 MB or smaller");
      return;
    }
    setUploadingGraphic(true);
    try {
      const graphic = await onUploadGraphic(file);
      addObject("rectangle", graphic);
      toast.success("Graphic added");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not upload the graphic");
    } finally {
      setUploadingGraphic(false);
    }
  };

  const addClickAt = ({ x, y }: { x: number; y: number }) => {
    const startMs = Math.min(Math.max(0, durationMs - 100), Math.round(activeMs));
    const item: VideoClickOverlay = { id: crypto.randomUUID(), startMs, endMs: Math.min(durationMs, startMs + 800), x, y, color: "#ef4444", size: 48 };
    updateEditState((state) => ({ ...state, interactions: { ...state.interactions, clicks: [...state.interactions.clicks, item] } }));
    setSelection({ kind: "click", id: item.id });
    setInteractionPlacementActive(false);
  };

  const addKey = () => {
    const startMs = Math.min(Math.max(0, durationMs - 100), Math.round(activeMs));
    const item: VideoKeyOverlay = { id: crypto.randomUUID(), startMs, endMs: Math.min(durationMs, startMs + 2_000), label: "⌘ K", x: 0.5, y: 0.85 };
    updateEditState((state) => ({ ...state, interactions: { ...state.interactions, keys: [...state.interactions.keys, item] } }));
    setSelection({ kind: "key", id: item.id });
  };

  const selectedCut = selection?.kind === "cut" ? project.editState.cuts.find((item) => item.id === selection.id) : undefined;
  const selectedText = selection?.kind === "text" ? project.editState.textOverlays.find((item) => item.id === selection.id) : undefined;
  const selectedZoom = selection?.kind === "zoom" ? project.zoomEffects.find((item) => item.id === selection.id) : undefined;
  const selectedObject = selection?.kind === "object" ? project.editState.objects.find((item) => item.id === selection.id) : undefined;
  const selectedInteraction: InteractionSelection | undefined = selection?.kind === "click"
    ? project.editState.interactions.clicks.find((item) => item.id === selection.id) && { kind: "click", item: project.editState.interactions.clicks.find((item) => item.id === selection.id)! }
    : selection?.kind === "key"
      ? project.editState.interactions.keys.find((item) => item.id === selection.id) && { kind: "key", item: project.editState.interactions.keys.find((item) => item.id === selection.id)! }
      : undefined;

  const patchCut = (id: string, patch: Partial<{ startMs: number; endMs: number }>) => updateEditState((state) => ({ ...state, cuts: state.cuts.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const patchTrim = (startMs: number, endMs: number) => updateEditState((state) => ({ ...state, trim: { startMs, endMs } }));
  const patchText = (id: string, patch: Partial<VideoTextOverlay>) => updateEditState((state) => ({ ...state, textOverlays: state.textOverlays.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const patchZoom = (id: string, patch: Partial<VideoZoomEffect>) => updateZooms((zooms) => zooms.map((item) => item.id === id ? { ...item, ...patch } : item));
  const patchObject = (id: string, patch: Partial<VideoObjectOverlay>) => updateEditState((state) => ({ ...state, objects: state.objects.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const patchClick = (id: string, patch: Partial<VideoClickOverlay>) => updateEditState((state) => ({ ...state, interactions: { ...state.interactions, clicks: state.interactions.clicks.map((item) => item.id === id ? { ...item, ...patch } : item) } }));
  const patchKey = (id: string, patch: Partial<VideoKeyOverlay>) => updateEditState((state) => ({ ...state, interactions: { ...state.interactions, keys: state.interactions.keys.map((item) => item.id === id ? { ...item, ...patch } : item) } }));

  const moveObjectLayer = (id: string, direction: -1 | 1) => updateEditState((state) => {
    const ordered = [...state.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
    const index = ordered.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return state;
    const currentZ = ordered[index].zIndex;
    const targetZ = ordered[target].zIndex;
    return { ...state, objects: state.objects.map((item) => item.id === id ? { ...item, zIndex: targetZ } : item.id === ordered[target].id ? { ...item, zIndex: currentZ } : item) };
  });

  const activateTool = useCallback((nextTool: EditorTool) => {
    if (nextTool === "camera" && (mode !== "screen_camera" || !layerStatus.editable)) return;
    if (nextTool === "settings" && !ownerSettings) return;
    setTool(nextTool);
    if (nextTool === "cut" || nextTool === "text" || nextTool === "zoom") setSelection(null);
    if (nextTool !== "zoom") setZoomPlacement(null);
    if (nextTool !== "interactions") setInteractionPlacementActive(false);
  }, [layerStatus.editable, mode, ownerSettings]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === "cut") {
      updateEditState((state) => ({ ...state, cuts: state.cuts.filter((item) => item.id !== selection.id) }));
    } else if (selection.kind === "text") {
      updateEditState((state) => ({ ...state, textOverlays: state.textOverlays.filter((item) => item.id !== selection.id) }));
    } else if (selection.kind === "zoom") {
      updateZooms((zooms) => zooms.filter((item) => item.id !== selection.id));
      setZoomPlacement(null);
    } else if (selection.kind === "object") {
      updateEditState((state) => ({ ...state, objects: state.objects.filter((item) => item.id !== selection.id) }));
    } else if (selection.kind === "click") {
      updateEditState((state) => ({ ...state, interactions: { ...state.interactions, clicks: state.interactions.clicks.filter((item) => item.id !== selection.id) } }));
    } else if (selection.kind === "key") {
      updateEditState((state) => ({ ...state, interactions: { ...state.interactions, keys: state.interactions.keys.filter((item) => item.id !== selection.id) } }));
    } else {
      return;
    }
    setSelection(null);
  }, [selection, updateEditState, updateZooms]);

  const changeCanvasZoom = useCallback((direction: -1 | 1) => {
    setCanvasZoom((current) => Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, current + direction * CANVAS_ZOOM_STEP)));
  }, []);

  const fitCanvas = useCallback(() => setCanvasZoom(1), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.code === "Space" ? " " : event.key.toLowerCase();
      const playbackShortcut = key === " " || key === "k";
      // Range controls retain focus after pointer adjustment, but Space/K have
      // no native range-editing behavior. Keep playback available there while
      // preserving normal typing and activation inside every other form field.
      if (isTextEntryTarget(event.target) && !(playbackShortcut && isRangeInputTarget(event.target))) return;
      if (event.target instanceof HTMLElement && event.target.closest("[role='dialog']")) return;
      if (playbackShortcut && event.repeat) {
        event.preventDefault();
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      if (mod) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (key === "y" && event.ctrlKey) {
          event.preventDefault();
          redo();
          return;
        }
        if (key === "s") {
          event.preventDefault();
          void runSave();
          return;
        }
        if (key === "=" || key === "+") {
          event.preventDefault();
          changeCanvasZoom(1);
          return;
        }
        if (key === "-" || key === "_") {
          event.preventDefault();
          changeCanvasZoom(-1);
          return;
        }
        if (key === "0") {
          event.preventDefault();
          fitCanvas();
        }
        return;
      }

      if (event.altKey) return;
      if (key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (key === " " || key === "k") {
        event.preventDefault();
        const player = playerRef.current;
        if (!player) return;
        if (player.paused || player.ended) {
          if (player.ended || (Number.isFinite(player.duration) && player.duration > 0 && player.currentTime >= player.duration - 0.05)) {
            const state = projectRef.current.editState;
            const map = buildVideoTimelineMap(durationMs, state.cuts, state.trim);
            const startMs = map.ranges[0]?.startMs ?? state.trim.startMs;
            player.currentTime = startMs / 1_000;
            setActiveMs(startMs);
          }
          void player.play().catch(() => {});
        }
        else player.pause();
        return;
      }
      if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        const player = playerRef.current;
        if (!player) return;
        const direction = key === "arrowleft" ? -1 : 1;
        const step = event.shiftKey ? 5_000 : 1_000;
        const state = projectRef.current.editState;
        const map = buildVideoTimelineMap(durationMs, state.cuts, state.trim);
        const editedCurrent = sourceTimeToEditedMs(player.currentTime * 1_000, map);
        const nextEdited = Math.min(map.durationMs, Math.max(0, editedCurrent + direction * step));
        const nextSource = editedTimeToSourceMs(nextEdited, map, direction > 0 ? "forward" : "backward");
        player.currentTime = nextSource / 1_000;
        setActiveMs(nextSource);
        return;
      }
      if ((key === "delete" || key === "backspace") && selection) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "escape") {
        if (zoomPlacement || interactionPlacementActive || selection || tool !== "select") {
          event.preventDefault();
          setZoomPlacement(null);
          setInteractionPlacementActive(false);
          setSelection(null);
          setTool("select");
        }
        return;
      }
      if (!event.shiftKey && toolShortcuts[key]) {
        event.preventDefault();
        activateTool(toolShortcuts[key]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activateTool, changeCanvasZoom, deleteSelection, durationMs, fitCanvas, interactionPlacementActive, redo, runSave, selection, tool, undo, zoomPlacement]);

  const canvasPadding = canvasViewport.width >= 640 ? 64 : 32;
  const canvasFooterHeight = 38;
  const fitWidth = canvasViewport.width > 0 && canvasViewport.height > 0
    ? Math.max(240, Math.min(1_024, canvasViewport.width - canvasPadding, (canvasViewport.height - canvasPadding - canvasFooterHeight) * canvasAspect))
    : 720;
  const canvasWidth = Math.round(fitWidth * canvasZoom);
  const cameraPreviewState = cameraMovePreview && project.editState.camera
    ? { ...project.editState, camera: { ...project.editState.camera, ...cameraMovePreview } }
    : project.editState;
  const playerEditState = objectMovePreview
    ? { ...cameraPreviewState, objects: cameraPreviewState.objects.map((item) => item.id === objectMovePreview.id ? { ...item, x: objectMovePreview.x, y: objectMovePreview.y } : item) }
    : cameraPreviewState;
  const resolvedGraphicUrls = { ...(graphicUrls ?? {}), ...uploadedGraphicUrls };
  const timelineMap = buildVideoTimelineMap(durationMs, project.editState.cuts, project.editState.trim);
  const captionTextOverlays = captionTrackToTextOverlays(captionTrack);

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : saveState === "error" ? "Save failed" : "All changes saved";

  return (
    <section className={cn("flex min-h-0 w-full flex-col overflow-hidden bg-white", className)} data-video-key={videoKey} data-editor-layout="full-page">
      <input
        ref={graphicInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={uploadingGraphic}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void uploadGraphicFile(file);
          event.currentTarget.value = "";
        }}
      />
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={backHref} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Back to video library"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{title}</p><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">{environmentLabel}</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className={cn("mr-1 hidden items-center gap-1.5 text-[11px] sm:flex", saveState === "error" ? "text-red-500" : "text-slate-400")}>
            {saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saveLabel}
          </span>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={undo} aria-label="Undo edit"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={redo} aria-label="Redo edit"><Redo2 className="h-4 w-4" /></Button>
          <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Keyboard className="h-4 w-4" /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Keyboard shortcuts</DialogTitle>
                <DialogDescription>Move quickly through the editor. Shortcuts pause while you type in a field.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-5 pt-2 sm:grid-cols-2">
                {shortcutGroups.map((group) => (
                  <section key={group.title}>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400">{group.title}</h3>
                    <dl className="space-y-1.5">
                      {group.items.map(([label, shortcut]) => (
                        <div key={label} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <dt className="text-slate-600">{label}</dt>
                          <dd><kbd className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] font-semibold text-slate-700 shadow-sm">{shortcut}</kbd></dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="h-9" onClick={() => void runSave()} disabled={saveState === "saved" || saveState === "saving"}><Save className="h-3.5 w-3.5" /> Save</Button>
          {publishAdapter && <VideoPublishButton title={title} mode={mode} durationMs={durationMs} primarySrc={src} screenSrc={screenSrc} cameraSrc={cameraSrc} project={project} supplementalTextOverlays={captionTextOverlays} graphicUrls={resolvedGraphicUrls} adapter={publishAdapter} beforePublish={prepareForPublish} />}
          <VideoDownloadMenu title={title} mode={mode} durationMs={durationMs} primarySrc={src} primaryMimeType={sourceMimeType} screenSrc={screenSrc} cameraSrc={cameraSrc} project={project} supplementalTextOverlays={captionTextOverlays} graphicUrls={resolvedGraphicUrls} onAnalyticsEvent={onAnalyticsEvent} />
          {headerActions}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[68px_minmax(0,1fr)_380px] lg:overflow-hidden">
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 p-2 lg:flex-col lg:border-b-0 lg:border-r" aria-label="Editor tools">
          {tools.filter(({ id }) => (id !== "settings" || !!ownerSettings) && (id !== "enhance" || !!renderEnhancePanel)).map(({ id, label, shortcut, icon: Icon }) => {
            const disabled = id === "camera" && (mode !== "screen_camera" || !layerStatus.editable);
            return <button key={id} type="button" disabled={disabled} onClick={() => activateTool(id)} className={cn("flex h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-lg text-[9px] font-semibold transition", tool === id ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-900", disabled && "cursor-not-allowed opacity-35")} title={`${label} (${shortcut})`}><Icon className="h-4 w-4" />{label}</button>;
          })}
        </nav>

        <div className="flex min-w-0 flex-col bg-[#edf0f5]">
          <div className="relative min-h-[430px] flex-1 lg:min-h-0">
            <div className="absolute right-3 top-3 z-30 flex items-center rounded-lg border border-slate-200/90 bg-white/95 p-1 shadow-md backdrop-blur" aria-label="Canvas zoom controls">
              <button type="button" aria-label="Zoom canvas out" title="Zoom canvas out (⌘/Ctrl −)" disabled={canvasZoom <= CANVAS_ZOOM_MIN} onClick={() => changeCanvasZoom(-1)} className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"><ZoomOut className="h-4 w-4" /></button>
              <span className="min-w-12 px-1 text-center font-mono text-[10px] font-semibold text-slate-600" aria-live="polite">{Math.round(canvasZoom * 100)}%</span>
              <button type="button" aria-label="Zoom canvas in" title="Zoom canvas in (⌘/Ctrl +)" disabled={canvasZoom >= CANVAS_ZOOM_MAX} onClick={() => changeCanvasZoom(1)} className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"><ZoomIn className="h-4 w-4" /></button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <button type="button" aria-label="Fit canvas to editor" title="Fit canvas to editor (⌘/Ctrl 0)" onClick={fitCanvas} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] font-semibold transition hover:bg-slate-100", canvasZoom === 1 ? "text-primary" : "text-slate-600")}><Maximize2 className="h-3.5 w-3.5" /> Fit</button>
            </div>

            <div ref={canvasViewportRef} data-editor-canvas-viewport className="absolute inset-0 overflow-auto">
              <div className="flex min-h-full min-w-full p-4 sm:p-6 lg:p-8">
                <div
                  data-editor-canvas
                  data-canvas-zoom={Math.round(canvasZoom * 100)}
                  className="m-auto shrink-0"
                  style={{ width: `${canvasWidth}px` }}
                >
              <VideoPlayer
                ref={(node) => { playerRef.current = node; onPlayerReady?.(node); }}
                src={src}
                screenSrc={screenSrc ?? undefined}
                cameraSrc={screenSrc ? cameraSrc ?? undefined : undefined}
                poster={poster ?? undefined}
                zoomEffects={project.zoomEffects}
                editState={playerEditState}
                captionTrack={captionTrack}
                graphicUrls={resolvedGraphicUrls}
                selectedObjectId={selection?.kind === "object" ? selection.id : undefined}
                objectEditActive={tool === "objects"}
                onSelectObject={(id) => { setSelection({ kind: "object", id }); setTool("objects"); }}
                onObjectMove={(id, point) => setObjectMovePreview({ id, ...point })}
                onObjectMoveEnd={(id, point) => {
                  patchObject(id, point);
                  setObjectMovePreview(null);
                }}
                interactionPlacementActive={interactionPlacementActive}
                onInteractionPoint={addClickAt}
                showLayerStatus
                onLayerStatusChange={setLayerStatus}
                zoomEditActive={!!zoomPlacement}
                onZoomPoint={addZoomAt}
                cameraEditActive={tool === "camera" && layerStatus.editable}
                onCameraMove={setCameraMovePreview}
                onCameraMoveEnd={(point) => {
                  updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, x: point.x, y: point.y } } : state);
                  setCameraMovePreview(null);
                }}
                onTimeUpdate={(event) => setActiveMs(event.currentTarget.currentTime * 1000)}
                onLoadedMetadata={(event) => {
                  const player = event.currentTarget;
                  if (player.videoWidth > 0 && player.videoHeight > 0) setCanvasAspect(player.videoWidth / player.videoHeight);
                }}
                keyboardShortcuts={false}
                wrapperClassName="rounded-xl shadow-[0_24px_55px_rgba(20,25,45,.22)] ring-1 ring-black/5"
              />
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span>Source-time editing · edits stay reversible</span><span>{layerStatus.editable ? "Screen and camera layers ready" : mode === "screen_camera" && screenSrc && cameraSrc && layerStatus.screen !== "error" && layerStatus.camera !== "error" ? "Preparing separate layers…" : mode === "screen_camera" ? "Using the combined recording" : "Single video layer"}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="min-h-0 border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
          <div className={cn("h-full max-h-[640px] overflow-y-auto lg:max-h-none", tool === "settings" ? "p-0" : "space-y-5 p-5")}>
            {tool === "select" && <><SectionHeading title="Edit your recording" description="Choose a tool, select a timeline range, or click the webcam layer to reposition it." /><div className="space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><p className="flex items-center justify-between"><span>Final duration</span><strong className="text-primary">{formatEditTime(timelineMap.durationMs)}</strong></p><p className="flex items-center justify-between"><span>Source duration</span><strong className="text-slate-800">{formatEditTime(durationMs)}</strong></p><p className="flex items-center justify-between"><span>Removed ranges</span><strong className="text-slate-800">{project.editState.cuts.length}</strong></p><p className="flex items-center justify-between"><span>Timed text</span><strong className="text-slate-800">{project.editState.textOverlays.length}</strong></p><p className="flex items-center justify-between"><span>Zoom effects</span><strong className="text-slate-800">{project.zoomEffects.length}</strong></p></div></>}

            {tool === "cut" && <>
              <SectionHeading title="Trim & cut" description="Pull the Video track ends to trim the recording, or drag across the Cuts track to remove a section in the middle." />
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-3">
                <div className="flex items-center justify-between"><p className="text-xs font-semibold text-indigo-900">Final video range</p><span className="font-mono text-[10px] font-semibold text-indigo-600">{formatEditTime(timelineMap.durationMs)}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <TimeField label="Trim start" valueMs={project.editState.trim.startMs} durationMs={durationMs} onChange={(value) => patchTrim(Math.min(project.editState.trim.endMs - 100, Math.max(0, value)), project.editState.trim.endMs)} />
                  <TimeField label="Trim end" valueMs={project.editState.trim.endMs} durationMs={durationMs} onChange={(value) => patchTrim(project.editState.trim.startMs, Math.max(project.editState.trim.startMs + 100, Math.min(durationMs, value)))} />
                </div>
                <Button size="sm" variant="outline" className="w-full bg-white" onClick={() => patchTrim(0, durationMs)}><RotateCcw className="h-3.5 w-3.5" /> Reset trim</Button>
              </div>
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-xs leading-5 text-red-700"><p className="font-semibold">Remove a middle section</p><p className="mt-0.5 text-red-600">Drag in the Cuts row, then move the red range or pull either edge to refine it.</p></div>
              <p className="text-xs font-semibold text-red-500">Drag to create a cut</p>
              {selectedCut ? <div className="space-y-4 border-t border-slate-100 pt-4"><div className="grid grid-cols-2 gap-2"><TimeField label="Cut start" valueMs={selectedCut.startMs} durationMs={durationMs} onChange={(value) => patchCut(selectedCut.id, { startMs: Math.min(selectedCut.endMs - 100, Math.max(0, value)) })} /><TimeField label="Cut end" valueMs={selectedCut.endMs} durationMs={durationMs} onChange={(value) => patchCut(selectedCut.id, { endMs: Math.max(selectedCut.startMs + 100, Math.min(durationMs, value)) })} /></div><Button variant="outline" className="w-full text-red-500 hover:text-red-600" onClick={() => { updateEditState((state) => ({ ...state, cuts: state.cuts.filter((item) => item.id !== selectedCut.id) })); setSelection(null); }}><Trash2 className="h-4 w-4" /> Remove cut</Button></div> : <p className="text-xs text-slate-400">No middle cut selected.</p>}
            </>}

            {tool === "text" && <><SectionHeading title="Timed text" description="Add plain-text callouts that appear only over the selected timeline range." /><Button className="w-full" onClick={addText}><Type className="h-4 w-4" /> Add text at {formatEditTime(activeMs)}</Button>{selectedText ? <div className="space-y-4 border-t border-slate-100 pt-4"><Textarea value={selectedText.text} onChange={(event) => patchText(selectedText.id, { text: event.target.value.slice(0, 280) })} rows={3} /><div className="grid grid-cols-2 gap-2"><TimeField label="Start" valueMs={selectedText.startMs} durationMs={durationMs} onChange={(value) => patchText(selectedText.id, { startMs: Math.min(selectedText.endMs - 100, Math.max(0, value)) })} /><TimeField label="End" valueMs={selectedText.endMs} durationMs={durationMs} onChange={(value) => patchText(selectedText.id, { endMs: Math.max(selectedText.startMs + 100, Math.min(durationMs, value)) })} /></div><RangeControl label="Font size" value={selectedText.fontSize} min={18} max={88} step={1} display={`${selectedText.fontSize}px`} onChange={(value) => patchText(selectedText.id, { fontSize: value })} /><RangeControl label="Horizontal" value={selectedText.x} min={0.08} max={0.92} step={0.01} display={`${Math.round(selectedText.x * 100)}%`} onChange={(value) => patchText(selectedText.id, { x: value })} /><RangeControl label="Vertical" value={selectedText.y} min={0.08} max={0.92} step={0.01} display={`${Math.round(selectedText.y * 100)}%`} onChange={(value) => patchText(selectedText.id, { y: value })} /><div><Label className="text-xs text-slate-500">Color</Label><div className="mt-2 flex gap-2">{["#ffffff", "#111827", "#fef08a", "#bfdbfe"].map((color) => <button type="button" key={color} aria-label={`Use text color ${color}`} onClick={() => patchText(selectedText.id, { color })} className={cn("h-8 w-8 rounded-full border border-slate-200", selectedText.color === color && "ring-2 ring-primary ring-offset-2")} style={{ background: color }} />)}</div></div><Button variant="outline" className="w-full text-red-500" onClick={() => { updateEditState((state) => ({ ...state, textOverlays: state.textOverlays.filter((item) => item.id !== selectedText.id) })); setSelection(null); }}><Trash2 className="h-4 w-4" /> Delete text</Button></div> : <p className="text-xs text-slate-400">Add text or select a blue range on the timeline.</p>}</>}

            {tool === "crop" && <><SectionHeading title="Crop the frame" description="Trim unwanted edges while keeping the original source available for later changes." /><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => updateEditState((state) => ({ ...state, crop: { top: 0, right: 0, bottom: 0, left: 0 } }))}>Reset</Button><Button size="sm" variant="outline" onClick={() => updateEditState((state) => ({ ...state, crop: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 } }))}>Inset</Button></div>{(["top", "right", "bottom", "left"] as const).map((edge) => <RangeControl key={edge} label={edge.charAt(0).toUpperCase() + edge.slice(1)} value={project.editState.crop[edge]} min={0} max={0.4} step={0.01} display={`${Math.round(project.editState.crop[edge] * 100)}%`} onChange={(value) => updateEditState((state) => ({ ...state, crop: { ...state.crop, [edge]: value } }))} />)}</>}

            {tool === "zoom" && (
              <EditorZoomInspector
                activeMs={activeMs}
                durationMs={durationMs}
                placement={zoomPlacement}
                selected={selectedZoom}
                onStartCreate={() => {
                  setSelection(null);
                  setZoomPlacement({ mode: "create" });
                }}
                onStartRetarget={(id) => setZoomPlacement({ mode: "retarget", id })}
                onCancelPlacement={() => setZoomPlacement(null)}
                onPatch={patchZoom}
                onDelete={(id) => {
                  updateZooms((zooms) => zooms.filter((item) => item.id !== id));
                  setZoomPlacement(null);
                  setSelection(null);
                }}
              />
            )}

            {tool === "screen" && <><SectionHeading title="Shared screen layout" description="Scale and reposition the shared screen inside the final 16:9 canvas." /><RangeControl label="Scale" value={project.editState.screen.scale} min={0.5} max={2.5} step={0.02} display={`${Math.round(project.editState.screen.scale * 100)}%`} onChange={(value) => updateEditState((state) => ({ ...state, screen: { ...state.screen, scale: value } }))} /><RangeControl label="Horizontal" value={project.editState.screen.x} min={0} max={1} step={0.01} display={`${Math.round(project.editState.screen.x * 100)}%`} onChange={(value) => updateEditState((state) => ({ ...state, screen: { ...state.screen, x: value } }))} /><RangeControl label="Vertical" value={project.editState.screen.y} min={0} max={1} step={0.01} display={`${Math.round(project.editState.screen.y * 100)}%`} onChange={(value) => updateEditState((state) => ({ ...state, screen: { ...state.screen, y: value } }))} /><RangeControl label="Corner radius" value={project.editState.screen.cornerRadius} min={0} max={48} step={1} display={`${project.editState.screen.cornerRadius}px`} onChange={(value) => updateEditState((state) => ({ ...state, screen: { ...state.screen, cornerRadius: value } }))} /><Button variant="outline" className="w-full" onClick={() => updateEditState((state) => ({ ...state, screen: { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 } }))}><RotateCcw className="h-4 w-4" /> Reset screen</Button></>}

            {tool === "camera" && (layerStatus.editable && cameraSrc && project.editState.camera ? <>
              <SectionHeading title="Webcam layer" description="Drag the webcam directly in the preview, or use these controls for exact placement." />
              <div className="grid grid-cols-4 gap-2">
                {[[0.14, 0.18, "↖"], [0.86, 0.18, "↗"], [0.14, 0.82, "↙"], [0.86, 0.82, "↘"]].map(([x, y, label]) => <button key={String(label)} type="button" onClick={() => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, x: Number(x), y: Number(y) } } : state)} className="h-9 rounded-lg border border-slate-200 bg-slate-50 text-sm hover:border-primary/30 hover:text-primary">{label}</button>)}
              </div>
              <RangeControl label="Size" value={project.editState.camera.size} min={0.12} max={0.55} step={0.01} display={`${Math.round(project.editState.camera.size * 100)}%`} onChange={(value) => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, size: value } } : state)} />
              <div>
                <Label className="text-xs text-slate-500">Shape</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["circle", "rounded", "square"] as const).map((shape) => <button key={shape} type="button" onClick={() => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, shape } } : state)} className={cn("h-9 rounded-lg border text-xs font-semibold capitalize", project.editState.camera?.shape === shape ? "border-primary bg-primary/10 text-primary" : "border-slate-200")}>{shape}</button>)}
                </div>
              </div>
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-xs font-semibold text-slate-700">Webcam stroke</p>
                  <p className="mt-1 text-[11px] text-slate-400">Set the outline width and color used in previews and exports.</p>
                </div>
                <RangeControl label="Stroke width" value={project.editState.camera.strokeWidth ?? 3} min={0} max={12} step={1} display={`${project.editState.camera.strokeWidth ?? 3}px`} onChange={(value) => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, strokeWidth: value } } : state)} />
                <div>
                  <Label htmlFor="webcam-stroke-color" className="text-xs text-slate-500">Stroke color</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <Input id="webcam-stroke-color" aria-label="Stroke color" type="color" value={project.editState.camera.strokeColor ?? "#ffffff"} onChange={(event) => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, strokeColor: event.target.value } } : state)} className="h-9 w-12 cursor-pointer p-1" />
                    {["#ffffff", "#111827", "#6d5bfc", "#ef4444"].map((color) => <button key={color} type="button" aria-label={`Use webcam stroke color ${color}`} onClick={() => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, strokeColor: color } } : state)} className={cn("h-8 w-8 rounded-full border border-slate-200", (project.editState.camera?.strokeColor ?? "#ffffff") === color && "ring-2 ring-primary ring-offset-2")} style={{ background: color }} />)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div><p className="text-xs font-semibold">Show webcam</p><p className="text-[11px] text-slate-400">Hide it without deleting the source.</p></div>
                <Switch aria-label={project.editState.camera.visible ? "Hide webcam" : "Show webcam"} checked={project.editState.camera.visible} onCheckedChange={(visible) => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, visible } } : state)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => updateEditState((state) => state.camera ? { ...state, camera: { ...state.camera, mirror: !state.camera.mirror } } : state)}>Mirror</Button>
                <Button variant="outline" onClick={() => updateEditState((state) => state.camera ? { ...state, camera: { x: 0.17, y: 0.81, size: 0.26, shape: "circle", strokeWidth: 3, strokeColor: "#ffffff", mirror: false, visible: true } } : state)}><RotateCcw className="h-4 w-4" /> Reset</Button>
              </div>
            </> : <><SectionHeading title="Webcam layer unavailable" description="VideoFlow is showing the reliable combined recording because both separate layers are not playable." /><p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">Cuts, crop, text, screen framing, and zoom still work. Make a new screen-and-camera recording to regain independent webcam placement.</p></>)}

            {tool === "audio" && <EditorAudioInspector settings={project.editState.audio} editedDurationMs={timelineMap.durationMs} onChange={(audio) => updateEditState((state) => ({ ...state, audio }))} />}

            {tool === "objects" && <EditorObjectsInspector selected={selectedObject} durationMs={durationMs} onAdd={addObject} onUploadGraphic={() => graphicInputRef.current?.click()} onPatch={patchObject} onMoveLayer={moveObjectLayer} onDelete={(id) => { updateEditState((state) => ({ ...state, objects: state.objects.filter((item) => item.id !== id) })); setSelection(null); }} />}

            {tool === "interactions" && <EditorInteractionsInspector settings={project.editState.interactions} selected={selectedInteraction} durationMs={durationMs} clickPlacementActive={interactionPlacementActive} onToggleClicks={(clicksEnabled) => updateEditState((state) => ({ ...state, interactions: { ...state.interactions, clicksEnabled } }))} onToggleKeys={(keysEnabled) => updateEditState((state) => ({ ...state, interactions: { ...state.interactions, keysEnabled } }))} onStartClickPlacement={() => setInteractionPlacementActive((active) => !active)} onAddKey={addKey} onPatchClick={patchClick} onPatchKey={patchKey} onDelete={(kind, id) => { updateEditState((state) => ({ ...state, interactions: kind === "click" ? { ...state.interactions, clicks: state.interactions.clicks.filter((item) => item.id !== id) } : { ...state.interactions, keys: state.interactions.keys.filter((item) => item.id !== id) } })); setSelection(null); }} />}

            {tool === "transcript" && <><SectionHeading title="Transcript" description="Search the recording and click any segment to move the playhead. Caption edits stay synchronized here." />{resolvedTranscript.status === "done" && resolvedTranscript.segments?.length ? <TranscriptPanel segments={resolvedTranscript.segments} onSeek={seek} activeMs={activeMs} /> : resolvedTranscript.status === "pending" ? <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Transcription is still running…</p> : resolvedTranscript.status === "too_large" ? <p className="text-xs leading-5 text-slate-500">The audio exceeded the configured transcription limit.</p> : resolvedTranscript.status === "error" ? <p className="text-xs leading-5 text-slate-500">Transcription could not be completed for this recording.</p> : <p className="text-xs leading-5 text-slate-500">{resolvedTranscript.localMode ? "Generate captions in Enhance to create a local transcript, or connect a transcription provider for full recordings." : "No transcript is available for this recording."}</p>}</>}

            {/* The render prop receives stable editor actions; it does not read editor refs. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {tool === "enhance" && renderEnhancePanel?.({ project, activeMs, transcript: resolvedTranscript, captionTrack, seek, openTranscript: () => setTool("transcript"), setCaptionTrack, updateEditState, updateZooms, save: runSave })}

            {tool === "settings" && ownerSettings}
          </div>
        </aside>
      </div>

      <div className="max-h-[34dvh] shrink-0 overflow-auto lg:max-h-[36dvh] 2xl:max-h-[360px]">
        <div className="min-w-[680px]">
          <EditorTimeline
            durationMs={durationMs}
            currentMs={activeMs}
            playbackRef={playerRef}
            trim={project.editState.trim}
            cuts={project.editState.cuts}
            zooms={project.zoomEffects}
            texts={project.editState.textOverlays}
            objects={project.editState.objects}
            clicks={project.editState.interactions.clicks}
            keys={project.editState.interactions.keys}
            selection={selection}
            showScreenTrack={mode !== "camera"}
            showCameraTrack={mode === "screen_camera"}
            screenTrackAvailable={mode !== "camera"}
            cameraTrackAvailable={mode === "screen_camera" && layerStatus.editable}
            cutCreationEnabled={tool === "cut"}
            onSelect={selectTimelineItem}
            onSeek={seek}
            onCreateCut={addCutRange}
            onChangeTrim={patchTrim}
            onMoveCut={(id, startMs, endMs) => patchCut(id, { startMs, endMs })}
            onMoveZoom={(id, startMs, endMs) => patchZoom(id, { startMs, endMs })}
            onMoveText={(id, startMs, endMs) => patchText(id, { startMs, endMs })}
            onMoveObject={(id, startMs, endMs) => patchObject(id, { startMs, endMs })}
            onMoveClick={(id, startMs, endMs) => patchClick(id, { startMs, endMs })}
            onMoveKey={(id, startMs, endMs) => patchKey(id, { startMs, endMs })}
          />
        </div>
      </div>
    </section>
  );
}
