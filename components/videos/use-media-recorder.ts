"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import fixWebmDuration from "fix-webm-duration";
import { cameraFrameRect } from "../../lib/video-layout";

export type RecordMode = "screen" | "screen_camera" | "camera";
export type CameraFacing = "user" | "environment";

// Live-adjustable camera-bubble config for screen_camera mode. cx/cy are the
// bubble center as a fraction of the frame; d is the diameter as a fraction of
// the smaller frame dimension. Read every animation frame so changes apply live
// (and bake into the recording).
export interface BubbleConfig {
  cx: number;
  cy: number;
  d: number;
  shape: "circle" | "square";
  mirror: boolean;
}

export interface PrepareOpts {
  mode: RecordMode;
  cameraId?: string;
  cameraFacing?: CameraFacing;
  micId?: string;
  systemAudio?: boolean;
  /** Keep separate screen/camera files for non-destructive editing. */
  retainSourceLayers?: boolean;
}

/**
 * Ask Chromium for a high-density display surface without forcing a 16:9
 * aspect ratio. These are ideals, so ultrawide/window shares keep their native
 * shape and lower-resolution displays fall back to their available pixels.
 */
export const HIGH_DETAIL_DISPLAY_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 3_840 },
  height: { ideal: 2_160 },
  frameRate: { ideal: 30, max: 30 },
};

export function supportsDisplayCapture(
  mediaDevices: Pick<MediaDevices, "getDisplayMedia"> | null | undefined
): boolean {
  return typeof mediaDevices?.getDisplayMedia === "function";
}

export function cameraVideoConstraints(
  cameraId?: string,
  cameraFacing: CameraFacing = "user",
  exactFacing = true
): MediaTrackConstraints {
  return {
    ...(cameraId
      ? { deviceId: { exact: cameraId } }
      : {
          facingMode: exactFacing
            ? { exact: cameraFacing }
            : { ideal: cameraFacing },
        }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  };
}

export interface RecordResult {
  videoBlob: Blob;
  audioBlob: Blob | null;
  /** Raw visual layers retained for non-destructive post-record editing. */
  screenBlob?: Blob;
  cameraBlob?: Blob;
  screenMimeType?: string;
  cameraMimeType?: string;
  durationMs: number;
  width: number;
  height: number;
  mimeType: string;
}

type Status = "idle" | "ready" | "recording" | "paused" | "stopped";

function supportsRecorderMime(mimeType: string) {
  if (typeof MediaRecorder === "undefined") return false;
  if (typeof MediaRecorder.isTypeSupported !== "function") return mimeType === "audio/mp4" || mimeType === "video/mp4";
  return MediaRecorder.isTypeSupported(mimeType);
}

export function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (supportsRecorderMime(c))
      return c;
  }
  return typeof MediaRecorder === "undefined" ? "video/webm" : "";
}

/**
 * Auxiliary screen/camera layers intentionally contain no audio. Advertising
 * Opus in their MIME type can make an otherwise supported MediaRecorder
 * configuration fail (or produce a file some players refuse to decode) when
 * the input stream has only a video track.
 */
export function pickVideoOnlyMime(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ];
  for (const candidate of candidates) {
    if (
      supportsRecorderMime(candidate)
    ) {
      return candidate;
    }
  }
  return typeof MediaRecorder === "undefined" ? "video/webm" : "";
}

export function pickAudioMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (supportsRecorderMime(c))
      return c;
  }
  return typeof MediaRecorder === "undefined" ? "audio/webm" : "";
}

export function recordedMimeType(
  recorderMime: string | undefined,
  requestedMime: string,
  fallback = "video/mp4",
) {
  return recorderMime?.trim() || requestedMime || fallback;
}

export type RecordingVideoKind = "screen" | "camera";

/**
 * MediaRecorder's browser default and the old fixed 4 Mbps target visibly
 * smear text and UI details, especially when a native 1440p/4K screen layer is
 * retained for the editor. Scale the target with the actual captured pixels
 * while keeping camera-only files and very large displays within practical
 * browser-encoder limits.
 */
export function recordingVideoBitrate(
  width: number,
  height: number,
  kind: RecordingVideoKind,
  mimeType = "video/webm",
  fps = 30
): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1_280;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 720;
  const safeFps = Math.max(15, Math.min(60, Number.isFinite(fps) ? fps : 30));
  const isVp9 = mimeType.toLowerCase().includes("vp9");
  const bitsPerPixel = kind === "screen"
    ? (isVp9 ? 0.19 : 0.22)
    : (isVp9 ? 0.1 : 0.12);
  const floor = kind === "screen" ? 8_000_000 : 4_000_000;
  const ceiling = kind === "screen" ? 36_000_000 : 12_000_000;
  return Math.round(
    Math.min(ceiling, Math.max(floor, safeWidth * safeHeight * safeFps * bitsPerPixel))
  );
}

function setVideoContentHint(track: MediaStreamTrack | undefined, hint: "detail" | "motion") {
  if (!track) return;
  try {
    track.contentHint = hint;
  } catch {
    // contentHint is advisory and is not implemented by every recorder.
  }
}

// Mix one or more audio streams down to a single track (MediaRecorder only
// encodes one audio track). Returns the merged track + the context to close.
function mixAudio(streams: MediaStream[]): {
  track: MediaStreamTrack | null;
  ctx: AudioContext | null;
} {
  const withAudio = streams.filter((s) => s.getAudioTracks().length > 0);
  if (withAudio.length === 0) return { track: null, ctx: null };
  if (withAudio.length === 1)
    return { track: withAudio[0].getAudioTracks()[0], ctx: null };
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of withAudio) {
    ctx.createMediaStreamSource(s).connect(dest);
  }
  return { track: dest.stream.getAudioTracks()[0], ctx };
}

async function playHidden(stream: MediaStream): Promise<HTMLVideoElement> {
  const el = document.createElement("video");
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  await new Promise<void>((resolve) => {
    el.onloadedmetadata = () => resolve();
  });
  await el.play().catch(() => {});
  return el;
}

async function repairWebmDuration(
  blob: Blob,
  durationMs: number
): Promise<Blob> {
  if (!blob.size || !blob.type.includes("webm") || durationMs <= 0) return blob;
  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch {
    return blob;
  }
}

/**
 * A MediaRecorder can return a non-empty Blob even when an auxiliary encoder
 * failed before writing a decodable frame. Verify the browser can load a real
 * frame before letting the editor replace the known-good composite with raw
 * layers. This check is deliberately bounded so a broken blob cannot leave the
 * save flow hanging indefinitely.
 */
async function isPlayableVideoBlob(
  blob: Blob,
  timeoutMs = 4_000
): Promise<boolean> {
  if (!blob.size || typeof document === "undefined") return false;

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (playable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.onloadeddata = null;
      video.onerror = null;
      video.onabort = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(playable);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);

    video.onloadeddata = () => {
      finish(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0
      );
    };
    video.onerror = () => finish(false);
    video.onabort = () => finish(false);
    video.src = objectUrl;
    video.load();
  });
}

function discardRecorder(recorder: MediaRecorder | null) {
  if (!recorder) return;
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
  if (recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      // The browser may have already stopped a recorder after its source ended.
    }
  }
}

export function useMediaRecorder() {
  const [status, setStatus] = useState<Status>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordResult | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  // Camera-bubble (screen_camera). State drives the UI; the ref is read each
  // frame by the canvas compositor so repositioning is live.
  const [bubble, setBubbleState] = useState<BubbleConfig>({
    cx: 0.17,
    cy: 0.81,
    d: 0.26,
    shape: "circle",
    mirror: false,
  });
  const bubbleRef = useRef<BubbleConfig>(bubble);
  const setBubble = useCallback((patch: Partial<BubbleConfig>) => {
    setBubbleState((prev) => {
      const next = { ...prev, ...patch };
      bubbleRef.current = next;
      return next;
    });
  }, []);

  // mutable refs (no re-render)
  const screenRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const drawWorkerRef = useRef<Worker | null>(null);
  const drawWorkerUrlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const srcVideosRef = useRef<HTMLVideoElement[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  // Holds the latest stop fn so prepare()'s "stop sharing" handler can call it
  // without taking stopInternal as a dependency (it's defined later).
  const stopRef = useRef<() => void>(() => {});
  const chunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const screenChunksRef = useRef<Blob[]>([]);
  const cameraChunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("video/webm");
  const screenMimeRef = useRef<string>("video/webm");
  const cameraMimeRef = useRef<string>("video/webm");
  const retainSourceLayersRef = useRef(true);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const startedAtRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTracks = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (drawWorkerRef.current) {
      drawWorkerRef.current.terminate();
      drawWorkerRef.current = null;
    }
    if (drawWorkerUrlRef.current) {
      URL.revokeObjectURL(drawWorkerUrlRef.current);
      drawWorkerUrlRef.current = null;
    }
    for (const s of [
      screenRef.current,
      cameraRef.current,
      micRef.current,
      recordStreamRef.current,
    ]) {
      s?.getTracks().forEach((t) => t.stop());
    }
    screenRef.current = null;
    cameraRef.current = null;
    micRef.current = null;
    recordStreamRef.current = null;
    canvasRef.current = null;
    srcVideosRef.current.forEach((el) => {
      el.srcObject = null;
    });
    srcVideosRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const reset = useCallback(() => {
    discardRecorder(recorderRef.current);
    discardRecorder(audioRecorderRef.current);
    discardRecorder(screenRecorderRef.current);
    discardRecorder(cameraRecorderRef.current);
    stopTracks();
    recorderRef.current = null;
    audioRecorderRef.current = null;
    screenRecorderRef.current = null;
    cameraRecorderRef.current = null;
    chunksRef.current = [];
    audioChunksRef.current = [];
    screenChunksRef.current = [];
    cameraChunksRef.current = [];
    screenRef.current = null;
    cameraRef.current = null;
    micRef.current = null;
    recordStreamRef.current = null;
    canvasRef.current = null;
    startedAtRef.current = 0;
    pausedAccumRef.current = 0;
    pausedAtRef.current = 0;
    setElapsedMs(0);
    setResult(null);
    setError(null);
    setPreviewStream(null);
    setStatus("idle");
  }, [stopTracks]);

  // Acquire devices, build the stream we'll record, and expose a live preview.
  const prepare = useCallback(
    async (opts: PrepareOpts) => {
      setError(null);
      reset();
      const {
        mode,
        cameraId,
        cameraFacing = "user",
        micId,
        systemAudio,
        retainSourceLayers = true,
      } = opts;
      retainSourceLayersRef.current = retainSourceLayers;
      try {
        // Screen/camera capture only works in a secure context. localhost is
        // secure; a plain-http LAN IP (e.g. 10.x.x.x:3002) is NOT, and there
        // navigator.mediaDevices is undefined — fail with a clear message.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera and microphone capture require HTTPS (localhost also works)."
          );
        }
        if (
          (mode === "screen" || mode === "screen_camera") &&
          !supportsDisplayCapture(navigator.mediaDevices)
        ) {
          throw new Error(
            "Screen recording is unavailable in this browser. Use camera-only recording here, or use a supported desktop browser for screen capture."
          );
        }
        let screen: MediaStream | null = null;
        let camera: MediaStream | null = null;

        if (mode === "screen" || mode === "screen_camera") {
          screen = await navigator.mediaDevices.getDisplayMedia({
            video: HIGH_DETAIL_DISPLAY_CONSTRAINTS,
            audio: !!systemAudio,
          });
          screenRef.current = screen;
          setVideoContentHint(screen.getVideoTracks()[0], "detail");
          // Browser "Stop sharing" button ends the screen track.
          screen.getVideoTracks()[0].addEventListener("ended", () => {
            // defer to allow recorder flush
            setTimeout(() => stopRef.current(), 0);
          });
        }
        if (mode === "camera" || mode === "screen_camera") {
          try {
            camera = await navigator.mediaDevices.getUserMedia({
              video: cameraVideoConstraints(cameraId, cameraFacing),
              audio: false,
            });
          } catch (caught) {
            // Mobile Safari can expose front/back cameras while declining an
            // exact facingMode constraint. Retry with an ideal constraint so
            // camera recording still works on those devices.
            if (
              cameraId ||
              !(caught instanceof DOMException) ||
              caught.name !== "OverconstrainedError"
            ) {
              throw caught;
            }
            camera = await navigator.mediaDevices.getUserMedia({
              video: cameraVideoConstraints(undefined, cameraFacing, false),
              audio: false,
            });
          }
          cameraRef.current = camera;
          setVideoContentHint(camera.getVideoTracks()[0], "motion");
        }
        // Mic is always its own stream so we can record audio-only for Whisper.
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micId || undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
        micRef.current = mic;

        // Build the video track + preview.
        let videoTrack: MediaStreamTrack;
        if (mode === "screen_camera" && screen && camera) {
          const screenVideo = await playHidden(screen);
          const camVideo = await playHidden(camera);
          srcVideosRef.current = [screenVideo, camVideo];
          // Cap the composite canvas to 1080p wide. At a screen's native 4K the
          // per-frame drawImage + H.264/VP9 encode saturates the main thread and
          // freezes the tab; downscaling keeps it smooth (fractions still map).
          const rawW = screenVideo.videoWidth || 1280;
          const rawH = screenVideo.videoHeight || 720;
          const k = Math.min(1, 1920 / rawW);
          const sw = Math.round(rawW * k);
          const sh = Math.round(rawH * k);
          const canvas = document.createElement("canvas");
          canvas.width = sw;
          canvas.height = sh;
          canvasRef.current = canvas;
          dimsRef.current = { w: sw, h: sh };
          const c = canvas.getContext("2d", { alpha: false })!;
          c.imageSmoothingEnabled = true;
          c.imageSmoothingQuality = "high";

          const drawOnce = () => {
            c.drawImage(screenVideo, 0, 0, sw, sh);
            const b = bubbleRef.current;
            const bubbleRect = cameraFrameRect(sw, sh, b.cx, b.cy, b.d);
            const d = Math.round(bubbleRect.width);
            const r = d / 2;
            const cx = Math.round(bubbleRect.x + bubbleRect.width / 2);
            const cy = Math.round(bubbleRect.y + bubbleRect.height / 2);
            const cw = camVideo.videoWidth || 640;
            const ch = camVideo.videoHeight || 480;
            const scale = Math.max(d / cw, d / ch);
            const dw = cw * scale;
            const dh = ch * scale;

            const path = () => {
              c.beginPath();
              if (b.shape === "square") c.roundRect(cx - r, cy - r, d, d, d * 0.16);
              else c.arc(cx, cy, r, 0, Math.PI * 2);
              c.closePath();
            };

            // cover-fit camera into the clipped bubble (optionally mirrored)
            c.save();
            path();
            c.clip();
            if (b.mirror) {
              c.translate(cx, cy);
              c.scale(-1, 1);
              c.drawImage(camVideo, -dw / 2, -dh / 2, dw, dh);
            } else {
              c.drawImage(camVideo, cx - dw / 2, cy - dh / 2, dw, dh);
            }
            c.restore();

            // ring
            path();
            c.lineWidth = Math.max(2, d * 0.02);
            c.strokeStyle = "rgba(255,255,255,0.92)";
            c.stroke();
          };
          // Drive the compositor from a Web Worker timer rather than rAF. rAF
          // (and page timers) throttle to ~1fps when the recorder tab is in the
          // background — exactly when you're recording another window — which
          // bakes a crawling, choppy video. Worker timers aren't throttled, so
          // the composite stays at 30fps regardless of focus.
          // Manual-capture the canvas (frameRate 0): we push exactly one fresh
          // frame per tick via requestFrame(), so the recording stays a steady
          // 30fps even when the auto-sampler would stall in a background tab.
          const canvasStream = canvas.captureStream(0);
          const canvasTrack =
            canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
          setVideoContentHint(canvasTrack, "detail");
          videoTrack = canvasTrack;
          const tick = () => {
            drawOnce();
            canvasTrack.requestFrame?.();
          };
          tick();
          try {
            const workerUrl = URL.createObjectURL(
              new Blob(
                [
                  `setInterval(function(){postMessage(0)}, ${Math.round(1000 / 30)})`,
                ],
                { type: "text/javascript" }
              )
            );
            drawWorkerUrlRef.current = workerUrl;
            const w = new Worker(workerUrl);
            w.onmessage = () => tick();
            drawWorkerRef.current = w;
          } catch {
            if (drawWorkerUrlRef.current) {
              URL.revokeObjectURL(drawWorkerUrlRef.current);
              drawWorkerUrlRef.current = null;
            }
            const loop = () => {
              tick();
              rafRef.current = requestAnimationFrame(loop);
            };
            loop();
          }
        } else if (mode === "camera" && camera) {
          const t = camera.getVideoTracks()[0];
          const s = t.getSettings();
          dimsRef.current = { w: s.width ?? 1280, h: s.height ?? 720 };
          videoTrack = t;
        } else if (screen) {
          const t = screen.getVideoTracks()[0];
          const s = t.getSettings();
          dimsRef.current = { w: s.width ?? 1920, h: s.height ?? 1080 };
          videoTrack = t;
        } else {
          throw new Error("No video source");
        }

        // Audio: mic (+ system audio when present) mixed into one track.
        const audioSources: MediaStream[] = [mic];
        if (systemAudio && screen && screen.getAudioTracks().length > 0)
          audioSources.push(screen);
        const { track: mixedAudio, ctx } = mixAudio(audioSources);
        audioCtxRef.current = ctx;

        const recordStream = new MediaStream();
        recordStream.addTrack(videoTrack);
        if (mixedAudio) recordStream.addTrack(mixedAudio);
        recordStreamRef.current = recordStream;

        // For screen-only/camera preview we can show the record stream directly.
        // For camera mode, mirror is applied by the UI via CSS.
        setPreviewStream(recordStream);
        setStatus("ready");
      } catch (e) {
        const msg =
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Permission denied or dismissed. Allow screen/camera access and try again."
            : e instanceof DOMException && e.name === "NotFoundError"
              ? "No camera/microphone found. Connect one and try again."
              : e instanceof DOMException && e.name === "OverconstrainedError"
                ? "The selected camera/mic isn't available. Choose Default and retry."
                : e instanceof Error
                  ? e.message
                  : "Could not start capture.";
        setError(msg);
        stopTracks();
        setStatus("idle");
        throw e;
      }
    },
    [reset, stopTracks]
  );

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current - pausedAccumRef.current);
    }, 250);
  }, []);

  const start = useCallback(() => {
    const stream = recordStreamRef.current;
    const mic = micRef.current;
    if (!stream) return;

    const requestedMime = pickVideoMime();
    chunksRef.current = [];
    const primaryKind: RecordingVideoKind = screenRef.current ? "screen" : "camera";
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        ...(requestedMime ? { mimeType: requestedMime } : {}),
        videoBitsPerSecond: recordingVideoBitrate(
          dimsRef.current.w,
          dimsRef.current.h,
          primaryKind,
          requestedMime || "video/mp4"
        ),
        audioBitsPerSecond: 128_000,
      });
    } catch {
      setError("This browser could not start the selected video encoder.");
      stopTracks();
      setStatus("idle");
      return;
    }
    const mime = recordedMimeType(rec.mimeType, requestedMime);
    mimeRef.current = mime;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorderRef.current = rec;

    // Retain the uncomposited screen and camera streams for the editor. These
    // are deliberately video-only: the primary composite remains the source of
    // truth for synchronized audio, legacy playback, and downloads.
    screenChunksRef.current = [];
    cameraChunksRef.current = [];
    screenRecorderRef.current = null;
    cameraRecorderRef.current = null;
    if (
      screenRef.current &&
      cameraRef.current &&
      retainSourceLayersRef.current
    ) {
      try {
        const screenMime = pickVideoOnlyMime();
        const screenTrack = screenRef.current.getVideoTracks()[0];
        const screenSettings = screenTrack.getSettings();
        const screenRecorder = new MediaRecorder(
          new MediaStream([screenTrack]),
          {
            ...(screenMime ? { mimeType: screenMime } : {}),
            videoBitsPerSecond: recordingVideoBitrate(
              screenSettings.width ?? dimsRef.current.w,
              screenSettings.height ?? dimsRef.current.h,
              "screen",
              screenMime,
              screenSettings.frameRate ?? 30
            ),
          }
        );
        screenMimeRef.current = recordedMimeType(
          screenRecorder.mimeType,
          screenMime,
        );
        screenRecorder.ondataavailable = (event) => {
          if (event.data.size) screenChunksRef.current.push(event.data);
        };
        screenRecorderRef.current = screenRecorder;
      } catch {
        // The editable layer is an enhancement; never sacrifice the primary
        // recording when a browser cannot create this additional recorder.
        screenRecorderRef.current = null;
      }

      try {
        const cameraMime = pickVideoOnlyMime();
        const cameraTrack = cameraRef.current.getVideoTracks()[0];
        const cameraSettings = cameraTrack.getSettings();
        const cameraRecorder = new MediaRecorder(
          new MediaStream([cameraTrack]),
          {
            ...(cameraMime ? { mimeType: cameraMime } : {}),
            videoBitsPerSecond: recordingVideoBitrate(
              cameraSettings.width ?? 1_280,
              cameraSettings.height ?? 720,
              "camera",
              cameraMime,
              cameraSettings.frameRate ?? 30
            ),
          }
        );
        cameraMimeRef.current = recordedMimeType(
          cameraRecorder.mimeType,
          cameraMime,
        );
        cameraRecorder.ondataavailable = (event) => {
          if (event.data.size) cameraChunksRef.current.push(event.data);
        };
        cameraRecorderRef.current = cameraRecorder;
      } catch {
        cameraRecorderRef.current = null;
      }
    }

    // audio-only recorder for transcription (mic only)
    if (mic && mic.getAudioTracks().length > 0) {
      audioChunksRef.current = [];
      const amime = pickAudioMime();
      const arec = new MediaRecorder(new MediaStream(mic.getAudioTracks()), {
        ...(amime ? { mimeType: amime } : {}),
      });
      arec.ondataavailable = (e) => {
        if (e.data.size) audioChunksRef.current.push(e.data);
      };
      audioRecorderRef.current = arec;
    }

    try {
      rec.start(1000);
    } catch {
      discardRecorder(screenRecorderRef.current);
      discardRecorder(cameraRecorderRef.current);
      discardRecorder(audioRecorderRef.current);
      recorderRef.current = null;
      screenRecorderRef.current = null;
      cameraRecorderRef.current = null;
      audioRecorderRef.current = null;
      setError("This browser could not start the recording.");
      stopTracks();
      setStatus("idle");
      return;
    }
    startedAtRef.current = Date.now();
    pausedAccumRef.current = 0;
    try {
      screenRecorderRef.current?.start(1000);
    } catch {
      discardRecorder(screenRecorderRef.current);
      screenRecorderRef.current = null;
      screenChunksRef.current = [];
    }
    try {
      cameraRecorderRef.current?.start(1000);
    } catch {
      discardRecorder(cameraRecorderRef.current);
      cameraRecorderRef.current = null;
      cameraChunksRef.current = [];
    }
    try {
      audioRecorderRef.current?.start(1000);
    } catch {
      discardRecorder(audioRecorderRef.current);
      audioRecorderRef.current = null;
      audioChunksRef.current = [];
    }
    startTick();
    setStatus("recording");
  }, [startTick, stopTracks]);

  const pause = useCallback(() => {
    for (const recorder of [
      recorderRef.current,
      audioRecorderRef.current,
      screenRecorderRef.current,
      cameraRecorderRef.current,
    ]) {
      if (recorder?.state === "recording") {
        try {
          recorder.pause();
        } catch {
          // A source track can end between the state check and this call.
        }
      }
    }
    pausedAtRef.current = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    for (const recorder of [
      recorderRef.current,
      audioRecorderRef.current,
      screenRecorderRef.current,
      cameraRecorderRef.current,
    ]) {
      if (recorder?.state === "paused") {
        try {
          recorder.resume();
        } catch {
          // A source track can end between the state check and this call.
        }
      }
    }
    if (pausedAtRef.current)
      pausedAccumRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    startTick();
    setStatus("recording");
  }, [startTick]);

  // Internal stop used by both the UI and the "stop sharing" track-ended event.
  const stopInternal = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    const stoppedAt = Date.now();
    const activePauseMs = pausedAtRef.current
      ? stoppedAt - pausedAtRef.current
      : 0;
    const durationMs =
      stoppedAt -
      startedAtRef.current -
      pausedAccumRef.current -
      activePauseMs;

    const finalize = async () => {
      // Release the camera/screen indicator immediately after every recorder
      // has flushed; duration repair can continue without holding devices open.
      stopTracks();
      const mime = mimeRef.current;
      const rawVideo = new Blob(chunksRef.current, { type: mime });
      // MediaRecorder omits the Duration from the webm header, so the stored +
      // downloaded file has no scrubber and external players treat it as a live
      // stream. Inject the real duration before the blob leaves the recorder so
      // the uploaded file is seekable everywhere. Falls back to the raw blob on
      // any error.
      const videoBlob = await repairWebmDuration(rawVideo, durationMs);
      const screenMime =
        screenRecorderRef.current?.mimeType || screenMimeRef.current;
      const cameraMime =
        cameraRecorderRef.current?.mimeType || cameraMimeRef.current;
      const rawScreen = screenChunksRef.current.length
        ? new Blob(screenChunksRef.current, { type: screenMime })
        : undefined;
      const rawCamera = cameraChunksRef.current.length
        ? new Blob(cameraChunksRef.current, { type: cameraMime })
        : undefined;
      const repairedScreen = rawScreen
        ? await repairWebmDuration(rawScreen, durationMs)
        : undefined;
      const repairedCamera = rawCamera
        ? await repairWebmDuration(rawCamera, durationMs)
        : undefined;
      // Editable source layers are a pair. If either auxiliary recorder
      // produced a truncated/unplayable file, omit both and keep using the
      // primary composite. That prevents a bad screen layer from hiding the
      // working recording while leaving a giant webcam as the only visual.
      const rawLayersPlayable =
        repairedScreen && repairedCamera
          ? (
              await Promise.all([
                isPlayableVideoBlob(repairedScreen),
                isPlayableVideoBlob(repairedCamera),
              ])
            ).every(Boolean)
          : false;
      const screenBlob = rawLayersPlayable ? repairedScreen : undefined;
      const cameraBlob = rawLayersPlayable ? repairedCamera : undefined;
      const audioBlob =
        audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, {
              type: audioRecorderRef.current?.mimeType || "audio/webm",
            })
          : null;
      setResult({
        videoBlob,
        audioBlob,
        screenBlob,
        cameraBlob,
        screenMimeType: screenBlob ? screenMime : undefined,
        cameraMimeType: cameraBlob ? cameraMime : undefined,
        durationMs: Math.max(0, durationMs),
        width: dimsRef.current.w,
        height: dimsRef.current.h,
        mimeType: mime,
      });
      recorderRef.current = null;
      audioRecorderRef.current = null;
      screenRecorderRef.current = null;
      cameraRecorderRef.current = null;
      chunksRef.current = [];
      audioChunksRef.current = [];
      screenChunksRef.current = [];
      cameraChunksRef.current = [];
      setStatus("stopped");
    };

    const activeRecorders = [
      rec,
      audioRecorderRef.current,
      screenRecorderRef.current,
      cameraRecorderRef.current,
    ].filter(
      (recorder): recorder is MediaRecorder =>
        !!recorder && recorder.state !== "inactive"
    );
    let pending = activeRecorders.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) void finalize();
    };
    if (!pending) {
      void finalize();
    } else {
      for (const recorder of activeRecorders) {
        recorder.onstop = done;
        try {
          recorder.stop();
        } catch {
          done();
        }
      }
    }
    if (tickRef.current) clearInterval(tickRef.current);
  }, [stopTracks]);

  // Keep the ref pointed at the current stop fn for the track-ended handler.
  useEffect(() => {
    stopRef.current = stopInternal;
    return () => {
      stopRef.current = () => {};
      discardRecorder(recorderRef.current);
      discardRecorder(audioRecorderRef.current);
      discardRecorder(screenRecorderRef.current);
      discardRecorder(cameraRecorderRef.current);
      stopTracks();
    };
  }, [stopInternal, stopTracks]);

  const stop = useCallback(() => stopInternal(), [stopInternal]);

  return {
    status,
    elapsedMs,
    error,
    result,
    previewStream,
    prepare,
    start,
    pause,
    resume,
    stop,
    reset,
    bubble,
    setBubble,
  };
}
