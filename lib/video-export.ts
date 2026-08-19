import fixWebmDuration from "fix-webm-duration";
import {
  activeTextOverlays,
  activeZoomEffect,
  buildVideoTimelineMap,
  normalizeVideoEditState,
  type VideoCut,
  type VideoEditState,
  type VideoEditStateV2,
  type VideoTextOverlay,
  type VideoTrim,
  type VideoZoomEffect,
} from "@/lib/video-edits";
import { masterGainAt } from "@/lib/video-audio";
import { drawVideoOverlays, type VideoGraphicSources } from "@/lib/video-overlay-render";
import { videoFileExtension } from "@/lib/media-format";
import { cameraFrameRect } from "./video-layout";

export interface SourceRange {
  startMs: number;
  endMs: number;
}

export interface ExportProgress {
  progress: number;
  sourceTimeMs: number;
  renderedMs: number;
  totalMs: number;
}

export type ExportResolutionPreset = "native" | "1080p" | "720p";

export interface EditedVideoExportOptions {
  primarySrc: string;
  screenSrc?: string;
  cameraSrc?: string;
  durationMs: number;
  editState: VideoEditState;
  zoomEffects: VideoZoomEffect[];
  /** Raster assets keyed by the portable asset IDs stored in object overlays. */
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  /** Render-only overlays, such as a long caption track, that are not persisted in edit state. */
  supplementalTextOverlays?: readonly VideoTextOverlay[];
  resolution?: ExportResolutionPreset;
  width?: number;
  height?: number;
  fps?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export interface VideoProjectManifestInput {
  title: string;
  mode: "screen" | "screen_camera" | "camera";
  durationMs: number;
  editState: VideoEditState;
  zoomEffects: VideoZoomEffect[];
  hasScreenLayer: boolean;
  hasCameraLayer: boolean;
  sourceMimeType?: string;
}

interface OutputRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ExportVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const EXPORT_TIMEOUT_MS = 45_000;
const NATIVE_MAX_WIDTH = 7_680;
const NATIVE_MAX_HEIGHT = 4_320;

function abortError() {
  return new DOMException("Edited export canceled", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export function safeVideoFilename(title: string) {
  const safe = title
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[^a-zA-Z0-9\p{L}\p{N}._ -]+/gu, "")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+/g, "")
    .slice(0, 80);
  const withoutExtension = safe.replace(/\.(?:webm|mp4|json)$/i, "");
  if (!withoutExtension || /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(withoutExtension)) return "videoflow-recording";
  return withoutExtension;
}

export function buildKeptSourceRanges(durationMs: number, cuts: readonly VideoCut[] = [], trim?: Partial<VideoTrim> | null): SourceRange[] {
  return buildVideoTimelineMap(durationMs, cuts, trim).ranges.map(({ startMs, endMs }) => ({ startMs, endMs }));
}

export function keptDurationMs(ranges: readonly SourceRange[]) {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.endMs - range.startMs), 0);
}

export function containRect(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number, centerX = 0.5, centerY = 0.5, scale = 1): OutputRect {
  const sourceAspect = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  const outputAspect = Math.max(1, outputWidth) / Math.max(1, outputHeight);
  let width = outputWidth;
  let height = outputHeight;
  if (sourceAspect > outputAspect) height = width / sourceAspect;
  else width = height * sourceAspect;
  width *= scale;
  height *= scale;
  return { x: centerX * outputWidth - width / 2, y: centerY * outputHeight - height / 2, width, height };
}

export function cameraRect(outputWidth: number, outputHeight: number, x: number, y: number, size: number): OutputRect {
  return cameraFrameRect(outputWidth, outputHeight, x, y, size);
}

/** Resolve editor stroke pixels into output pixels without changing its visual weight. */
export function cameraStrokeWidth(outputWidth: number, outputHeight: number, logicalWidth = 3) {
  const shorterEdge = Math.max(1, Math.min(
    Number.isFinite(outputWidth) ? outputWidth : 1,
    Number.isFinite(outputHeight) ? outputHeight : 1
  ));
  return Math.max(0, Number.isFinite(logicalWidth) ? logicalWidth : 3) * shorterEdge / 1080;
}

function evenPixels(value: number) {
  return Math.max(2, Math.floor(Math.round(value) / 2) * 2);
}

/**
 * Resolves an encoder-safe output canvas without stretching the recording.
 * Fixed presets intentionally upscale when selected; native keeps the source
 * dimensions and only applies an 8K safety ceiling for browser encoders.
 */
export function resolveExportDimensions(preset: ExportResolutionPreset, sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1_280;
  const height = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 720;
  const bounds = preset === "1080p"
    ? { width: 1_920, height: 1_080, upscale: true }
    : preset === "720p"
      ? { width: 1_280, height: 720, upscale: true }
      : { width: NATIVE_MAX_WIDTH, height: NATIVE_MAX_HEIGHT, upscale: false };
  const scale = Math.min(bounds.width / width, bounds.height / height, bounds.upscale ? Number.POSITIVE_INFINITY : 1);
  return { width: evenPixels(width * scale), height: evenPixels(height * scale) };
}

export function exportVideoBitrate(width: number, height: number, fps = 30, mimeType = "video/webm") {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1_280;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 720;
  const safeFps = Math.max(15, Math.min(60, Number.isFinite(fps) ? fps : 30));
  const isVp9 = mimeType.toLowerCase().includes("vp9");
  // Edited exports contain small UI text and can be a second-generation
  // encode. Give them a higher per-pixel budget than camera footage so native
  // 1440p/4K exports do not turn a crisp captured screen into a soft image.
  const bitsPerPixel = isVp9 ? 0.19 : 0.22;
  return Math.round(
    Math.min(
      48_000_000,
      Math.max(8_000_000, safeWidth * safeHeight * safeFps * bitsPerPixel)
    )
  );
}

export function editedExportSupport() {
  if (typeof window === "undefined" || typeof document === "undefined") return { supported: false, reason: "Edited export requires a browser." };
  if (typeof MediaRecorder === "undefined") return { supported: false, reason: "This browser does not support MediaRecorder export." };
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return { supported: false, reason: "This browser cannot export a canvas stream." };
  if (!pickExportMime()) return { supported: false, reason: "This browser has no supported video encoder for edited exports." };
  return { supported: true as const };
}

export function pickExportMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "video/mp4";
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
}

function waitForEvent(target: EventTarget, eventName: string, signal?: AbortSignal, timeoutMs = EXPORT_TIMEOUT_MS) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let timeout = 0;
    const onEvent = () => finish();
    const onAbort = () => finish(abortError());
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onEvent);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    target.addEventListener(eventName, onEvent, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = window.setTimeout(() => finish(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
  });
}

function createExportVideo(src: string, muted: boolean) {
  const video = document.createElement("video") as ExportVideo;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  video.muted = muted;
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  video.src = src;
  document.body.appendChild(video);
  video.load();
  return video;
}

async function loadVideo(video: HTMLVideoElement, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    let timeout = 0;
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onLoaded = () => finish();
    const onError = () => finish(new Error("A video source could not be loaded. Check the R2 CORS configuration for this domain."));
    const onAbort = () => finish(abortError());
    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = window.setTimeout(() => finish(new Error("A video source took too long to load. Check the R2 CORS configuration for this domain.")), EXPORT_TIMEOUT_MS);
  });
}

async function seekVideo(video: HTMLVideoElement, timeSeconds: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  const duration = Number.isFinite(video.duration) ? video.duration : timeSeconds;
  const target = Math.max(0, Math.min(duration || timeSeconds, timeSeconds));
  if (Math.abs(video.currentTime - target) < 0.015 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const waiting = waitForEvent(video, "seeked", signal);
  video.currentTime = target;
  await waiting;
}

async function seekAll(videos: HTMLVideoElement[], timeSeconds: number, signal?: AbortSignal) {
  await Promise.all(videos.map((video) => seekVideo(video, timeSeconds, signal)));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawScreen(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, state: VideoEditState, width: number, height: number) {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const crop = state.crop;
  // The editor applies crop as an inset mask over the positioned screen. Do
  // the same here instead of re-containing the cropped pixels, which changed
  // their aspect ratio and made the export's screen/camera relationship drift
  // away from the preview.
  const rect = containRect(sourceWidth, sourceHeight, width, height, state.screen.x, state.screen.y, state.screen.scale);
  const clipX = rect.x + crop.left * rect.width;
  const clipY = rect.y + crop.top * rect.height;
  const clipWidth = Math.max(1, rect.width * (1 - crop.left - crop.right));
  const clipHeight = Math.max(1, rect.height * (1 - crop.top - crop.bottom));
  ctx.save();
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, state.screen.cornerRadius);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipWidth, clipHeight);
  ctx.clip();
  ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function cameraSourceRect(video: HTMLVideoElement) {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  const edge = Math.min(width, height);
  return { x: (width - edge) / 2, y: (height - edge) / 2, width: edge, height: edge };
}

function drawCamera(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, state: VideoEditState, width: number, height: number) {
  const camera = state.camera;
  if (!camera?.visible) return;
  const rect = cameraRect(width, height, camera.x, camera.y, camera.size);
  const source = cameraSourceRect(video);
  ctx.save();
  if (camera.shape === "circle") {
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, camera.shape === "rounded" ? rect.width * 0.2 : rect.width * 0.04);
  }
  ctx.clip();
  if (camera.mirror) {
    ctx.translate(rect.x * 2 + rect.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, source.x, source.y, source.width, source.height, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  ctx.save();
  ctx.lineWidth = cameraStrokeWidth(width, height, camera.strokeWidth ?? 3);
  ctx.strokeStyle = camera.strokeColor ?? "#ffffff";
  if (ctx.lineWidth <= 0) {
    ctx.restore();
    return;
  }
  if (camera.shape === "circle") {
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, camera.shape === "rounded" ? rect.width * 0.2 : rect.width * 0.04);
    ctx.stroke();
  }
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line || " ");
  }
  return lines.slice(0, 8);
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, overlay: VideoTextOverlay, width: number, height: number) {
  const fontSize = overlay.fontSize * (width / 1280);
  ctx.save();
  ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, overlay.text, width * 0.8);
  const lineHeight = fontSize * 1.18;
  const contentWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const paddingX = fontSize * 0.36;
  const paddingY = fontSize * 0.22;
  const boxWidth = Math.min(width * 0.86, contentWidth + paddingX * 2);
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const centerX = overlay.x * width;
  const centerY = overlay.y * height;
  if (overlay.background !== "transparent") {
    ctx.fillStyle = overlay.background;
    roundedRect(ctx, centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.18);
    ctx.fill();
  }
  ctx.fillStyle = overlay.color;
  lines.forEach((line, index) => ctx.fillText(line, centerX, centerY + (index - (lines.length - 1) / 2) * lineHeight));
  ctx.restore();
}

function drawComposition(ctx: CanvasRenderingContext2D, primary: HTMLVideoElement, screen: HTMLVideoElement | undefined, camera: HTMLVideoElement | undefined, state: VideoEditStateV2, zoomEffects: VideoZoomEffect[], sourceTimeMs: number, width: number, height: number, graphics: VideoGraphicSources, supplementalTextOverlays: readonly VideoTextOverlay[] = []) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  const zoom = activeZoomEffect(zoomEffects, sourceTimeMs);
  if (zoom) {
    ctx.translate(zoom.x * width, zoom.y * height);
    ctx.scale(zoom.scale, zoom.scale);
    ctx.translate(-zoom.x * width, -zoom.y * height);
  }
  drawScreen(ctx, screen ?? primary, state, width, height);
  ctx.restore();
  // Zoom is a screen-content effect. Keep the presenter anchored to the
  // output frame so their placement and size match the editor at all times.
  if (screen && camera) drawCamera(ctx, camera, state, width, height);
  for (const overlay of activeTextOverlays(state.textOverlays, sourceTimeMs)) drawTextOverlay(ctx, overlay, width, height);
  for (const overlay of activeTextOverlays(supplementalTextOverlays, sourceTimeMs)) drawTextOverlay(ctx, overlay, width, height);
  drawVideoOverlays(ctx, state, sourceTimeMs, width, height, graphics);
}

async function loadGraphicSources(
  urls: Readonly<Record<string, string | undefined>> | undefined,
  signal?: AbortSignal,
) {
  const images: HTMLImageElement[] = [];
  const sources: Record<string, CanvasImageSource> = {};
  await Promise.all(Object.entries(urls ?? {}).map(async ([assetId, url]) => {
    if (!url) return;
    throwIfAborted(signal);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    const ready = new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      image.onload = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
      image.onerror = () => { signal?.removeEventListener("abort", onAbort); reject(new Error("An imported graphic could not be loaded. Check storage CORS and try again.")); };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    image.src = url;
    await ready;
    images.push(image);
    sources[assetId] = image;
  }));
  return { images, sources };
}

function nextFrame(video: ExportVideo, callback: () => void) {
  // requestVideoFrameCallback stops scheduling when short WebM sources reach
  // their final frame, which can strand an export just before 100%. RAF keeps
  // the completion check moving even after the media element fires `ended`.
  void video;
  return { kind: "animation" as const, id: window.requestAnimationFrame(callback) };
}

function cancelFrame(video: ExportVideo, frame: { kind: "video" | "animation"; id: number } | null) {
  if (!frame) return;
  if (frame.kind === "video") video.cancelVideoFrameCallback?.(frame.id);
  else window.cancelAnimationFrame(frame.id);
}

function waitForRecorderEvent(recorder: MediaRecorder, event: "pause" | "resume", signal?: AbortSignal) {
  if ((event === "pause" && recorder.state === "paused") || (event === "resume" && recorder.state === "recording")) return Promise.resolve();
  return waitForEvent(recorder, event, signal);
}

export async function exportEditedWebm(options: EditedVideoExportOptions) {
  const support = editedExportSupport();
  if (!support.supported) throw new Error(support.reason);
  throwIfAborted(options.signal);
  const state = normalizeVideoEditState(
    options.editState,
    options.durationMs,
    !!options.screenSrc && !!options.cameraSrc,
  );
  const timeline = buildVideoTimelineMap(options.durationMs, state.cuts, state.trim);
  const ranges = buildKeptSourceRanges(
    options.durationMs,
    state.cuts,
    state.trim,
  );
  const totalMs = keptDurationMs(ranges);
  if (!ranges.length || totalMs < 100) throw new Error("The cuts remove the entire recording. Keep at least 0.1 seconds to export.");

  const fps = Math.max(15, Math.min(30, Math.round(options.fps ?? 30)));
  const separateLayersRequested = !!options.screenSrc || !!options.cameraSrc;
  if (separateLayersRequested && (!options.screenSrc || !options.cameraSrc)) {
    throw new Error("Edited webcam placement requires both the screen and webcam source files. Reopen the recording or download the original combined video.");
  }
  const primary = createExportVideo(options.primarySrc, false);
  const screen = options.screenSrc ? createExportVideo(options.screenSrc, true) : undefined;
  const camera = options.screenSrc && options.cameraSrc ? createExportVideo(options.cameraSrc, true) : undefined;
  const allVideos = [primary, screen, camera].filter((video): video is ExportVideo => !!video);
  let playbackVideos: ExportVideo[] = [primary];
  let audioContext: AudioContext | null = null;
  let audioGain: GainNode | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let activeFrame: { kind: "video" | "animation"; id: number } | null = null;
  let recorderStopped: Promise<Blob> | null = null;
  let graphicImages: HTMLImageElement[] = [];
  let graphics: VideoGraphicSources = {};
  try {
    await loadVideo(primary, options.signal);
    if (screen) {
      try {
        await Promise.all([screen, camera].filter((video): video is ExportVideo => !!video).map((video) => loadVideo(video, options.signal)));
        playbackVideos = [primary, screen, camera].filter((video): video is ExportVideo => !!video);
      } catch (caught) {
        throwIfAborted(options.signal);
        // Never silently swap in the baked composite after the owner requested
        // editable layers: doing that discards their webcam placement while
        // still producing a file that looks like a successful edited export.
        const detail = caught instanceof Error ? ` ${caught.message}` : "";
        throw new Error(`The separate screen and webcam sources could not both be loaded. Export stopped so your webcam edits would not be lost.${detail}`);
      }
    }
    const visualSource = screen ?? primary;
    const loadedGraphics = await loadGraphicSources(options.graphicUrls, options.signal);
    graphicImages = loadedGraphics.images;
    graphics = loadedGraphics.sources;
    const requestedDimensions = options.width !== undefined && options.height !== undefined
      ? resolveExportDimensions("native", options.width, options.height)
      : resolveExportDimensions(options.resolution ?? "native", visualSource.videoWidth, visualSource.videoHeight);
    const { width, height } = requestedDimensions;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const canvasStream = canvas.captureStream(fps);
    const outputVideoTrack = canvasStream.getVideoTracks()[0];
    if (outputVideoTrack) {
      try {
        outputVideoTrack.contentHint = "detail";
      } catch {
        // Advisory only; Firefox and older Chromium builds may ignore it.
      }
    }
    outputStream = canvasStream;
    try {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        audioContext = new AudioContextConstructor();
        const source = audioContext.createMediaElementSource(primary);
        audioGain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        source.connect(audioGain);
        audioGain.connect(destination);
        audioGain.gain.value = masterGainAt(state.audio, 0, timeline.durationMs);
        await audioContext.resume();
        const audioTrack = destination.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);
      }
    } catch {
      // Silent edited exports remain useful when a browser cannot expose the
      // source audio graph. The original download always retains mixed audio.
    }

    const mimeType = pickExportMime();
    recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: exportVideoBitrate(width, height, fps, mimeType),
      audioBitsPerSecond: 160_000,
    });
    const chunks: Blob[] = [];
    recorderStopped = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = (event) => reject((event as Event & { error?: Error }).error ?? new Error("The browser stopped the edited export."));
      recorder!.onstop = async () => {
        if (!chunks.length) return reject(new Error("The edited export produced no video data."));
        const actualMimeType = recorder?.mimeType || mimeType;
        const raw = new Blob(chunks, { type: actualMimeType });
        if (!actualMimeType.toLowerCase().startsWith("video/webm")) {
          resolve(raw);
          return;
        }
        try { resolve(await fixWebmDuration(raw, totalMs, { logger: false })); }
        catch { resolve(raw); }
      };
    });

    let renderedBeforeRange = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      throwIfAborted(options.signal);
      const range = ranges[index];
      playbackVideos.forEach((video) => video.pause());
      if (index > 0 && recorder.state === "recording") {
        recorder.pause();
        await waitForRecorderEvent(recorder, "pause", options.signal);
      }
      await seekAll(playbackVideos, range.startMs / 1000, options.signal);
      drawComposition(ctx, primary, screen, camera, state, options.zoomEffects, range.startMs, width, height, graphics, options.supplementalTextOverlays);
      if (index === 0) recorder.start(1_000);
      else if (recorder.state === "paused") {
        recorder.resume();
        await waitForRecorderEvent(recorder, "resume", options.signal);
      }
      await Promise.all(playbackVideos.map((video) => video.play()));

      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          try {
            throwIfAborted(options.signal);
            const sourceTimeMs = primary.currentTime * 1000;
            for (const layer of [screen, camera]) {
              if (layer && Math.abs(layer.currentTime - primary.currentTime) > 0.14) layer.currentTime = primary.currentTime;
            }
            const withinRange = Math.max(0, Math.min(range.endMs - range.startMs, sourceTimeMs - range.startMs));
            const renderedMs = renderedBeforeRange + withinRange;
            if (audioGain && audioContext) {
              audioGain.gain.setValueAtTime(masterGainAt(state.audio, renderedMs, timeline.durationMs), audioContext.currentTime);
            }
            drawComposition(ctx, primary, screen, camera, state, options.zoomEffects, sourceTimeMs, width, height, graphics, options.supplementalTextOverlays);
            options.onProgress?.({ progress: Math.min(1, (renderedBeforeRange + withinRange) / totalMs), sourceTimeMs, renderedMs: renderedBeforeRange + withinRange, totalMs });
            if (sourceTimeMs >= range.endMs - 17 || primary.ended) {
              playbackVideos.forEach((video) => video.pause());
              resolve();
              return;
            }
            activeFrame = nextFrame(primary, tick);
          } catch (caught) {
            reject(caught);
          }
        };
        activeFrame = nextFrame(primary, tick);
      });
      cancelFrame(primary, activeFrame);
      activeFrame = null;
      renderedBeforeRange += range.endMs - range.startMs;
    }

    options.onProgress?.({ progress: 1, sourceTimeMs: ranges.at(-1)!.endMs, renderedMs: totalMs, totalMs });
    playbackVideos.forEach((video) => video.pause());
    recorder.stop();
    return await recorderStopped;
  } catch (caught) {
    cancelFrame(primary, activeFrame);
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* already stopped */ }
    }
    await recorderStopped?.catch(() => undefined);
    if (caught instanceof DOMException && caught.name === "SecurityError") {
      throw new Error("Edited export could not read the video pixels. Run npm run r2:cors for this application domain.");
    }
    throw caught;
  } finally {
    cancelFrame(primary, activeFrame);
    allVideos.forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    });
    outputStream?.getTracks().forEach((track) => track.stop());
    graphicImages.forEach((image) => { image.removeAttribute("src"); });
    await audioContext?.close().catch(() => {});
  }
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadUrl(url: string, filename: string, signal?: AbortSignal) {
  throwIfAborted(signal);

  // Local/test-mode media already lives in a Blob owned by this page. Fetching
  // its object URL is unnecessary, doubles memory use for large recordings,
  // and is blocked by the hardened demo CSP (`connect-src` intentionally does
  // not include blob:). A direct anchor download keeps the file local and
  // works under the same policy that already permits blob: media playback.
  if (url.startsWith("blob:")) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  let response: Response;
  try {
    // R2 omits CORS headers on 304 responses, so a revalidated request fails the
    // browser CORS check even though the object is readable. Bypass the HTTP cache
    // entirely for this one-shot download.
    response = await fetch(url, { signal, cache: "no-store" });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    throw new Error("The source file could not be read. Check the storage CORS configuration for this application domain.");
  }
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  triggerBlobDownload(await response.blob(), filename);
}

export function createVideoProjectManifest(input: VideoProjectManifestInput) {
  const base = safeVideoFilename(input.title);
  return {
    schema: "videoflow.project",
    version: 1,
    video: { title: input.title.slice(0, 200), mode: input.mode, durationMs: input.durationMs },
    assets: {
      original: `${base}-original.${videoFileExtension(input.sourceMimeType)}`,
      screen: input.hasScreenLayer ? `${base}-screen.${videoFileExtension(input.sourceMimeType)}` : undefined,
      camera: input.hasCameraLayer ? `${base}-camera.${videoFileExtension(input.sourceMimeType)}` : undefined,
    },
    edits: { editState: input.editState, zoomEffects: input.zoomEffects },
  };
}

export function downloadProjectManifest(input: VideoProjectManifestInput) {
  const filename = `${safeVideoFilename(input.title)}.videoflow.json`;
  const blob = new Blob([JSON.stringify(createVideoProjectManifest(input), null, 2)], { type: "application/json" });
  triggerBlobDownload(blob, filename);
}
