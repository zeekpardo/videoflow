export interface VideoFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolve the webcam bubble in output-frame pixels.
 *
 * `size` is intentionally relative to the frame's shorter edge. That is the
 * same unit used by the live recorder (`min(width, height) * size`) and keeps
 * a bubble visually stable when the source is landscape, portrait, or
 * ultrawide. The editor preview and canvas exporter both use this geometry.
 */
export function cameraFrameRect(
  outputWidth: number,
  outputHeight: number,
  x: number,
  y: number,
  size: number,
): VideoFrameRect {
  const width = Math.max(1, outputWidth);
  const height = Math.max(1, outputHeight);
  const edge = Math.max(1, Math.min(width, height) * size);
  return {
    x: x * width - edge / 2,
    y: y * height - edge / 2,
    width: edge,
    height: edge,
  };
}

/** Width of the square webcam bubble as a fraction of a responsive frame. */
export function cameraFrameWidthFraction(frameAspect: number, size: number) {
  const aspect = Number.isFinite(frameAspect) && frameAspect > 0
    ? frameAspect
    : 16 / 9;
  // In landscape the shorter edge is the height; in portrait it is width.
  return size * Math.min(1, 1 / aspect);
}
