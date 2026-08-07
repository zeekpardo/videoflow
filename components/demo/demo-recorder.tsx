"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Camera,
  Circle,
  ImagePlus,
  Loader2,
  Monitor,
  MonitorSmartphone,
  Move,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { CameraBubbleControls } from "@/components/videos/camera-bubble-controls";
import { ThumbnailPreview } from "@/components/videos/thumbnail-preview";
import {
  useMediaRecorder,
  type RecordMode,
} from "@/components/videos/use-media-recorder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { appConfig, demoConfig } from "@/lib/config";
import { defaultVideoEditState, type VideoEditState } from "@/lib/video-edits";
import {
  captureVideoBlobFrame,
  captureVideoFrame,
  generateTitleThumbnail,
  validateThumbnailFile,
} from "@/lib/video-thumbnail";
import { cn } from "@/lib/utils";
import { trackDemoEvent } from "@/lib/demo-analytics";

export interface DemoRecordingDraft {
  title: string;
  durationMs: number;
  mode: RecordMode;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  videoBlob: Blob;
  screenBlob?: Blob;
  cameraBlob?: Blob;
  thumbnailBlob?: Blob;
  editState: VideoEditState;
}

interface DemoRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (video: DemoRecordingDraft) => Promise<void>;
  initialMode?: RecordMode;
}

const modes: {
  mode: RecordMode;
  label: string;
  description: string;
  icon: typeof Monitor;
}[] = [
  {
    mode: "screen",
    label: "Screen + mic",
    description: "Walk through a tab, window, or display",
    icon: Monitor,
  },
  {
    mode: "screen_camera",
    label: "Screen + camera",
    description: "Add your camera bubble to the screen",
    icon: MonitorSmartphone,
  },
  {
    mode: "camera",
    label: "Camera only",
    description: "Record a face-to-camera message",
    icon: Video,
  },
];

function subscribeToDeviceClass() {
  return () => undefined;
}

function mobileRecordingDevice() {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(
    navigator.userAgent,
  );
  return mobileUserAgent || (coarsePointer && navigator.maxTouchPoints > 1);
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function DemoRecorder({
  open,
  onOpenChange,
  onSaved,
  initialMode = "screen_camera",
}: DemoRecorderProps) {
  const recorder = useMediaRecorder();
  const {
    status,
    prepare,
    start,
    pause,
    resume,
    stop,
    reset,
    result,
    previewStream,
    elapsedMs,
    error,
    bubble,
    setBubble,
  } = recorder;
  const [mode, setMode] = useState<RecordMode>(initialMode);
  const [systemAudio, setSystemAudio] = useState(false);
  const [title, setTitle] = useState("");
  const [thumbnail, setThumbnail] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const mobileCapture = useSyncExternalStore(
    subscribeToDeviceClass,
    mobileRecordingDevice,
    () => false,
  );
  const [countdown, setCountdown] = useState<number | null>(null);
  const liveRef = useRef<HTMLVideoElement | null>(null);
  const reviewRef = useRef<HTMLVideoElement | null>(null);
  const reviewUrlRef = useRef<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = liveRef.current;
    if (!element || !previewStream) return;
    element.srcObject = previewStream;
    void element.play().catch(() => undefined);
  }, [previewStream, status]);

  useEffect(() => {
    if (status !== "stopped" || !result) return;
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = URL.createObjectURL(result.videoBlob);
    if (reviewRef.current) reviewRef.current.src = reviewUrlRef.current;
    void captureVideoBlobFrame(result.videoBlob, result.durationMs)
      .then(setThumbnail)
      .catch(() => undefined);
  }, [result, status]);

  useEffect(() => {
    if (
      status === "recording" &&
      elapsedMs >= demoConfig.maxRecordingMinutes * 60_000
    ) {
      stop();
      trackDemoEvent("recording_stopped", { mode, elapsedMs, automatic: true });
      toast.info(
        `Recording stopped at the ${demoConfig.maxRecordingMinutes}-minute demo limit.`,
      );
    }
  }, [elapsedMs, mode, status, stop]);

  const resetAll = useCallback(() => {
    reset();
    setCountdown(null);
    setTitle("");
    setThumbnail(null);
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = null;
  }, [reset]);

  useEffect(
    () => () => {
      if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    },
    [],
  );

  const setOpen = (next: boolean) => {
    if (
      !next &&
      (status === "recording" || status === "paused") &&
      !window.confirm("Discard this recording?")
    ) {
      return;
    }
    if (!next) resetAll();
    onOpenChange(next);
  };

  const setUp = async () => {
    try {
      setTitle((value) => value || `Recording ${new Date().toLocaleDateString()}`);
      await prepare({
        mode,
        systemAudio,
        // The finished composite still contains both sources. Phones and
        // tablets skip two additional high-bitrate source files to reduce
        // IndexedDB pressure and avoid mobile storage failures.
        retainSourceLayers: !mobileCapture,
      });
      trackDemoEvent("recording_devices_ready", { mode, systemAudio });
    } catch (caught) {
      trackDemoEvent("recording_failed", { stage: "devices", mode });
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Could not access the selected recording devices",
      );
    }
  };

  const begin = () => {
    setCountdown(3);
    let value = 3;
    const timer = window.setInterval(() => {
      value -= 1;
      if (value <= 0) {
        window.clearInterval(timer);
        setCountdown(null);
        start();
        trackDemoEvent("recording_started", { mode, systemAudio });
      } else {
        setCountdown(value);
      }
    }, 1_000);
  };

  const dragBubble = (event: React.PointerEvent<HTMLElement>) => {
    if (mode !== "screen_camera") return;
    const element = event.currentTarget;
    const move = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      setBubble({
        cx: Math.min(0.92, Math.max(0.08, (clientX - rect.left) / rect.width)),
        cy: Math.min(0.92, Math.max(0.08, (clientY - rect.top) / rect.height)),
      });
    };
    move(event.clientX, event.clientY);
    const onMove = (pointer: PointerEvent) => move(pointer.clientX, pointer.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const save = async () => {
    if (!result) return;
    if (result.videoBlob.size > demoConfig.maxVideoBytes) {
      toast.error(
        `This recording is larger than the ${(demoConfig.maxVideoBytes / 1024 / 1024).toFixed(0)} MB demo limit.`,
      );
      return;
    }
    setSaving(true);
    try {
      await onSaved({
        title: title.trim() || "Untitled recording",
        durationMs: result.durationMs,
        mode,
        mimeType: result.mimeType,
        sizeBytes: result.videoBlob.size,
        width: result.width,
        height: result.height,
        videoBlob: result.videoBlob,
        thumbnailBlob:
          thumbnail ??
          (await captureVideoBlobFrame(result.videoBlob, result.durationMs).catch(
            () => undefined,
          )),
        ...(result.screenBlob ? { screenBlob: result.screenBlob } : {}),
        ...(result.cameraBlob ? { cameraBlob: result.cameraBlob } : {}),
        editState: defaultVideoEditState(
          mode === "screen_camera" && !(result.screenBlob && result.cameraBlob)
            ? "screen"
            : mode,
          bubble,
          result.durationMs,
        ),
      });
      toast.success("Recording saved to this demo session");
      resetAll();
      onOpenChange(false);
    } catch (caught) {
      trackDemoEvent("recording_failed", { stage: "save", mode });
      toast.error(
        caught instanceof Error ? caught.message : "Could not save this recording",
      );
    } finally {
      setSaving(false);
    }
  };

  const active = status === "recording" || status === "paused";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[96vh] overflow-y-auto rounded-[28px] border-slate-200 bg-white p-0 shadow-[0_30px_100px_rgba(26,31,60,.22)] sm:max-w-5xl"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-slate-100 px-6 py-5 sm:px-8">
          <p className="text-[11px] font-bold uppercase tracking-[.22em] text-primary">
            {status === "stopped" ? "Recording complete" : "Recording studio"}
          </p>
          <DialogTitle className="text-2xl font-bold tracking-[-.035em]">
            {status === "stopped" ? "Review & save" : "Record a video"}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Nothing in this window is uploaded. The finished video stays in this
            demo session.
          </DialogDescription>
        </DialogHeader>

        {status === "idle" && (
          <div className="space-y-6 p-6 sm:p-8">
            <div className="grid gap-3 sm:grid-cols-3">
              {modes.map(({ mode: value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "flex min-h-36 flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
                    mode === value
                      ? "border-primary/40 bg-primary/[.07] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                      : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-primary shadow-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="mt-1 text-sm font-semibold">{label}</span>
                  <span className="text-xs leading-5 text-slate-500">
                    {description}
                  </span>
                </button>
              ))}
            </div>
            {(mode === "screen" || mode === "screen_camera") && (
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-semibold">Include system audio</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Available for supported Chrome tabs and screens.
                  </p>
                </div>
                <Switch checked={systemAudio} onCheckedChange={setSystemAudio} />
              </div>
            )}
            {mode === "screen_camera" && (
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-semibold">Camera bubble</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Choose a starting style now; drag it anywhere on the live preview.
                  </p>
                </div>
                <CameraBubbleControls bubble={bubble} onChange={setBubble} />
              </div>
            )}
            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
                {error}
              </p>
            )}
            {mobileCapture && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <p className="font-semibold">Mobile preview</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  Recording can work on supported phones and tablets, but desktop Chrome or Edge is recommended for the full editor. Mobile saves the finished recording without separate screen and camera source layers.
                </p>
              </div>
            )}
            <div className="flex justify-end border-t border-slate-100 pt-5">
              <Button
                onClick={setUp}
                className="h-11 rounded-xl px-5 font-semibold shadow-lg shadow-primary/15"
              >
                <Camera className="h-4 w-4" /> Check devices
              </Button>
            </div>
          </div>
        )}

        {(status === "ready" || active) && (
          <div className="space-y-5 p-5 sm:p-8">
            <div
              className={cn(
                "relative aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-[#10111a]",
                mode === "screen_camera" && "cursor-move",
              )}
              onPointerDown={dragBubble}
            >
              <video
                ref={liveRef}
                muted
                playsInline
                className={cn(
                  "h-full w-full object-contain",
                  mode === "camera" && "scale-x-[-1]",
                )}
              />
              {countdown !== null && (
                <div className="absolute inset-0 grid place-items-center bg-black/65">
                  <span className="text-7xl font-bold text-white">{countdown}</span>
                </div>
              )}
              {active && (
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-sm text-white">
                  <Circle
                    className={cn(
                      "h-3 w-3 fill-red-400 text-red-400",
                      status === "recording" && "animate-pulse",
                    )}
                  />
                  {formatDuration(elapsedMs)}
                </div>
              )}
              {mode === "screen_camera" && countdown === null && (
                <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
                  <Move className="h-3 w-3" /> Drag anywhere to move camera
                </div>
              )}
            </div>
            {mode === "screen_camera" && (
              <CameraBubbleControls bubble={bubble} onChange={setBubble} />
            )}
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white p-2 shadow-[0_14px_35px_rgba(35,42,76,.12)]">
              {status === "ready" && (
                <Button
                  onClick={begin}
                  disabled={countdown !== null}
                  className="h-11 rounded-full px-5"
                >
                  <Circle className="h-4 w-4 fill-red-400 text-red-400" /> Start
                  recording
                </Button>
              )}
              {status === "recording" && (
                <Button variant="secondary" className="rounded-full" onClick={() => { pause(); trackDemoEvent("recording_paused", { mode, elapsedMs }); }}>
                  <Pause className="h-4 w-4" /> Pause
                </Button>
              )}
              {status === "paused" && (
                <Button variant="secondary" className="rounded-full" onClick={() => { resume(); trackDemoEvent("recording_resumed", { mode, elapsedMs }); }}>
                  <Play className="h-4 w-4" /> Resume
                </Button>
              )}
              {active && (
                <Button variant="destructive" className="rounded-full" onClick={() => { stop(); trackDemoEvent("recording_stopped", { mode, elapsedMs }); }}>
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
              {status === "ready" && (
                <Button variant="ghost" className="rounded-full" onClick={resetAll}>
                  <RotateCcw className="h-4 w-4" /> Back
                </Button>
              )}
            </div>
          </div>
        )}

        {status === "stopped" && result && (
          <div className="space-y-5 p-5 sm:p-8">
            <div className="aspect-video overflow-hidden rounded-2xl bg-black shadow-[0_18px_45px_rgba(22,25,45,.18)]">
              <video
                ref={reviewRef}
                controls
                playsInline
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {formatDuration(result.durationMs)} ·{" "}
                {(result.videoBlob.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <span>Demo browser storage</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-video-title" className="text-xs">
                Title
              </Label>
              <Input
                id="demo-video-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Untitled recording"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="flex flex-col gap-3 border-y border-slate-100 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {thumbnail && <ThumbnailPreview blob={thumbnail} />}
                <div>
                  <p className="text-sm font-semibold">Thumbnail</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Choose a frame, upload artwork, or generate a title card.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (reviewRef.current) {
                      setThumbnail(await captureVideoFrame(reviewRef.current));
                    }
                  }}
                >
                  <Camera className="h-4 w-4" /> Current frame
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => thumbnailInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" /> Upload
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const frame = await captureVideoBlobFrame(
                        result.videoBlob,
                        result.durationMs,
                      );
                      setThumbnail(
                        await generateTitleThumbnail(
                          frame,
                          title.trim() || "Untitled recording",
                          appConfig.brandColor,
                        ),
                      );
                    } catch (caught) {
                      toast.error(
                        caught instanceof Error
                          ? caught.message
                          : "Could not generate title card",
                      );
                    }
                  }}
                >
                  <Sparkles className="h-4 w-4" /> Generate title card
                </Button>
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      setThumbnail(validateThumbnailFile(file));
                      toast.success("Custom thumbnail selected");
                    } catch (caught) {
                      toast.error(
                        caught instanceof Error ? caught.message : "Invalid thumbnail",
                      );
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
            {thumbnail && (
              <div className="flex items-center gap-3 text-xs font-medium text-emerald-600">
                <ImagePlus className="h-4 w-4" /> Thumbnail ready for your library
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-5">
              <Button variant="ghost" onClick={resetAll} disabled={saving}>
                <RotateCcw className="h-4 w-4" /> Record again
              </Button>
              <Button
                onClick={save}
                disabled={saving}
                className="rounded-xl px-5 shadow-lg shadow-primary/15"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save & open editor"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
