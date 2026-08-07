import { describe, expect, it } from "vitest";
import {
  clearFinishedRenditionFields,
  currentFinishedRendition,
} from "../convex/lib/finishedRendition";

describe("finished rendition freshness", () => {
  const ready = {
    editRevision: 4,
    finishedRenditionStorageId: "finished-key",
    finishedRenditionSizeBytes: 1234,
    finishedRenditionMimeType: "video/webm;codecs=vp9,opus",
    finishedRenditionDurationMs: 9_500,
    finishedRenditionRevision: 4,
    finishedRenditionStatus: "ready" as const,
    finishedRenditionUpdatedAt: 123,
  };

  it("returns only a complete rendition for the current edit revision", () => {
    expect(currentFinishedRendition(ready)).toEqual({
      storageId: "finished-key",
      sizeBytes: 1234,
      mimeType: "video/webm;codecs=vp9,opus",
      durationMs: 9_500,
      editRevision: 4,
      status: "ready",
      updatedAt: 123,
    });
    expect(currentFinishedRendition({ ...ready, editRevision: 5 })).toBeNull();
    expect(currentFinishedRendition({ ...ready, finishedRenditionStorageId: undefined })).toBeNull();
    expect(currentFinishedRendition({ ...ready, finishedRenditionMimeType: "video/mp4" })?.mimeType).toBe("video/mp4");
    expect(currentFinishedRendition({ ...ready, finishedRenditionMimeType: "application/octet-stream" })).toBeNull();
    expect(currentFinishedRendition({ ...ready, finishedRenditionSizeBytes: 0 })).toBeNull();
    expect(currentFinishedRendition({ ...ready, finishedRenditionDurationMs: 0 })).toBeNull();
  });

  it("provides a complete invalidation patch", () => {
    expect(clearFinishedRenditionFields()).toEqual({
      finishedRenditionStorageId: undefined,
      finishedRenditionSizeBytes: undefined,
      finishedRenditionMimeType: undefined,
      finishedRenditionDurationMs: undefined,
      finishedRenditionRevision: undefined,
      finishedRenditionStatus: undefined,
      finishedRenditionError: undefined,
      finishedRenditionUpdatedAt: undefined,
    });
  });
});
