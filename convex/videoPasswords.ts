"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_MS = 12 * 60 * 60 * 1000;

function ownerId(identity: UserIdentity | null) {
  if (!identity?.tokenIdentifier) throw new Error("Not authenticated");
  return identity.tokenIdentifier;
}

async function derive(password: string, salt: string) {
  return Buffer.from(await scrypt(password, Buffer.from(salt, "hex"), 32) as Buffer).toString("hex");
}

export const setPassword = action({
  args: { videoId: v.id("videos"), password: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const currentOwner = ownerId(identity);
    const info = await ctx.runQuery(internal.videoPasswordData.ownerInfo, { videoId: args.videoId });
    if (!info || info.ownerId !== currentOwner) throw new Error("Not authorized");
    if (args.password === null || args.password === "") {
      await ctx.runMutation(internal.videoPasswordData.setHash, { videoId: args.videoId, ownerId: currentOwner });
      return;
    }
    if (args.password.length < 8 || args.password.length > 128) throw new Error("Password must be 8–128 characters");
    const salt = randomBytes(16).toString("hex");
    const hash = await derive(args.password, salt);
    await ctx.runMutation(internal.videoPasswordData.setHash, { videoId: args.videoId, ownerId: currentOwner, salt, hash });
  },
});

export const unlock = action({
  args: { shareToken: v.string(), password: v.string(), viewerKey: v.string(), viewerEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.viewerKey.length < 8 || args.viewerKey.length > 160) throw new Error("Invalid viewer session");
    await ctx.runMutation(internal.videoPasswordData.checkUnlockRate, { key: `${args.shareToken}:${args.viewerKey}` });
    const info = await ctx.runQuery(internal.videoPasswordData.lockInfo, { shareToken: args.shareToken });
    if (!info) {
      const v2 = await ctx.runQuery(internal.videoFlowV2.shareLinkLockInfo, { token: args.shareToken });
      if (!v2) throw new Error("Video not found");
      if (v2.passwordHash && v2.passwordSalt) {
        const candidate = Buffer.from(await derive(args.password, v2.passwordSalt), "hex");
        const expected = Buffer.from(v2.passwordHash, "hex");
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error("Incorrect password");
      }
      const viewerEmail = args.viewerEmail?.trim().toLowerCase();
      if (v2.requireEmail && (!viewerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(viewerEmail))) throw new Error("Enter a valid email address");
      if (v2.requireEmail && v2.reviewerEmail && viewerEmail !== v2.reviewerEmail) throw new Error("Use the email address assigned to this review request");
      if (viewerEmail && v2.allowedDomains.length && !v2.allowedDomains.includes(viewerEmail.split("@")[1] || "")) throw new Error("This email domain is not allowed");
      const sessionToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
      const expiresAt = Date.now() + SESSION_MS;
      await ctx.runMutation(internal.videoFlowV2.createShareLinkSession, { shareLinkId: v2.shareLinkId, tokenHash, viewerEmail, expiresAt });
      return { sessionToken, expiresAt };
    }
    if (!info.passwordHash || !info.passwordSalt) return { sessionToken: null };
    const candidate = Buffer.from(await derive(args.password, info.passwordSalt), "hex");
    const expected = Buffer.from(info.passwordHash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error("Incorrect password");
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
    const expiresAt = Date.now() + SESSION_MS;
    await ctx.runMutation(internal.videoPasswordData.createSession, { videoId: info.videoId, tokenHash, expiresAt });
    return { sessionToken, expiresAt };
  },
});
