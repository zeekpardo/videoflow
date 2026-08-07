import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const r2 = new R2(components.r2);

const clientApi = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => { await requireUser(ctx); },
  checkReadKey: async (ctx, _bucket, key) => {
    const { ownerId } = await requireUser(ctx);
    const pending = await ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (!pending || pending.ownerId !== ownerId) throw new Error("Not authorized");
  },
  onUpload: async (ctx, _bucket, key) => {
    const { ownerId } = await requireUser(ctx);
    const existing = await ctx.db.query("pendingUploads").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (!existing) await ctx.db.insert("pendingUploads", { key, ownerId, createdAt: Date.now() });
    else if (existing.ownerId !== ownerId) throw new Error("Upload owner mismatch");
  },
});

export const syncMetadata = clientApi.syncMetadata;
export const getMetadata = clientApi.getMetadata;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const { ownerId } = await requireUser(ctx);
    const upload = await r2.generateUploadUrl();
    await ctx.db.insert("pendingUploads", { key: upload.key, ownerId, createdAt: Date.now() });
    return upload;
  },
});
