import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./errors";

/** The signed-in user (anonymous viewers included), or UNAUTHENTICATED. */
export async function requireUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) fail("UNAUTHENTICATED");
  return userId;
}

/** A signed-in creator: a real account, not an anonymous viewer. */
export async function requireCreatorId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await requireUserId(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.isAnonymous || !user.username) fail("UNAUTHENTICATED");
  return userId;
}
