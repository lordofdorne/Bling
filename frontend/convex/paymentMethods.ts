import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { publishableKey, stripeClient } from "./lib/stripe";

// Saved cards for signed-in users (Settings → Payments, and reuse at
// checkout). Ported from backend/internal/payment. Stripe holds the card
// details; Bling stores only the customer id.

/** The user's Stripe customer, created on first use. */
export async function ensureCustomer(
  ctx: ActionCtx,
  stripe: Stripe,
  userId: Id<"users">,
  email: string,
): Promise<string> {
  const existing = await ctx.runQuery(internal.paymentMethods.profile, {
    userId,
  });
  if (existing) return existing;
  let customerId: string;
  try {
    const customer = await stripe.customers.create(
      {
        email,
        description: "Bling caller",
        metadata: { bling_user_id: userId },
      },
      { idempotencyKey: `bling-customer-${userId}` },
    );
    customerId = customer.id;
  } catch (error) {
    console.error(
      "Creating a Stripe customer failed",
      (error as Error).message,
    );
    fail("PAYMENT_PROVIDER_ERROR");
  }
  return ctx.runMutation(internal.paymentMethods.saveProfile, {
    userId,
    stripeCustomerId: customerId,
  });
}

export const profile = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (
      await ctx.db
        .query("paymentProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    )?.stripeCustomerId ?? null,
});

/** Keeps the first customer if two requests raced to create one. */
export const saveProfile = internalMutation({
  args: { userId: v.id("users"), stripeCustomerId: v.string() },
  handler: async (ctx, { userId, stripeCustomerId }) => {
    const existing = await ctx.db
      .query("paymentProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return existing.stripeCustomerId;
    await ctx.db.insert("paymentProfiles", { userId, stripeCustomerId });
    return stripeCustomerId;
  },
});

export const account = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCreatorId(ctx);
    const user = (await ctx.db.get(userId))!;
    return { userId, email: user.email ?? "" };
  },
});

type SavedMethod = {
  id: string;
  type: "card";
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

async function listMethods(
  ctx: ActionCtx,
  stripe: Stripe,
  userId: Id<"users">,
): Promise<SavedMethod[]> {
  const customer = await ctx.runQuery(internal.paymentMethods.profile, {
    userId,
  });
  if (!customer) return [];
  try {
    const methods = await stripe.paymentMethods.list({
      customer,
      type: "card",
      limit: 25,
    });
    return methods.data
      .filter((method) => method.card && method.allow_redisplay === "always")
      .map((method) => ({
        id: method.id,
        type: "card" as const,
        brand: method.card!.brand,
        last4: method.card!.last4,
        expMonth: method.card!.exp_month,
        expYear: method.card!.exp_year,
      }));
  } catch (error) {
    console.error("Listing saved cards failed", (error as Error).message);
    fail("PAYMENT_PROVIDER_ERROR");
  }
}

export const list = action({
  args: {},
  handler: async (ctx): Promise<SavedMethod[]> => {
    const { userId } = await ctx.runQuery(internal.paymentMethods.account, {});
    return listMethods(ctx, stripeClient(), userId);
  },
});

/** Client secrets for saving a new card with the Payment Element. */
export const setup = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    clientSecret: string;
    customerSessionClientSecret: string;
    publishableKey: string;
  }> => {
    const { userId, email } = await ctx.runQuery(
      internal.paymentMethods.account,
      {},
    );
    const stripe = stripeClient();
    const key = publishableKey();
    const customer = await ensureCustomer(ctx, stripe, userId, email);
    try {
      const intent = await stripe.setupIntents.create({
        customer,
        payment_method_types: ["card"],
        usage: "on_session",
        description: "Save a payment method for future Bling calls",
      });
      const session = await stripe.customerSessions.create({
        customer,
        components: {
          payment_element: {
            enabled: true,
            features: {
              payment_method_redisplay: "enabled",
              payment_method_redisplay_limit: 5,
              payment_method_remove: "enabled",
            },
          },
        },
      });
      return {
        clientSecret: intent.client_secret!,
        customerSessionClientSecret: session.client_secret,
        publishableKey: key,
      };
    } catch (error) {
      console.error("Starting card setup failed", (error as Error).message);
      fail("PAYMENT_PROVIDER_ERROR");
    }
  },
});

export const remove = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, { paymentMethodId }) => {
    const { userId } = await ctx.runQuery(internal.paymentMethods.account, {});
    const stripe = stripeClient();
    const methods = await listMethods(ctx, stripe, userId);
    // Only the user's own saved cards can be removed.
    if (!methods.some((method) => method.id === paymentMethodId)) {
      fail("PAYMENT_METHOD_NOT_FOUND");
    }
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (error) {
      console.error("Removing a saved card failed", (error as Error).message);
      fail("PAYMENT_PROVIDER_ERROR");
    }
  },
});
