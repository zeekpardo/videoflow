"use client";

import { useCallback } from "react";
import { useAction, useConvex, useMutation } from "convex/react";
import { useUploadFile } from "@convex-dev/r2/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024;
const CONCURRENCY = 3;
const STORAGE_PREFIX = "videoflow:multipart:";

function fingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useResumableUpload() {
  const directUpload = useUploadFile(api.r2);
  const convex = useConvex();
  const begin = useAction(api.multipartUploads.begin);
  const signPart = useAction(api.multipartUploads.signPart);
  const complete = useAction(api.multipartUploads.complete);
  const recordPart = useMutation(api.multipartUploadData.recordPart);

  return useCallback(async (file: File, onProgress?: (progress: number) => void): Promise<string> => {
    if (file.size < MULTIPART_THRESHOLD_BYTES) {
      const key = await directUpload(file);
      onProgress?.(1);
      return key;
    }

    const storageKey = `${STORAGE_PREFIX}${fingerprint(file)}`;
    let sessionId: Id<"multipartUploads"> | null = null;
    let partSizeBytes = 0;
    let uploaded = new Set<number>();
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        const candidate = saved as Id<"multipartUploads">;
        const status = await convex.query(api.multipartUploadData.get, { sessionId: candidate });
        if (status?.status === "uploading" && status.expiresAt > Date.now() && status.sizeBytes === file.size) {
          sessionId = candidate;
          partSizeBytes = status.partSizeBytes;
          uploaded = new Set(status.uploadedParts.map((part) => part.partNumber));
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    if (!sessionId) {
      const session = await begin({ fileName: file.name, contentType: file.type || "video/webm", sizeBytes: file.size });
      sessionId = session.sessionId;
      partSizeBytes = session.partSizeBytes;
      window.localStorage.setItem(storageKey, sessionId);
    }

    const partCount = Math.ceil(file.size / partSizeBytes);
    onProgress?.(uploaded.size / partCount);
    const pending = Array.from({ length: partCount }, (_, index) => index + 1).filter((partNumber) => !uploaded.has(partNumber));
    let cursor = 0;
    const uploadOne = async (partNumber: number) => {
      const start = (partNumber - 1) * partSizeBytes;
      const blob = file.slice(start, Math.min(file.size, start + partSizeBytes));
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const { url } = await signPart({ sessionId, partNumber });
          const response = await fetch(url, { method: "PUT", body: blob });
          if (!response.ok) throw new Error(`Upload part ${partNumber} failed (${response.status})`);
          const etag = response.headers.get("etag");
          if (!etag) throw new Error("R2 did not expose the upload ETag; rerun npm run r2:cors");
          await recordPart({ sessionId, partNumber, etag, sizeBytes: blob.size });
          uploaded.add(partNumber);
          onProgress?.(uploaded.size / partCount);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await pause(250 * (attempt + 1));
        }
      }
      throw lastError;
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) {
        const partNumber = pending[cursor];
        cursor += 1;
        await uploadOne(partNumber);
      }
    });
    await Promise.all(workers);
    const key = await complete({ sessionId });
    window.localStorage.removeItem(storageKey);
    onProgress?.(1);
    return key;
  }, [begin, complete, convex, directUpload, recordPart, signPart]);
}
