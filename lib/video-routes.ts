export type VideoStorageScope = "cloud" | "local";

/**
 * Return the full editor route for a newly saved recording.
 *
 * Keep this shared by the provider-backed and test-mode save flows so a
 * successful save always lands in the same editing experience. Encoding the
 * identifier also keeps browser-local IDs safe if an imported project uses
 * characters that have meaning inside a URL path.
 */
export function videoEditorHref(videoId: string, scope: VideoStorageScope = "cloud") {
  const encodedId = encodeURIComponent(videoId);
  return scope === "local" ? `/test/videos/${encodedId}` : `/videos/${encodedId}`;
}
