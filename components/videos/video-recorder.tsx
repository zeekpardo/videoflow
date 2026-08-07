"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { appConfig } from "@/lib/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Monitor,
  Video as VideoIcon,
  MonitorSmartphone,
  Circle,
  Pause,
  Play,
  Square,
  Loader2,
  RotateCcw,
  Camera,
  ImagePlus,
  Move,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  supportsDisplayCapture,
  useMediaRecorder,
  type RecordMode,
} from "./use-media-recorder";
import { CameraBubbleControls } from "./camera-bubble-controls";
import { ThumbnailPreview } from "./thumbnail-preview";
import { captureVideoBlobFrame, captureVideoFrame, generateTitleThumbnail, validateThumbnailFile } from "@/lib/video-thumbnail";
import { defaultVideoEditState } from "@/lib/video-edits";
import { audioFileExtension, videoFilename } from "@/lib/media-format";
import { useResumableUpload } from "./use-resumable-upload";

interface VideoRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (videoId: Id<"videos">) => void;
}

const MODE_CARDS: { mode: RecordMode; label: string; desc: string; icon: typeof Monitor }[] = [
  { mode: "screen", label: "Screen + mic", desc: "Capture your screen with narration", icon: Monitor },
  { mode: "screen_camera", label: "Screen + camera", desc: "Screen with a camera bubble", icon: MonitorSmartphone },
  { mode: "camera", label: "Camera only", desc: "Talking-head video", icon: VideoIcon },
];

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const subscribeToMediaCapabilities = () => () => {};

export function VideoRecorder({ open, onOpenChange, onSaved }: VideoRecorderProps) {
  const uploadFile = useResumableUpload();
  const createVideo = useAction(api.videoActions.create);
  const saveInitialEdits = useMutation(api.videos.saveEdits);

  const rec = useMediaRecorder();
  const { status, prepare, start, pause, resume, stop, reset, result, previewStream, elapsedMs, error, bubble, setBubble } = rec;

  const [mode, setMode] = useState<RecordMode>("screen");
  const [systemAudio, setSystemAudio] = useState(false);
  const [cameraSource, setCameraSource] = useState("facing:user");
  const [micId, setMicId] = useState<string>("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const displayCaptureSupported = useSyncExternalStore(
    subscribeToMediaCapabilities,
    () => supportsDisplayCapture(navigator.mediaDevices),
    () => true,
  );
  const visibleMode = displayCaptureSupported ? mode : "camera";
  const selectedCameraSource = appConfig.features.mobileCameraSwitch
    ? cameraSource
    : "facing:user";

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const reviewRef = useRef<HTMLVideoElement | null>(null);
  const reviewUrlRef = useRef<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const autoStoppedRef = useRef(false);

  const captureThumb = useCallback(async () => {
    const el = reviewRef.current;
    if (!el || !result) return;
    setThumbBlob(await captureVideoFrame(el));
  }, [result]);

  useEffect(() => {
    if (status !== "recording" || autoStoppedRef.current) return;
    if (elapsedMs >= appConfig.maxRecordingMinutes * 60_000) {
      autoStoppedRef.current = true;
      stop();
      toast.info(`Recording stopped at the ${appConfig.maxRecordingMinutes}-minute limit.`);
    }
  }, [elapsedMs, status, stop]);

  // Enumerate devices once the dialog opens.
  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMics(devices.filter((d) => d.kind === "audioinput"));
      })
      .catch(() => {});
  }, [open]);

  // Bind the live preview stream.
  useEffect(() => {
    const el = liveRef.current;
    if (el && previewStream && (status === "ready" || status === "recording" || status === "paused")) {
      el.srcObject = previewStream;
      el.play().catch(() => {});
    }
  }, [previewStream, status]);

  // Build a review URL + default title + auto thumbnail when recording stops.
  useEffect(() => {
    if (status !== "stopped" || !result) return;
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    const url = URL.createObjectURL(result.videoBlob);
    reviewUrlRef.current = url;
    const el = reviewRef.current;
    // auto-capture a thumbnail once the frame is ready
    let grabbed = false;
    const grab = () => {
      if (grabbed) return;
      grabbed = true;
      captureThumb().catch(() => {});
      setTitle((current) => current || `Recording ${new Date().toLocaleDateString()}`);
    };
    const seekPreview = () => {
      if (!el) return;
      const target = Math.min(1, result.durationMs / 1000 / 2, Math.max(0, el.duration - 0.05));
      if (!Number.isFinite(target) || target <= 0.01) {
        if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) grab();
        else el.addEventListener("loadeddata", grab, { once: true });
        return;
      }
      el.addEventListener("seeked", grab, { once: true });
      el.currentTime = target;
    };
    if (el) {
      // Mobile Safari can ignore a seek assigned before metadata is available.
      // Wait for a finite duration, then capture after the seek completes.
      el.src = url;
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) seekPreview();
      else el.addEventListener("loadedmetadata", seekPreview, { once: true });
      el.load();
    }
    return () => {
      el?.removeEventListener("loadedmetadata", seekPreview);
      el?.removeEventListener("loadeddata", grab);
      el?.removeEventListener("seeked", grab);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, result]);

  const resetAll = useCallback(() => {
    reset();
    setCountdown(null);
    setTitle("");
    setThumbBlob(null);
    autoStoppedRef.current = false;
    if (reviewUrlRef.current) {
      URL.revokeObjectURL(reviewUrlRef.current);
      reviewUrlRef.current = null;
    }
  }, [reset]);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next && (status === "recording" || status === "paused")) {
        if (!confirm("Discard this recording?")) return;
      }
      if (!next) resetAll();
      onOpenChange(next);
    },
    [status, resetAll, onOpenChange]
  );

  const onPickMode = async (m: RecordMode) => {
    const selectedMode = displayCaptureSupported ? m : "camera";
    setMode(selectedMode);
    const cameraId = selectedCameraSource.startsWith("device:")
      ? selectedCameraSource.slice("device:".length)
      : undefined;
    const cameraFacing = selectedCameraSource === "facing:environment"
      ? "environment"
      : "user";
    try {
      await prepare({ mode: selectedMode, cameraId, cameraFacing, micId, systemAudio });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not start capture"
      );
    }
  };

  const beginCountdown = () => {
    setCountdown(3);
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setCountdown(null);
        start();
      } else {
        setCountdown(n);
      }
    }, 1000);
  };

  // Drag the camera bubble around the live preview (screen_camera only).
  const dragBubble = (e: React.PointerEvent) => {
    if (mode !== "screen_camera") return;
    const el = e.currentTarget as HTMLElement;
    const move = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      setBubble({
        cx: Math.min(0.92, Math.max(0.08, (clientX - r.left) / r.width)),
        cy: Math.min(0.92, Math.max(0.08, (clientY - r.top) / r.height)),
      });
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleSave = async () => {
    if (!result) return;
    if (result.videoBlob.size > appConfig.maxVideoBytes) {
      toast.error(`This recording exceeds the ${(appConfig.maxVideoBytes / 1024 / 1024).toFixed(0)} MB upload limit.`);
      return;
    }
    setSaving(true);
    try {
      // Upload each blob straight to R2 via presigned PUT (the hook also syncs
      // metadata) and keep the returned object keys.
      const storageId = await uploadFile(
        new File([result.videoBlob], videoFilename("video", result.mimeType), { type: result.mimeType })
      );
      const audioStorageId = result.audioBlob
        ? await uploadFile(
            new File([result.audioBlob], `audio.${audioFileExtension(result.audioBlob.type)}`, {
              type: result.audioBlob.type || "audio/webm",
            })
          )
        : undefined;
      const screenStorageId = result.screenBlob
        ? await uploadFile(
            new File([result.screenBlob], videoFilename("screen-layer", result.screenMimeType || result.screenBlob.type), {
              type:
                result.screenMimeType ||
                result.screenBlob.type ||
                "video/webm",
            })
          )
        : undefined;
      const cameraStorageId = result.cameraBlob
        ? await uploadFile(
            new File([result.cameraBlob], videoFilename("camera-layer", result.cameraMimeType || result.cameraBlob.type), {
              type:
                result.cameraMimeType ||
                result.cameraBlob.type ||
                "video/webm",
            })
          )
        : undefined;
      const finalThumbnail = thumbBlob ?? await captureVideoBlobFrame(result.videoBlob, result.durationMs).catch(() => null);
      const thumbnailStorageId = finalThumbnail
        ? await uploadFile(
            new File([finalThumbnail], "thumbnail.jpg", { type: finalThumbnail.type || "image/jpeg" })
          )
        : undefined;

      const { videoId } = await createVideo({
        title: title.trim() || "Untitled recording",
        storageId,
        screenStorageId,
        cameraStorageId,
        audioStorageId,
        thumbnailStorageId,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
        mode,
        mimeType: result.mimeType,
        sizeBytes: result.videoBlob.size,
      });
      if (screenStorageId && cameraStorageId) {
        await saveInitialEdits({ videoId, editState: defaultVideoEditState("screen_camera", bubble, result.durationMs) });
      }

      toast.success("Recording saved");
      resetAll();
      onOpenChange(false);
      onSaved?.(videoId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save recording");
    } finally {
      setSaving(false);
    }
  };

  const isRecording = status === "recording" || status === "paused";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-h-[96vh] overflow-y-auto rounded-[28px] border-slate-200 bg-white p-0 shadow-[0_30px_100px_rgba(26,31,60,.22)] sm:max-w-5xl"
        // The native screen-picker steals/returns focus and clicking the
        // permission prompts counts as "outside" — without these, Radix would
        // dismiss the recorder mid-setup. Close only via the X or controls.
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-slate-100 px-6 py-5 sm:px-8">
          <p className="text-[11px] font-bold uppercase tracking-[.22em] text-primary">{status === "stopped" ? "Recording complete" : "Recording studio"}</p>
          <DialogTitle className="text-2xl font-bold tracking-[-.035em] text-slate-950">
            {status === "stopped" ? "Review & save" : "Record a video"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Record your screen or camera and save it to your video library.
          </DialogDescription>
        </DialogHeader>

        {/* SETUP */}
        {status === "idle" && (
          <div className="space-y-6 p-6 sm:p-8">
            <div><h3 className="text-sm font-semibold text-slate-900">Choose a recording mode</h3><p className="mt-1 text-xs text-slate-500">You can select your exact devices before capture begins.</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {MODE_CARDS.map((card) => {
                const Icon = card.icon;
                const active = visibleMode === card.mode;
                const unavailable = card.mode !== "camera" && !displayCaptureSupported;
                return (
                  <button
                    key={card.mode}
                    onClick={() => setMode(card.mode)}
                    disabled={unavailable}
                    className={cn(
                      "flex min-h-32 flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
                      unavailable && "cursor-not-allowed opacity-45",
                      active
                        ? "border-primary/40 bg-primary/[.07] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                        : "border-slate-200 hover:border-primary/20 hover:bg-slate-50"
                    )}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-primary shadow-sm"><Icon className="h-4 w-4" /></span>
                    <span className="text-sm font-medium">{card.label}</span>
                    <span className="text-xs text-muted-foreground">{unavailable ? "Requires a supported desktop browser" : card.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(visibleMode === "camera" || visibleMode === "screen_camera") && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Camera</Label>
                  <Select value={selectedCameraSource} onValueChange={setCameraSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facing:user">Front camera</SelectItem>
                      {appConfig.features.mobileCameraSwitch && <SelectItem value="facing:environment">Back camera</SelectItem>}
                      {appConfig.features.mobileCameraSwitch && cameras.filter((device) => device.deviceId && device.label).map((device) => (
                        <SelectItem key={device.deviceId} value={`device:${device.deviceId}`}>
                          {device.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Microphone</Label>
                <Select value={micId} onValueChange={setMicId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {mics.map((d, i) => (
                      <SelectItem key={d.deviceId || i} value={d.deviceId || `mic-${i}`}>
                        {d.label || `Microphone ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!displayCaptureSupported && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                This browser supports camera recording, but it does not expose screen recording. Screen capture still requires a supported desktop browser.
              </p>
            )}

            {(visibleMode === "screen" || visibleMode === "screen_camera") && (
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div>
                  <p className="text-sm font-medium">Include system audio</p>
                  <p className="text-xs text-muted-foreground">
                    Capture sound from the shared tab/screen (Chrome).
                  </p>
                </div>
                <Switch checked={systemAudio} onCheckedChange={setSystemAudio} />
              </div>
            )}

            {visibleMode === "screen_camera" && (
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-semibold">Camera bubble</p>
                  <p className="mt-1 text-xs text-slate-500">Choose a starting style now; drag it anywhere on the live preview.</p>
                </div>
                <CameraBubbleControls bubble={bubble} onChange={setBubble} />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end border-t border-slate-100 pt-5">
              <Button onClick={() => onPickMode(visibleMode)} className="h-11 rounded-xl px-5 font-semibold shadow-lg shadow-primary/15">
                <Monitor className="h-4 w-4" /> Set up recording
              </Button>
            </div>
          </div>
        )}

        {/* READY / RECORDING */}
        {(status === "ready" || isRecording) && (
          <div className="space-y-5 p-5 sm:p-8">
            <div
              className={cn(
                "relative aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-[#10111a] shadow-inner",
                mode === "screen_camera" && "cursor-move"
              )}
              onPointerDown={dragBubble}
            >
              <video
                ref={liveRef}
                muted
                playsInline
                className={cn(
                  "h-full w-full object-contain",
                  mode === "camera" && selectedCameraSource !== "facing:environment" && "scale-x-[-1]"
                )}
              />
              {countdown !== null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <span className="text-7xl font-bold text-white">{countdown}</span>
                </div>
              )}
              {isRecording && (
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white">
                  <Circle className={cn("h-3 w-3 fill-red-500 text-red-500", status === "recording" && "animate-pulse")} />
                  <span className="text-sm tabular-nums">{fmt(elapsedMs)}</span>
                  <span className="text-xs text-white/65">/ {appConfig.maxRecordingMinutes}:00</span>
                </div>
              )}
              {mode === "screen_camera" && countdown === null && (
                <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white/85">
                  <Move className="h-3 w-3" /> Drag to move your camera
                </div>
              )}
            </div>

            {mode === "screen_camera" && <CameraBubbleControls bubble={bubble} onChange={setBubble} />}

            <div className="mx-auto flex w-fit items-center justify-center gap-2 rounded-full border border-slate-200 bg-white p-2 shadow-[0_14px_35px_rgba(35,42,76,.12)]">
              {status === "ready" && (
                <Button onClick={beginCountdown} disabled={countdown !== null} className="h-11 rounded-full px-5">
                  <Circle className="h-4 w-4 fill-red-500 text-red-500" /> Start recording
                </Button>
              )}
              {status === "recording" && (
                <Button variant="secondary" onClick={pause} className="rounded-full">
                  <Pause className="h-4 w-4" /> Pause
                </Button>
              )}
              {status === "paused" && (
                <Button variant="secondary" onClick={resume} className="rounded-full">
                  <Play className="h-4 w-4" /> Resume
                </Button>
              )}
              {isRecording && (
                <Button variant="destructive" onClick={stop} className="rounded-full">
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
              {status === "ready" && (
                <Button variant="ghost" onClick={resetAll} className="rounded-full">
                  <RotateCcw className="h-4 w-4" /> Restart
                </Button>
              )}
            </div>
          </div>
        )}

        {/* REVIEW */}
        {status === "stopped" && result && (
          <div className="space-y-5 p-5 sm:p-8">
            <div className="aspect-video overflow-hidden rounded-2xl bg-black shadow-[0_18px_45px_rgba(22,25,45,.18)]">
              <video ref={reviewRef} controls playsInline className="h-full w-full object-contain" />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {fmt(result.durationMs)} · {(result.videoBlob.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <span>{thumbBlob ? "Thumbnail ready" : "Creating thumbnail…"}</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="video-title" className="text-xs">Title</Label>
              <Input
                id="video-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled recording"
              />
            </div>

            <div className="flex flex-col gap-3 border-y border-slate-100 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">{thumbBlob && <ThumbnailPreview blob={thumbBlob} />}<div><p className="text-sm font-semibold">Thumbnail</p><p className="mt-0.5 text-xs text-slate-500">A frame is captured automatically. You can also upload artwork or generate a title card.</p></div></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => captureThumb().catch((caught) => toast.error(caught instanceof Error ? caught.message : "Could not capture frame"))}><Camera className="h-4 w-4" /> Current frame</Button>
                <Button size="sm" variant="outline" onClick={() => thumbnailInputRef.current?.click()}><Upload className="h-4 w-4" /> Upload</Button>
                <Button size="sm" onClick={async () => { try { const frame = await captureVideoBlobFrame(result.videoBlob, result.durationMs); setThumbBlob(await generateTitleThumbnail(frame, title.trim() || "Untitled recording", appConfig.brandColor)); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not generate thumbnail"); } }}><Sparkles className="h-4 w-4" /> Generate title card</Button>
                <input ref={thumbnailInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; try { setThumbBlob(validateThumbnailFile(file)); toast.success("Custom thumbnail selected"); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Invalid thumbnail"); } event.currentTarget.value = ""; }} />
              </div>
            </div>
            {thumbBlob && <p className="flex items-center gap-2 text-xs font-medium text-emerald-600"><ImagePlus className="h-4 w-4" /> This thumbnail will appear in the library and on the share page.</p>}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={resetAll} disabled={saving}>
                <RotateCcw className="h-4 w-4" /> Record again
              </Button>
              <Button onClick={handleSave} disabled={saving} className="rounded-xl px-5 shadow-lg shadow-primary/15">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>Save &amp; open editor</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
