import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/** Whether the server sees a session (anonymous callers included). */
export const hasSession = query({
  args: {},
  handler: async (ctx) => (await getAuthUserId(ctx)) !== null,
});

/**
 * The signed-in account, or null for guests and anonymous callers (who have
 * a session for joining queues but are not "signed in" to the app).
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId && (await ctx.db.get(userId));
    if (!user || user.isAnonymous || !user.username) return null;
    return {
      id: user._id,
      username: user.username,
      email: user.email ?? "",
      createdAt: user._creationTime,
    };
  },
});
