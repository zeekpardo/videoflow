export const LAYER_HARD_SYNC_SECONDS = 0.5;

const LAYER_RATE_CORRECTION_START_SECONDS = 0.035;
const MAX_RATE_CORRECTION = 0.12;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 4;

/**
 * Keep a muted visual layer close to the primary media clock without seeking
 * it every time the browsers' decoders differ by a handful of frames.
 */
export function synchronizedLayerPlaybackRate(primaryRate: number, driftSeconds: number) {
  const safePrimaryRate = Number.isFinite(primaryRate)
    ? Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, primaryRate))
    : 1;
  if (!Number.isFinite(driftSeconds) || Math.abs(driftSeconds) <= LAYER_RATE_CORRECTION_START_SECONDS) {
    return safePrimaryRate;
  }

  // A layer ahead of the master slows down; a layer behind speeds up. Twelve
  // percentage points is enough to converge smoothly without an obvious
  // visual speed change in a muted screen or webcam layer.
  const correction = Math.min(MAX_RATE_CORRECTION, Math.max(-MAX_RATE_CORRECTION, -driftSeconds * 0.6));
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, safePrimaryRate + correction));
}

export function layerNeedsHardSync(driftSeconds: number, force = false) {
  return force || !Number.isFinite(driftSeconds) || Math.abs(driftSeconds) >= LAYER_HARD_SYNC_SECONDS;
}
