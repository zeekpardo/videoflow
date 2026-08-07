import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const createSession = internalMutation({
  args: {
    ownerId: v.string(),
    key: v.string(),
    uploadId: v.string(),
    contentType: v.string(),
    fileName: v.string(),
    sizeBytes: v.number(),
    partSizeBytes: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("multipartUploads", { ...args, status: "uploading", createdAt: now, updatedAt: now });
  },
});

export const sessionData = internalQuery({
  args: { sessionId: v.id("multipartUploads") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const parts = await ctx.db.query("multipartParts").withIndex("by_session", (q) => q.eq("uploadSessionId", args.sessionId)).collect();
    return { session, parts };
  },
});

export const finishSession = internalMutation({
  args: { sessionId: v.id("multipartUploads"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerId !== args.ownerId || session.status !== "uploading") throw new Error("Upload session is unavailable");
    await ctx.db.patch(args.sessionId, { status: "completed", updatedAt: Date.now() });
    const pending = await ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", session.key)).first();
    if (!pending) await ctx.db.insert("pendingUploads", { key: session.key, ownerId: args.ownerId, createdAt: Date.now() });
    else if (pending.ownerId !== args.ownerId) throw new Error("Upload owner mismatch");
    for (const part of await ctx.db.query("multipartParts").withIndex("by_session", (q) => q.eq("uploadSessionId", args.sessionId)).collect()) await ctx.db.delete(part._id);
  },
});

export const abortSessionData = internalMutation({
  args: { sessionId: v.id("multipartUploads"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerId !== args.ownerId) throw new Error("Upload session not found");
    if (session.status === "completed") throw new Error("Completed uploads cannot be aborted");
    await ctx.db.patch(args.sessionId, { status: "aborted", updatedAt: Date.now() });
    for (const part of await ctx.db.query("multipartParts").withIndex("by_session", (q) => q.eq("uploadSessionId", args.sessionId)).collect()) await ctx.db.delete(part._id);
  },
});

export const get = query({
  args: { sessionId: v.id("multipartUploads") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerId !== user.ownerId) return null;
    const parts = await ctx.db.query("multipartParts").withIndex("by_session", (q) => q.eq("uploadSessionId", args.sessionId)).collect();
    return { status: session.status, fileName: session.fileName, sizeBytes: session.sizeBytes, partSizeBytes: session.partSizeBytes, expiresAt: session.expiresAt, uploadedParts: parts.map((part) => ({ partNumber: part.partNumber, sizeBytes: part.sizeBytes })) };
  },
});

export const recordPart = mutation({
  args: { sessionId: v.id("multipartUploads"), partNumber: v.number(), etag: v.string(), sizeBytes: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerId !== user.ownerId || session.status !== "uploading" || session.expiresAt <= Date.now()) throw new Error("Upload session expired or unavailable");
    const partCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
    const expectedSize = args.partNumber === partCount ? session.sizeBytes - session.partSizeBytes * (partCount - 1) : session.partSizeBytes;
    if (!Number.isInteger(args.partNumber) || args.partNumber < 1 || args.partNumber > partCount || args.sizeBytes !== expectedSize) throw new Error("Invalid upload part");
    const etag = args.etag.trim().replace(/^W\//, "");
    if (!/^"?[a-f0-9]{16,128}"?$/i.test(etag)) throw new Error("Invalid upload ETag");
    const existing = await ctx.db.query("multipartParts").withIndex("by_session_part", (q) => q.eq("uploadSessionId", args.sessionId).eq("partNumber", args.partNumber)).first();
    if (existing) await ctx.db.patch(existing._id, { etag, sizeBytes: args.sizeBytes, updatedAt: Date.now() });
    else await ctx.db.insert("multipartParts", { ownerId: user.ownerId, uploadSessionId: args.sessionId, partNumber: args.partNumber, etag, sizeBytes: args.sizeBytes, updatedAt: Date.now() });
  },
});
