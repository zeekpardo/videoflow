"use node";

import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { r2 } from "./r2";

const PART_SIZE_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PARTS = 10_000;

function config() {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("R2 multipart upload is not configured");
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

function validContentType(contentType: string) {
  return /^(video|audio|image)\/[a-z0-9.+-]+$/i.test(contentType);
}

function safeName(fileName: string) {
  const clean = fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(-120);
  return clean || "upload.bin";
}

export const begin = action({
  args: { fileName: v.string(), contentType: v.string(), sizeBytes: v.number() },
  handler: async (ctx, args): Promise<{ sessionId: Id<"multipartUploads">; partSizeBytes: number; partCount: number }> => {
    const user = await requireUser(ctx);
    const maxBytes = Number(process.env.MAX_VIDEO_BYTES || 2 * 1024 * 1024 * 1024);
    if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0 || args.sizeBytes > maxBytes) throw new Error("File size is outside the configured upload limit");
    if (!validContentType(args.contentType)) throw new Error("Unsupported upload type");
    const partCount = Math.ceil(args.sizeBytes / PART_SIZE_BYTES);
    if (partCount > MAX_PARTS) throw new Error("File requires too many upload parts");
    const { client, bucket } = config();
    const key = `uploads/${randomUUID()}-${safeName(args.fileName)}`;
    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: args.contentType }));
    if (!created.UploadId) throw new Error("R2 did not create an upload session");
    try {
      const sessionId = await ctx.runMutation(internal.multipartUploadData.createSession, {
        ownerId: user.ownerId,
        key,
        uploadId: created.UploadId,
        contentType: args.contentType,
        fileName: safeName(args.fileName),
        sizeBytes: args.sizeBytes,
        partSizeBytes: PART_SIZE_BYTES,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      return { sessionId, partSizeBytes: PART_SIZE_BYTES, partCount };
    } catch (error) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId })).catch(() => {});
      throw error;
    }
  },
});

export const signPart = action({
  args: { sessionId: v.id("multipartUploads"), partNumber: v.number() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const user = await requireUser(ctx);
    const data = await ctx.runQuery(internal.multipartUploadData.sessionData, { sessionId: args.sessionId });
    const session = data?.session;
    const partCount = session ? Math.ceil(session.sizeBytes / session.partSizeBytes) : 0;
    if (!session || session.ownerId !== user.ownerId || session.status !== "uploading" || session.expiresAt <= Date.now()) throw new Error("Upload session expired or unavailable");
    if (!Number.isInteger(args.partNumber) || args.partNumber < 1 || args.partNumber > partCount) throw new Error("Invalid upload part");
    const { client, bucket } = config();
    const url = await getSignedUrl(client, new UploadPartCommand({ Bucket: bucket, Key: session.key, UploadId: session.uploadId, PartNumber: args.partNumber }), { expiresIn: 15 * 60 });
    return { url };
  },
});

export const complete = action({
  args: { sessionId: v.id("multipartUploads") },
  handler: async (ctx, args): Promise<string> => {
    const user = await requireUser(ctx);
    const data = await ctx.runQuery(internal.multipartUploadData.sessionData, { sessionId: args.sessionId });
    const session = data?.session;
    if (!session || session.ownerId !== user.ownerId || session.status !== "uploading" || session.expiresAt <= Date.now()) throw new Error("Upload session expired or unavailable");
    const partCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
    const parts = [...(data?.parts ?? [])].sort((a, b) => a.partNumber - b.partNumber);
    if (parts.length !== partCount || parts.some((part, index) => part.partNumber !== index + 1)) throw new Error("Upload is missing one or more parts");
    const { client, bucket } = config();
    await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: session.key, UploadId: session.uploadId, MultipartUpload: { Parts: parts.map((part) => ({ ETag: part.etag, PartNumber: part.partNumber })) } }));
    await r2.syncMetadata(ctx, session.key);
    await ctx.runMutation(internal.multipartUploadData.finishSession, { sessionId: args.sessionId, ownerId: user.ownerId });
    return session.key;
  },
});

export const abort = action({
  args: { sessionId: v.id("multipartUploads") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const data = await ctx.runQuery(internal.multipartUploadData.sessionData, { sessionId: args.sessionId });
    const session = data?.session;
    if (!session || session.ownerId !== user.ownerId) throw new Error("Upload session not found");
    if (session.status === "completed") return;
    const { client, bucket } = config();
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: session.key, UploadId: session.uploadId })).catch(() => {});
    await ctx.runMutation(internal.multipartUploadData.abortSessionData, { sessionId: args.sessionId, ownerId: user.ownerId });
  },
});
