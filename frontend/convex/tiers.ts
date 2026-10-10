import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { showForCreator } from "./shows";

// Tier configuration. Ported from backend/internal/show (ReplaceTiers);
// limits match frontend/src/lib/schemas.ts (tierConfig, MAX_TIERS).
const MAX_TIERS = 5;

const tierInput = v.object({
  name: v.string(),
  callDurationSeconds: v.number(),
  priceCents: v.number(),
  enabled: v.boolean(),
});

function publicTier(tier: Doc<"showTiers">) {
  return {
    _id: tier._id,
    name: tier.name,
    priorityRank: tier.priorityRank,
    callDurationSeconds: tier.callDurationSeconds,
    priceCents: tier.priceCents,
  };
}

/** The creator's tiers for a show, highest priority first. */
export const forCreator = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const creatorId = await requireCreatorId(ctx);
    await showForCreator(ctx, showId, creatorId);
    return ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .order("desc")
      .collect();
  },
});

/** Public: the tiers a caller can pick from while the show is live. */
export const forLiveShow = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const show = await ctx.db.get(showId);
    if (!show || show.status !== "LIVE") return [];
    const tiers = await ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .order("desc")
      .collect();
    return tiers.filter((tier) => tier.enabled).map(publicTier);
  },
});

/**
 * Replaces the whole tier set before the show starts. The order given is the
 * priority order; clients cannot set a rank themselves.
 */
export const replace = mutation({
  args: { showId: v.id("shows"), tiers: v.array(tierInput) },
  handler: async (ctx, { showId, tiers }) => {
    const creatorId = await requireCreatorId(ctx);
    const show = await showForCreator(ctx, showId, creatorId);
    if (show.status !== "CREATED") fail("SHOW_NOT_CONFIGURABLE");

    if (tiers.length < 1 || tiers.length > MAX_TIERS) {
      fail("INVALID_TIER_CONFIGURATION");
    }
    const seen = new Set<string>();
    const normalized = tiers.map((tier, index) => {
      const name = tier.name.trim();
      const key = name.toLowerCase();
      const valid =
        name.length >= 1 &&
        name.length <= 40 &&
        Number.isInteger(tier.callDurationSeconds) &&
        tier.callDurationSeconds >= 30 &&
        tier.callDurationSeconds <= 3600 &&
        Number.isInteger(tier.priceCents) &&
        (tier.priceCents === 0 ||
          (tier.priceCents >= 50 && tier.priceCents <= 1_000_000));
      if (!valid || seen.has(key)) fail("INVALID_TIER_CONFIGURATION");
      seen.add(key);
      return {
        ...tier,
        name,
        priorityRank: (tiers.length - index) * 100,
      };
    });
    if (!normalized.some((tier) => tier.enabled)) {
      fail("INVALID_TIER_CONFIGURATION");
    }

    const existing = await ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .collect();
    for (const tier of existing) await ctx.db.delete(tier._id);
    for (const tier of normalized) {
      await ctx.db.insert("showTiers", { showId, ...tier });
    }
    return ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .order("desc")
      .collect();
  },
});
