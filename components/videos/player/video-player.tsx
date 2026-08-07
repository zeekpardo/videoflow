"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Loader2,
  Gauge,
  RotateCcw,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeCut,
  activeTextOverlays,
  activeZoomEffect,
  buildVideoTimelineMap,
  editedTimeToSourceMs,
  nextRemovedBoundary,
  normalizeVideoEditState,
  snapSourceTimeToKeptMs,
  sourceTimeToEditedMs,
  type VideoEditState,
  type VideoZoomEffect,
} from "@/lib/video-edits";
import { DEFAULT_MASTER_AUDIO, masterGainAt } from "@/lib/video-audio";
import { cameraFrameWidthFraction } from "@/lib/video-layout";
import type { VideoCaptionTrack } from "@/lib/video-v2";
import { VideoOverlayLayer } from "@/components/videos/player/video-overlay-layer";
import {
  layerNeedsHardSync,
  synchronizedLayerPlaybackRate,
} from "@/lib/video-playback-sync";

interface VideoPlayerProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
  poster?: string;
  wrapperClassName?: string;
  accent?: string;
  zoomEffects?: VideoZoomEffect[];
  editState?: VideoEditState;
  captionTrack?: VideoCaptionTrack | null;
  screenSrc?: string;
  cameraSrc?: string;
  zoomEditActive?: boolean;
  onZoomPoint?: (point: { x: number; y: number }) => void;
  cameraEditActive?: boolean;
  onCameraMove?: (point: { x: number; y: number }) => void;
  onCameraMoveEnd?: (point: { x: number; y: number }) => void;
  graphicUrls?: Readonly<Record<string, string | undefined>>;
  selectedObjectId?: string;
  objectEditActive?: boolean;
  onSelectObject?: (id: string) => void;
  onObjectMove?: (id: string, point: { x: number; y: number }) => void;
  onObjectMoveEnd?: (id: string, point: { x: number; y: number }) => void;
  interactionPlacementActive?: boolean;
  onInteractionPoint?: (point: { x: number; y: number }) => void;
  showLayerStatus?: boolean;
  onLayerStatusChange?: (status: VideoLayerStatus) => void;
  keyboardShortcuts?: boolean;
}

export type VideoLayerLoadState = "missing" | "loading" | "ready" | "error";

export interface VideoLayerStatus {
  screen: VideoLayerLoadState;
  camera: VideoLayerLoadState;
  editable: boolean;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Custom, fully-styled player. Forwards a ref to the underlying <video> so
// callers can seek (transcript clicks) and read progress; parent event props
// (onTimeUpdate/onPause/onEnded) still fire via the spread.
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      poster,
      wrapperClassName,
      className,
      accent = "#6d5bfc",
      zoomEffects,
      editState,
      captionTrack,
      screenSrc,
      cameraSrc,
      zoomEditActive = false,
      onZoomPoint,
      cameraEditActive = false,
      onCameraMove,
      onCameraMoveEnd,
      graphicUrls,
      selectedObjectId,
      objectEditActive = false,
      onSelectObject,
      onObjectMove,
      onObjectMoveEnd,
      interactionPlacementActive = false,
      onInteractionPoint,
      showLayerStatus = false,
      onLayerStatusChange,
      keyboardShortcuts = true,
      style,
      ...props
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const screenRef = useRef<HTMLVideoElement | null>(null);
    const cameraRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragging = useRef(false);
    const editStateRef = useRef(editState);
    const enforcePlaybackRef = useRef<() => void>(() => {});
    const applyMasterAudioRef = useRef<() => void>(() => {});
    const monitorVolumeRef = useRef(1);
    const monitorMutedRef = useRef(false);
    const trimEndedRef = useRef(false);
    // True while we coerce the real duration out of a header-less webm (below).
    const fixingDuration = useRef(false);

    const [playing, setPlaying] = useState(false);
    const [started, setStarted] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [ended, setEnded] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [rate, setRate] = useState(1);
    const [frameAspect, setFrameAspect] = useState(16 / 9);
    const initialLayerStatus: VideoLayerStatus = {
      screen: screenSrc ? "loading" : "missing",
      camera: cameraSrc ? "loading" : "missing",
      editable: false,
    };
    const [layerStatus, setLayerStatus] = useState<VideoLayerStatus>(initialLayerStatus);
    const layerStatusRef = useRef(initialLayerStatus);

    useEffect(() => {
      editStateRef.current = editState;
      enforcePlaybackRef.current();
      applyMasterAudioRef.current();
    }, [editState]);

    const updateLayerStatus = useCallback((layer: "screen" | "camera", value: VideoLayerLoadState) => {
      const current = layerStatusRef.current;
      if (current[layer] === value) return;
      const nextBase = { ...current, [layer]: value };
      const cameraRequired = !!editState?.camera;
      const editable = nextBase.screen === "ready" && (!cameraRequired || nextBase.camera === "ready");
      const next = { ...nextBase, editable };
      layerStatusRef.current = next;
      setLayerStatus(next);
      onLayerStatusChange?.(next);
    }, [editState?.camera, onLayerStatusChange]);

    const setRefs = useCallback(
      (node: HTMLVideoElement | null) => {
        videoRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref)
          (ref as React.MutableRefObject<HTMLVideoElement | null>).current = node;
      },
      [ref]
    );

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      // MediaRecorder webm files carry no duration in their header, so the
      // browser reports `Infinity` and treats the file like a live stream: the
      // total time shows 0:00 and the seek bar/scrubbing never work. Forcing a
      // seek past the end makes the browser compute the real duration, then we
      // snap back to 0. (The first `timeupdate` after the seek is what reliably
      // fires once the true end — and thus duration — is known.)
      const onFixSeek = () => {
        v.removeEventListener("timeupdate", onFixSeek);
        fixingDuration.current = false;
        setDuration(isFinite(v.duration) ? v.duration : 0);
        v.currentTime = 0;
      };
      const onMeta = () => {
        if (v.videoWidth > 0 && v.videoHeight > 0) setFrameAspect(v.videoWidth / v.videoHeight);
        if (v.duration === Infinity || isNaN(v.duration)) {
          fixingDuration.current = true;
          v.addEventListener("timeupdate", onFixSeek);
          v.currentTime = 1e101;
          return;
        }
        setDuration(v.duration || 0);
      };
      const syncLayer = (layer: HTMLVideoElement | null, force = false) => {
        if (!layer) return;
        const driftSeconds = layer.currentTime - v.currentTime;
        if (layerNeedsHardSync(driftSeconds, force)) {
          try { layer.currentTime = v.currentTime; } catch { /* metadata is not ready yet */ }
          layer.playbackRate = v.playbackRate;
          return;
        }
        layer.playbackRate = synchronizedLayerPlaybackRate(v.playbackRate, driftSeconds);
      };
      const syncLayers = (force = false) => {
        syncLayer(screenRef.current, force);
        syncLayer(cameraRef.current, force);
      };
      const timeline = () => {
        const state = editStateRef.current;
        const sourceDurationMs = Number.isFinite(v.duration) && v.duration > 0
          ? v.duration * 1_000
          : Math.max(0, state && "trim" in state ? state.trim.endMs : 0);
        return buildVideoTimelineMap(sourceDurationMs, state?.cuts, state && "trim" in state ? state.trim : undefined);
      };
      const applyMasterAudio = () => {
        if (fixingDuration.current) return;
        const state = editStateRef.current;
        const map = timeline();
        const audio = state && "audio" in state ? state.audio : DEFAULT_MASTER_AUDIO;
        const editedMs = sourceTimeToEditedMs(v.currentTime * 1_000, map);
        const gain = masterGainAt(audio, editedMs, map.durationMs);
        const nextVolume = Math.min(1, Math.max(0, monitorVolumeRef.current * gain));
        if (Math.abs(v.volume - nextVolume) > 0.002) v.volume = nextVolume;
        v.muted = monitorMutedRef.current || gain <= 0.0001;
      };
      applyMasterAudioRef.current = applyMasterAudio;
      const finishTrimmedPlayback = (endMs: number) => {
        if (trimEndedRef.current) return;
        trimEndedRef.current = true;
        v.currentTime = Math.min(v.duration || endMs / 1_000, endMs / 1_000);
        v.pause();
        setCurrent(endMs / 1_000);
        setPlaying(false);
        setEnded(true);
        setShowControls(true);
        pauseLayers();
        // A trim-out before the media file's physical end does not emit a
        // native ended event. Dispatch one so analytics and host callbacks see
        // the final edited video complete in exactly the same way.
        v.dispatchEvent(new Event("ended"));
      };
      const enforcePlayableTime = () => {
        if (fixingDuration.current) return false;
        const map = timeline();
        if (!map.ranges.length) return false;
        const sourceMs = v.currentTime * 1_000;
        if (sourceMs >= map.trim.endMs - 0.5) {
          if (!v.paused || sourceMs > map.trim.endMs + 0.5) finishTrimmedPlayback(map.trim.endMs);
          return true;
        }
        const nextMs = snapSourceTimeToKeptMs(sourceMs, map, "forward");
        if (Math.abs(nextMs - sourceMs) > 0.5) {
          v.currentTime = nextMs / 1_000;
          syncLayers(true);
          setCurrent(nextMs / 1_000);
          return true;
        }
        return false;
      };
      enforcePlaybackRef.current = enforcePlayableTime;
      const playLayers = () => {
        syncLayers(true);
        screenRef.current?.play().catch(() => {});
        cameraRef.current?.play().catch(() => {});
      };
      const pauseLayers = () => {
        screenRef.current?.pause();
        cameraRef.current?.pause();
      };
      const onTime = () => {
        // Ignore the synthetic timeupdates emitted while we coerce duration.
        if (fixingDuration.current) return;
        if (enforcePlayableTime()) return;
        syncLayers();
        setCurrent(v.currentTime);
        applyMasterAudio();
      };
      const onProg = () => {
        try {
          if (v.buffered.length)
            setBuffered(v.buffered.end(v.buffered.length - 1));
        } catch {
          /* noop */
        }
      };
      const onPlay = () => {
        trimEndedRef.current = false;
        const adjusted = enforcePlayableTime();
        if (trimEndedRef.current) return;
        setPlaying(true);
        setStarted(true);
        setEnded(false);
        playLayers();
        if (adjusted && v.paused) queueMicrotask(() => v.play().catch(() => {}));
      };
      const onPause = () => {
        setPlaying(false);
        pauseLayers();
      };
      const onEnded = () => {
        setPlaying(false);
        setEnded(true);
        setShowControls(true);
        pauseLayers();
      };
      const onWaiting = () => setWaiting(true);
      const onPlaying = () => setWaiting(false);
      const onSeeking = () => syncLayers(true);
      const onSeeked = () => { syncLayers(true); enforcePlayableTime(); };
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("timeupdate", onTime);
      v.addEventListener("progress", onProg);
      v.addEventListener("play", onPlay);
      v.addEventListener("pause", onPause);
      v.addEventListener("ended", onEnded);
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("playing", onPlaying);
      v.addEventListener("seeking", onSeeking);
      v.addEventListener("seeked", onSeeked);
      if (v.readyState >= HTMLMediaElement.HAVE_METADATA) onMeta();
      return () => {
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeEventListener("timeupdate", onTime);
        v.removeEventListener("timeupdate", onFixSeek);
        v.removeEventListener("progress", onProg);
        v.removeEventListener("play", onPlay);
        v.removeEventListener("pause", onPause);
        v.removeEventListener("ended", onEnded);
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("playing", onPlaying);
        v.removeEventListener("seeking", onSeeking);
        v.removeEventListener("seeked", onSeeked);
        enforcePlaybackRef.current = () => {};
        applyMasterAudioRef.current = () => {};
      };
    }, [src, screenSrc, cameraSrc]);

    useEffect(() => {
      const video = videoRef.current as (HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      }) | null;
      if (!video || !playing || !duration) return;
      let canceled = false;
      let frameId = 0;
      let animationId = 0;
      let previousSourceMs = video.currentTime * 1_000;

      const schedule = () => {
        if (canceled) return;
        if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback((_now, metadata) => tick(metadata.mediaTime * 1_000));
        else animationId = window.requestAnimationFrame(() => tick(video.currentTime * 1_000));
      };
      const tick = (sourceMs: number) => {
        if (canceled || video.paused) return;
        const state = editStateRef.current;
        const map = buildVideoTimelineMap(duration * 1_000, state?.cuts, state && "trim" in state ? state.trim : undefined);
        const boundary = nextRemovedBoundary(previousSourceMs, map);
        if (boundary && previousSourceMs < boundary.startMs && sourceMs >= boundary.startMs) {
          if (boundary.terminal) {
            video.currentTime = boundary.endMs / 1_000;
            video.pause();
            if (!trimEndedRef.current) {
              trimEndedRef.current = true;
              setCurrent(boundary.endMs / 1_000);
              setPlaying(false);
              setEnded(true);
              setShowControls(true);
              video.dispatchEvent(new Event("ended"));
            }
            return;
          }
          video.currentTime = boundary.endMs / 1_000;
          previousSourceMs = boundary.endMs;
          schedule();
          return;
        }
        enforcePlaybackRef.current();
        applyMasterAudioRef.current();
        previousSourceMs = video.currentTime * 1_000;
        schedule();
      };
      schedule();
      return () => {
        canceled = true;
        if (frameId) video.cancelVideoFrameCallback?.(frameId);
        if (animationId) window.cancelAnimationFrame(animationId);
      };
    }, [duration, playing, editState]);

    useEffect(() => {
      const onFs = () =>
        setFullscreen(document.fullscreenElement === containerRef.current);
      document.addEventListener("fullscreenchange", onFs);
      return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    const togglePlay = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused || v.ended) {
        // `play()` does not consistently rewind an ended MediaRecorder WebM
        // across browsers. Rewind explicitly so Replay and the focused
        // Space/K shortcut cannot appear to do nothing at the final frame.
        const state = editStateRef.current;
        const sourceDurationMs = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1_000 : 0;
        const map = buildVideoTimelineMap(sourceDurationMs, state?.cuts, state && "trim" in state ? state.trim : undefined);
        if (trimEndedRef.current || v.ended || (map.trim.endMs > 0 && v.currentTime * 1_000 >= map.trim.endMs - 50)) {
          const startMs = map.ranges[0]?.startMs ?? map.trim.startMs;
          trimEndedRef.current = false;
          v.currentTime = startMs / 1_000;
          setCurrent(startMs / 1_000);
        }
        enforcePlaybackRef.current();
        if (!trimEndedRef.current) v.play().catch(() => {});
      }
      else v.pause();
    }, []);

    const seekFraction = useCallback(
      (f: number) => {
        const v = videoRef.current;
        if (!v || !duration) return;
        const state = editStateRef.current;
        const map = buildVideoTimelineMap(duration * 1_000, state?.cuts, state && "trim" in state ? state.trim : undefined);
        const next = editedTimeToSourceMs(Math.max(0, Math.min(1, f)) * map.durationMs, map, "forward") / 1_000;
        // Update the visual thumb immediately instead of waiting for the
        // browser's low-frequency `timeupdate` event after every seek.
        setCurrent(next);
        v.currentTime = next;
      },
      [duration]
    );

    const fracFromX = (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return (clientX - r.left) / r.width;
    };

    const onTrackDown = (e: React.PointerEvent) => {
      dragging.current = true;
      seekFraction(fracFromX(e.clientX));
      let latestClientX = e.clientX;
      let animationFrame = 0;
      const apply = () => {
        animationFrame = 0;
        if (dragging.current) seekFraction(fracFromX(latestClientX));
      };
      const move = (ev: PointerEvent) => {
        latestClientX = ev.clientX;
        if (dragging.current && !animationFrame) animationFrame = window.requestAnimationFrame(apply);
      };
      const finish = (ev?: PointerEvent) => {
        if (ev) latestClientX = ev.clientX;
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        if (dragging.current) seekFraction(fracFromX(latestClientX));
        dragging.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
      };
      const cancel = () => finish();
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
    };

    const poke = useCallback(() => {
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (videoRef.current && !videoRef.current.paused) setShowControls(false);
      }, 2600);
    }, []);

    const toggleMute = () => {
      monitorMutedRef.current = !monitorMutedRef.current;
      setMuted(monitorMutedRef.current);
      applyMasterAudioRef.current();
    };
    const changeVolume = (val: number) => {
      const next = Math.min(1, Math.max(0, val));
      monitorVolumeRef.current = next;
      monitorMutedRef.current = next === 0;
      setVolume(next);
      setMuted(next === 0);
      applyMasterAudioRef.current();
    };
    const toggleFullscreen = () => {
      const c = containerRef.current;
      if (!c) return;
      if (document.fullscreenElement === c) document.exitFullscreen();
      else c.requestFullscreen?.();
    };
    const applyRate = (r: number) => {
      const v = videoRef.current;
      if (v) v.playbackRate = r;
      if (screenRef.current) screenRef.current.playbackRate = r;
      if (cameraRef.current) cameraRef.current.playbackRate = r;
      setRate(r);
      setSpeedOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
      if (!keyboardShortcuts) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case "ArrowRight":
          v.currentTime = Math.min(duration, v.currentTime + 5);
          break;
        case "ArrowUp":
          changeVolume(Math.min(1, monitorVolumeRef.current + 0.1));
          break;
        case "ArrowDown":
          changeVolume(Math.max(0, monitorVolumeRef.current - 0.1));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
    };

    const currentState = editStateRef.current;
    const playbackTimeline = buildVideoTimelineMap(duration * 1_000, currentState?.cuts, currentState && "trim" in currentState ? currentState.trim : undefined);
    const editedCurrentSeconds = sourceTimeToEditedMs(current * 1_000, playbackTimeline) / 1_000;
    const editedDurationSeconds = playbackTimeline.durationMs / 1_000;
    const pct = editedDurationSeconds ? (editedCurrentSeconds / editedDurationSeconds) * 100 : 0;
    const bufPct = editedDurationSeconds ? (sourceTimeToEditedMs(buffered * 1_000, playbackTimeline) / 1_000 / editedDurationSeconds) * 100 : 0;
    const controlsVisible = showControls || !playing || ended;
    const activeZoom = activeZoomEffect(zoomEffects, current * 1000);
    const currentCut = activeCut(editState?.cuts, current * 1000);
    const textOverlays = currentCut ? [] : activeTextOverlays(editState?.textOverlays, current * 1000);
    const activeCaption = currentCut ? undefined : captionTrack?.cues.find((cue) => current * 1_000 >= cue.startMs && current * 1_000 < cue.endMs);
    const screen = editState?.screen ?? { x: 0.5, y: 0.5, scale: 1, cornerRadius: 0 };
    const crop = editState?.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const camera = editState?.camera;
    const normalizedEditState = normalizeVideoEditState(
      editState,
      Math.max(duration * 1_000, editState && "trim" in editState ? editState.trim.endMs : 0),
      !!screenSrc && !!cameraSrc,
    );
    const cameraLayerRequired = !!editState?.camera;
    const hasCompleteLayerSources = !!screenSrc && (!cameraLayerRequired || !!cameraSrc);
    const hasSeparateScreen = hasCompleteLayerSources && layerStatus.editable;
    const screenTransform = `translate(${(screen.x - 0.5) * 100}%, ${(screen.y - 0.5) * 100}%) scale(${screen.scale})`;
    const zoomTransform = activeZoom ? `scale(${activeZoom.scale})` : "scale(1)";
    const visualTransform = hasSeparateScreen ? screenTransform : `${zoomTransform} ${screenTransform}`;
    const layerFallback = !!screenSrc && (
      layerStatus.screen === "error" ||
      (cameraLayerRequired && (!cameraSrc || layerStatus.camera === "error"))
    );
    const cameraWidthPercent = camera ? cameraFrameWidthFraction(frameAspect, camera.size) * 100 : 0;
    const markLayerReady = (layer: "screen" | "camera", video: HTMLVideoElement) => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      if (layer === "screen") setFrameAspect(video.videoWidth / video.videoHeight);
      if (videoRef.current) {
        const primaryTime = videoRef.current.currentTime;
        if (Number.isFinite(primaryTime)) {
          try { video.currentTime = primaryTime; } catch { /* source metadata can settle first */ }
        }
      }
      updateLayerStatus(layer, "ready");
    };

    const dragCamera = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!cameraEditActive || !onCameraMove) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      let latest = {
        x: Math.min(0.96, Math.max(0.04, (event.clientX - rect.left) / rect.width)),
        y: Math.min(0.96, Math.max(0.04, (event.clientY - rect.top) / rect.height)),
      };
      const move = (clientX: number, clientY: number) => {
        latest = {
          x: Math.min(0.96, Math.max(0.04, (clientX - rect.left) / rect.width)),
          y: Math.min(0.96, Math.max(0.04, (clientY - rect.top) / rect.height)),
        };
        onCameraMove(latest);
      };
      move(event.clientX, event.clientY);
      const onMove = (pointer: PointerEvent) => move(pointer.clientX, pointer.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        onCameraMoveEnd?.(latest);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    return (
      <div
        ref={containerRef}
        className={cn(
          "group relative aspect-video w-full select-none overflow-hidden rounded-2xl bg-black outline-none",
          wrapperClassName
        )}
        onMouseMove={poke}
        onMouseLeave={() => playing && !ended && setShowControls(false)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        style={{ ["--accent" as string]: accent, aspectRatio: frameAspect }}
      >
        <video
          ref={setRefs}
          data-video-layer="primary"
          data-layer-active={hasSeparateScreen ? "false" : "true"}
          src={src}
          poster={poster}
          playsInline
          className={cn("absolute inset-0 h-full w-full object-contain", hasSeparateScreen && "opacity-0", className)}
          style={{
            ...style,
            transformOrigin: activeZoom ? `${activeZoom.x * 100}% ${activeZoom.y * 100}%` : "50% 50%",
            transform: visualTransform,
            clipPath: `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`,
            borderRadius: `${screen.cornerRadius}px`,
            transition: "transform 260ms cubic-bezier(.22,.8,.28,1), transform-origin 180ms ease, clip-path 180ms ease",
          }}
          {...props}
          onClick={togglePlay}
        />

        {screenSrc && (
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{
              opacity: hasSeparateScreen ? 1 : 0,
              transformOrigin: activeZoom ? `${activeZoom.x * 100}% ${activeZoom.y * 100}%` : "50% 50%",
              transform: zoomTransform,
              transition: "opacity 120ms ease, transform 260ms cubic-bezier(.22,.8,.28,1), transform-origin 180ms ease",
            }}
          >
            <video
              ref={screenRef}
              data-video-layer="screen"
              data-layer-active={hasSeparateScreen ? "true" : "false"}
              src={screenSrc}
              muted
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                transform: screenTransform,
                clipPath: `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`,
                borderRadius: `${screen.cornerRadius}px`,
                transition: "transform 180ms ease, clip-path 180ms ease",
              }}
              onLoadedMetadata={(event) => markLayerReady("screen", event.currentTarget)}
              onLoadedData={(event) => markLayerReady("screen", event.currentTarget)}
              onCanPlay={(event) => markLayerReady("screen", event.currentTarget)}
              onError={() => updateLayerStatus("screen", "error")}
            />
          </div>
        )}

        {screenSrc && cameraSrc && camera && (
          <div
            className={cn(
              "absolute z-10 aspect-square overflow-hidden border-solid shadow-[0_12px_32px_rgba(0,0,0,.35)]",
              cameraEditActive && "pointer-events-auto cursor-move ring-2 ring-primary ring-offset-2 ring-offset-transparent"
            )}
            style={{
              left: `${camera.x * 100}%`,
              top: `${camera.y * 100}%`,
              width: `${cameraWidthPercent}%`,
              opacity: hasSeparateScreen && layerStatus.camera === "ready" ? (camera.visible ? 1 : cameraEditActive ? 0.35 : 0) : 0,
              transform: "translate(-50%, -50%)",
              borderRadius: camera.shape === "circle" ? "9999px" : camera.shape === "rounded" ? "20%" : "4%",
              borderWidth: `${camera.strokeWidth ?? 3}px`,
              borderColor: camera.strokeColor ?? "#ffffff",
            }}
            onPointerDown={dragCamera}
          >
            <video
              ref={cameraRef}
              data-video-layer="camera"
              data-layer-active={hasSeparateScreen && layerStatus.camera === "ready" && (camera.visible || cameraEditActive) ? "true" : "false"}
              src={cameraSrc}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-cover"
              style={{ transform: camera.mirror ? "scaleX(-1)" : undefined }}
              onLoadedMetadata={(event) => markLayerReady("camera", event.currentTarget)}
              onLoadedData={(event) => markLayerReady("camera", event.currentTarget)}
              onCanPlay={(event) => markLayerReady("camera", event.currentTarget)}
              onError={() => updateLayerStatus("camera", "error")}
            />
          </div>
        )}

        {showLayerStatus && layerFallback && (
          <div className="pointer-events-none absolute left-3 top-3 z-[14] rounded-lg border border-amber-300/50 bg-amber-950/85 px-3 py-2 text-[11px] font-semibold text-amber-100 shadow-lg backdrop-blur" role="status">
            Separate layers unavailable · showing combined recording
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden">
          {textOverlays.map((overlay) => (
            <span
              key={overlay.id}
              className="absolute max-w-[82%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap rounded-lg px-3 py-1.5 text-center font-semibold leading-tight shadow-sm"
              style={{ left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, fontSize: `${overlay.fontSize}px`, color: overlay.color, background: overlay.background }}
            >
              {overlay.text}
            </span>
          ))}
        </div>

        {activeCaption && captionTrack && (
          <div
            data-video-caption
            className="pointer-events-none absolute inset-x-[8%] z-[13] flex justify-center"
            style={{
              top: captionTrack.style.position === "top" ? "10%" : captionTrack.style.position === "middle" ? "50%" : undefined,
              bottom: captionTrack.style.position === "bottom" ? "12%" : undefined,
              transform: captionTrack.style.position === "middle" ? "translateY(-50%)" : undefined,
            }}
          >
            <span
              className={cn(
                "max-w-full whitespace-pre-wrap px-3 py-1.5 text-center font-bold leading-tight shadow-sm",
                captionTrack.style.preset === "lower_third" ? "rounded-md text-left" : "rounded-lg",
                captionTrack.style.preset === "pop" && "uppercase tracking-wide",
              )}
              style={{
                color: captionTrack.style.textColor,
                background: captionTrack.style.backgroundColor,
                fontSize: `clamp(14px, ${2.3 * captionTrack.style.fontScale}vw, ${42 * captionTrack.style.fontScale}px)`,
              }}
            >
              {captionTrack.style.preset === "karaoke" && activeCaption.words?.length
                ? activeCaption.words.map((word, index) => (
                    <span key={`${activeCaption.id}-${index}`} style={{ color: current * 1_000 >= word.startMs ? captionTrack.style.highlightColor : captionTrack.style.textColor }}>
                      {index ? " " : ""}{word.text}
                    </span>
                  ))
                : activeCaption.text}
            </span>
          </div>
        )}

        {!currentCut && (
          <VideoOverlayLayer
            editState={normalizedEditState}
            sourceTimeMs={current * 1_000}
            graphicUrls={graphicUrls}
            selectedObjectId={selectedObjectId}
            objectEditActive={objectEditActive}
            onSelectObject={onSelectObject}
            onObjectMove={onObjectMove}
            onObjectMoveEnd={onObjectMoveEnd}
          />
        )}

        {zoomEditActive && (
          <button
            type="button"
            aria-label="Choose zoom focus"
            className="absolute inset-0 z-20 cursor-crosshair bg-primary/10"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onZoomPoint?.({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
            }}
          >
            <span className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              <ScanSearch className="h-3.5 w-3.5" /> Click the point to zoom into
            </span>
          </button>
        )}

        {interactionPlacementActive && !zoomEditActive && (
          <button
            type="button"
            aria-label="Choose click marker position"
            className="absolute inset-0 z-20 cursor-crosshair bg-sky-400/10"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onInteractionPoint?.({
                x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
              });
            }}
          >
            <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Click where the pointer pulse should appear
            </span>
          </button>
        )}

        {/* Buffering spinner */}
        {waiting && started && !ended && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader2 className="h-10 w-10 animate-spin text-white/80" />
          </div>
        )}

        {/* Center play / replay */}
        {(!started || ended || !playing) && !waiting && (
          <button
            onClick={togglePlay}
            aria-label={ended ? "Replay" : "Play"}
            className="absolute inset-0 grid place-items-center"
          >
            <span
              className="grid h-20 w-20 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-transform duration-200 hover:scale-105"
              style={{
                boxShadow: `0 0 0 1px rgba(255,255,255,.18), 0 8px 40px -8px ${accent}`,
              }}
            >
              {ended ? (
                <RotateCcw className="h-8 w-8" />
              ) : (
                <Play className="ml-1 h-9 w-9 fill-current" />
              )}
            </span>
          </button>
        )}

        {/* Controls */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-12 transition-opacity duration-300",
            "bg-gradient-to-t from-black/80 via-black/30 to-transparent",
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          {/* Seek bar */}
          <div
            ref={trackRef}
            onPointerDown={onTrackDown}
            className="group/seek relative mb-2 cursor-pointer py-2"
          >
            <div className="relative h-1 w-full rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                style={{ width: `${bufPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${pct}%`, backgroundColor: accent }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/seek:opacity-100"
                style={{ left: `${pct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-white">
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </button>

            {/* Volume */}
            <div className="flex items-center">
              <button onClick={toggleMute} aria-label="Mute">
                {muted || volume === 0 || normalizedEditState.audio.muted ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted || normalizedEditState.audio.muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                className="ml-1 h-1 w-0 cursor-pointer opacity-0 transition-all duration-200 group-hover:w-16 group-hover:opacity-100"
                style={{ accentColor: "#fff" }}
              />
            </div>

            <span className="font-mono text-xs tabular-nums text-white/85">
              {fmt(editedCurrentSeconds)} <span className="text-white/40">/</span> {fmt(editedDurationSeconds)}
            </span>

            <div className="flex-1" />

            {/* Speed */}
            <div className="relative">
              <button
                onClick={() => setSpeedOpen((o) => !o)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-white/10"
                aria-label="Playback speed"
              >
                <Gauge className="h-4 w-4" />
                {rate}×
              </button>
              {speedOpen && (
                <div className="absolute bottom-9 right-0 overflow-hidden rounded-lg bg-black/90 p-1 ring-1 ring-white/10 backdrop-blur">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => applyRate(s)}
                      className={cn(
                        "block w-full rounded px-3 py-1 text-left text-xs hover:bg-white/10",
                        s === rate && "text-[var(--accent)]"
                      )}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={toggleFullscreen} aria-label="Fullscreen">
              {fullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
