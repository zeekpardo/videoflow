import type { GenericDatabaseReader, GenericDataModel } from "convex/server";

type AuthCtx = { auth: { getUserIdentity: () => Promise<Record<string, unknown> | null> } };

export async function requireUser(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const ownerId = String(identity.tokenIdentifier || "");
  if (!ownerId) throw new Error("Invalid authentication identity");
  return {
    ownerId,
    name: String(identity.name || identity.nickname || "Video owner"),
    email: typeof identity.email === "string" ? identity.email : undefined,
    image: typeof identity.pictureUrl === "string" ? identity.pictureUrl : typeof identity.picture === "string" ? identity.picture : undefined,
  };
}

export async function requireOwnedVideo<DataModel extends GenericDataModel>(ctx: AuthCtx & { db: GenericDatabaseReader<DataModel> }, videoId: string) {
  const user = await requireUser(ctx);
  const video = await ctx.db.get(videoId as never) as { ownerId?: string } | null;
  if (!video) throw new Error("Video not found");
  if (video.ownerId !== user.ownerId) throw new Error("Not authorized");
  return { user, video };
}
