/** Return the container portion of a MIME type without codec parameters. */
export function mediaTypeEssence(mimeType?: string | null) {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isSupportedVideoContainer(mimeType?: string | null): mimeType is string {
  const type = mediaTypeEssence(mimeType);
  return type === "video/webm" || type === "video/mp4";
}

export function videoFileExtension(mimeType?: string | null) {
  return mediaTypeEssence(mimeType) === "video/mp4" ? "mp4" : "webm";
}

export function audioFileExtension(mimeType?: string | null) {
  const type = mediaTypeEssence(mimeType);
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/ogg") return "ogg";
  return "webm";
}

export function videoFilename(base: string, mimeType?: string | null) {
  return `${base}.${videoFileExtension(mimeType)}`;
}
