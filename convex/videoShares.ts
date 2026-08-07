"use node";

import { randomBytes } from "node:crypto";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

function ownerId(identity: UserIdentity | null) {
  if (!identity?.tokenIdentifier) throw new Error("Not authenticated");
  return identity.tokenIdentifier;
}

const token = () => randomBytes(24).toString("base64url");

export const setVisibility = action({
  args: { videoId: v.id("videos"), visibility: v.union(v.literal("private"), v.literal("public")) },
  handler: async (ctx, args): Promise<{ shareToken: string | undefined }> => {
    const currentOwner = ownerId(await ctx.auth.getUserIdentity());
    const info = await ctx.runQuery(internal.videoShareData.ownerShareInfo, { videoId: args.videoId });
    if (!info || info.ownerId !== currentOwner) throw new Error("Not authorized");
    return ctx.runMutation(internal.videoShareData.setVisibility, {
      ...args, ownerId: currentOwner,
      shareToken: args.visibility === "public" ? info.shareToken || token() : info.shareToken,
    });
  },
});

export const regenerate = action({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args): Promise<{ shareToken: string }> => {
    const currentOwner = ownerId(await ctx.auth.getUserIdentity());
    return ctx.runMutation(internal.videoShareData.regenerate, { videoId: args.videoId, ownerId: currentOwner, shareToken: token() });
  },
});
