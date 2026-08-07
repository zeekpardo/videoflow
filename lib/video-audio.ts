export interface MasterAudioSettings {
  muted: boolean;
  /** Linear master gain. v1 intentionally limits output to unity gain. */
  gain: number;
  /** Fade lengths apply to the final edited timeline, not source time. */
  fadeInMs: number;
  fadeOutMs: number;
}

export const DEFAULT_MASTER_AUDIO: MasterAudioSettings = {
  muted: false,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMasterAudio(
  value: Partial<MasterAudioSettings> | null | undefined,
  editedDurationMs: number,
): MasterAudioSettings {
  const duration = Math.max(0, finite(editedDurationMs, 0));
  const maxFade = Math.min(10_000, duration);
  return {
    muted: value?.muted === true,
    gain: clamp(finite(value?.gain, DEFAULT_MASTER_AUDIO.gain), 0, 1),
    fadeInMs: clamp(finite(value?.fadeInMs, 0), 0, maxFade),
    fadeOutMs: clamp(finite(value?.fadeOutMs, 0), 0, maxFade),
  };
}

/**
 * Resolve the edit's gain at an edited-timeline position. Playback-monitor
 * volume remains a separate user preference and multiplies this value.
 */
export function masterGainAt(
  settings: MasterAudioSettings,
  editedTimeMs: number,
  editedDurationMs: number,
) {
  if (settings.muted) return 0;
  const duration = Math.max(0, finite(editedDurationMs, 0));
  const time = clamp(finite(editedTimeMs, 0), 0, duration);
  const fadeIn = settings.fadeInMs > 0 ? clamp(time / settings.fadeInMs, 0, 1) : 1;
  const remaining = Math.max(0, duration - time);
  const fadeOut = settings.fadeOutMs > 0 ? clamp(remaining / settings.fadeOutMs, 0, 1) : 1;
  return clamp(settings.gain, 0, 1) * Math.min(fadeIn, fadeOut);
}
