export interface FinishedRenditionRecord {
  editRevision?: number;
  finishedRenditionStorageId?: string;
  finishedRenditionSizeBytes?: number;
  finishedRenditionMimeType?: string;
  finishedRenditionDurationMs?: number;
  finishedRenditionRevision?: number;
  finishedRenditionStatus?: "rendering" | "ready" | "error";
  finishedRenditionError?: string;
  finishedRenditionUpdatedAt?: number;
}

/** A rendition is publishable only when it was produced from the latest edit. */
export function currentFinishedRendition(video: FinishedRenditionRecord) {
  const editRevision = Number.isInteger(video.editRevision) && (video.editRevision ?? 0) >= 0
    ? video.editRevision!
    : 0;
  if (
    !video.finishedRenditionStorageId ||
    !video.finishedRenditionMimeType?.startsWith("video/") ||
    !Number.isFinite(video.finishedRenditionSizeBytes) ||
    (video.finishedRenditionSizeBytes ?? 0) <= 0 ||
    !Number.isFinite(video.finishedRenditionDurationMs) ||
    (video.finishedRenditionDurationMs ?? 0) <= 0 ||
    video.finishedRenditionRevision !== editRevision
  ) return null;

  return {
    storageId: video.finishedRenditionStorageId,
    sizeBytes: video.finishedRenditionSizeBytes!,
    mimeType: video.finishedRenditionMimeType,
    durationMs: video.finishedRenditionDurationMs!,
    editRevision,
    status: video.finishedRenditionStatus ?? "ready" as const,
    updatedAt: video.finishedRenditionUpdatedAt,
  };
}

export function clearFinishedRenditionFields() {
  return {
    finishedRenditionStorageId: undefined,
    finishedRenditionSizeBytes: undefined,
    finishedRenditionMimeType: undefined,
    finishedRenditionDurationMs: undefined,
    finishedRenditionRevision: undefined,
    finishedRenditionStatus: undefined,
    finishedRenditionError: undefined,
    finishedRenditionUpdatedAt: undefined,
  };
}
