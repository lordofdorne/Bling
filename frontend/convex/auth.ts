import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { createProfile } from "./lib/social";
import { ResendPasswordReset } from "./passwordReset";

// Creators sign up with email, password and a username. Callers join a queue
// as anonymous users, which replaces the Go API's viewer recovery cookie: the
// Convex Auth session is the caller's identity across refreshes.
//
// Rules match frontend/src/lib/schemas.ts (usernameField, newPasswordField).
const USERNAME = /^[a-z0-9_]{3,30}$/;

function invalid(message: string): never {
  throw new ConvexError({ code: "VALIDATION_FAILED", message });
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      reset: ResendPasswordReset,
      profile(params) {
        const email = String(params.email ?? "")
          .trim()
          .toLowerCase();
        if (!email || email.length > 254) invalid("Enter your email address.");
        if (params.flow !== "signUp") return { email };
        const username = String(params.username ?? "").trim();
        if (!USERNAME.test(username)) {
          invalid(
            "Use 3–30 lowercase letters, numbers, or underscores for a username.",
          );
        }
        return { email, username };
      },
      validatePasswordRequirements(password) {
        if (password.length < 12 || password.length > 72) {
          invalid("Use 12 to 72 characters for your password.");
        }
      },
    }),
    Anonymous,
  ],
  callbacks: {
    // Usernames are unique. Convex runs this inside the sign-up transaction,
    // so two people racing for one name cannot both get it.
    async createOrUpdateUser(ctx: MutationCtx, args) {
      if (args.existingUserId) return args.existingUserId;
      const username = args.profile.username as string | undefined;
      if (username) {
        const taken = await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", username))
          .first();
        if (taken) invalid("That username is taken.");
      }
      const userId = await ctx.db.insert("users", args.profile);
      // Every account with a username gets an unpublished creator profile.
      if (username) await createProfile(ctx, userId, username);
      return userId;
    },
  },
});
