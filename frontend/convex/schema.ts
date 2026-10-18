import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex data model for Bling, migrating from the Go API in phases
// (docs/convex-migration.md): accounts, shows, tiers and the caller queue
// (phase 1), calls with signaling and presence (phase 2), payments (phase 3),
// creator payouts (phase 4) and social discovery (phase 5).
//
// Busy-show rule: a write that every caller makes (joining, leaving) touches
// only that caller's own document. Nothing shared, such as a counter on the
// show, is written per join, so a rush of callers never conflicts.

export const showStatus = v.union(
  v.literal("CREATED"),
  v.literal("LIVE"),
  v.literal("ENDED"),
);

export const queueStatus = v.union(
  v.literal("WAITING"),
  v.literal("LEFT"),
  v.literal("SELECTED"),
  v.literal("CONNECTING"),
  v.literal("LIVE"),
  v.literal("ENDED"),
);

export const callStatus = v.union(
  v.literal("PAYMENT_PENDING"),
  v.literal("CREATED"),
  v.literal("CONNECTING"),
  v.literal("LIVE"),
  v.literal("ENDED"),
  v.literal("FAILED"),
);

export const callRole = v.union(v.literal("creator"), v.literal("viewer"));

export const signalType = v.union(
  v.literal("signal.ready"),
  v.literal("signal.offer"),
  v.literal("signal.answer"),
  v.literal("signal.ice"),
);

export const paymentStatus = v.union(
  v.literal("CREATED"),
  v.literal("AUTHORIZED"),
  v.literal("CAPTURING"),
  v.literal("CAPTURED"),
  v.literal("CANCELED"),
  v.literal("FAILED"),
);

export const refundStatus = v.union(
  v.literal("REQUESTED"),
  v.literal("PROCESSING"),
  v.literal("RETRY"),
  v.literal("PENDING"),
  v.literal("SUCCEEDED"),
  v.literal("FAILED"),
);

export const ledgerKind = v.union(
  v.literal("EARNING"),
  v.literal("REFUND_REVERSAL"),
  v.literal("DISPUTE_DEBIT"),
  v.literal("DISPUTE_RELEASE"),
  v.literal("PAYOUT_RESERVATION"),
  v.literal("PAYOUT_RELEASE"),
  v.literal("ADJUSTMENT"),
);

export const payoutItemStatus = v.union(
  v.literal("RESERVED"),
  v.literal("SENDING"),
  v.literal("PAID"),
  v.literal("RETRY"),
  v.literal("FAILED"),
  v.literal("CANCELED"),
);

export default defineSchema({
  ...authTables,

  // Convex Auth's users table, plus Bling's username. Anonymous viewers have
  // no username; creators always do.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
    /** The creator's platform fee, fixed at sign-up (lib/stripe.ts). */
    platformFeeBps: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_username", ["username"]),

  shows: defineTable({
    creatorId: v.id("users"),
    status: showStatus,
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    /** When the creator says this draft will open, announced on their page. */
    scheduledFor: v.optional(v.number()),
  }).index("by_creator_status", ["creatorId", "status"]),

  // Tiers belong to one show and are replaced as a set before it starts.
  // priorityRank comes from the order the creator listed them in.
  showTiers: defineTable({
    showId: v.id("shows"),
    name: v.string(),
    priorityRank: v.number(),
    callDurationSeconds: v.number(),
    priceCents: v.number(),
    enabled: v.boolean(),
  }).index("by_show_rank", ["showId", "priorityRank"]),

  // One document per caller per show. The queue is a holding place: creators
  // choose whom to connect, so there is no place in line. joinedAt only sorts
  // the creator's list within a tier.
  queueEntries: defineTable({
    showId: v.id("shows"),
    viewerId: v.id("users"),
    displayName: v.string(),
    topic: v.string(),
    status: queueStatus,
    tierId: v.id("showTiers"),
    tierName: v.string(),
    priorityRank: v.number(),
    callDurationSeconds: v.number(),
    tierPriceCents: v.number(),
    joinedAt: v.number(),
    selectedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    paymentAttemptId: v.optional(v.id("paymentAttempts")),
  })
    .index("by_show_viewer", ["showId", "viewerId"])
    .index("by_show_status_rank_joined", [
      "showId",
      "status",
      "priorityRank",
      "joinedAt",
    ]),

  // One call per selected caller. creatorId and viewerId are copied from the
  // show and the queue entry so authorizing a participant is one read.
  calls: defineTable({
    showId: v.id("shows"),
    queueEntryId: v.id("queueEntries"),
    creatorId: v.id("users"),
    viewerId: v.id("users"),
    status: callStatus,
    selectionMode: v.union(v.literal("MANUAL"), v.literal("RANDOM")),
    callDurationSeconds: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    paymentAttemptId: v.optional(v.id("paymentAttempts")),
  })
    .index("by_show_status", ["showId", "status"])
    .index("by_status", ["status"])
    .index("by_payment_attempt", ["paymentAttemptId"])
    .index("by_viewer_show", ["viewerId", "showId"])
    .index("by_creator_viewer", ["creatorId", "viewerId"]),

  // A creator's private note about one caller, kept across shows. Only that
  // creator reads or writes it; callers never see it.
  callerNotes: defineTable({
    creatorId: v.id("users"),
    viewerId: v.id("users"),
    note: v.string(),
    updatedAt: v.number(),
  }).index("by_creator_viewer", ["creatorId", "viewerId"]),

  // WebRTC signaling between the two participants. The sender inserts, the
  // recipient's live query sees it, and the recipient deletes it once handled.
  // payload is the JSON text the browser produced (an SDP or ICE candidate).
  callSignals: defineTable({
    callId: v.id("calls"),
    to: callRole,
    type: signalType,
    payload: v.string(),
  }).index("by_call_to_type", ["callId", "to", "type"]),

  // Each participant writes only their own row, so the two heartbeats never
  // conflict. disconnectedAt is set when heartbeats stop and cleared by the
  // next one.
  callPresence: defineTable({
    callId: v.id("calls"),
    role: callRole,
    lastSeenAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  }).index("by_call_role", ["callId", "role"]),

  // A caller's card authorization for a paid tier: Stripe holds the amount
  // when they join and captures it only when the creator picks them. Fees are
  // snapshotted here so later pricing changes never alter an existing call.
  // Every attempt uses the PLATFORM flow (no destination charge).
  paymentAttempts: defineTable({
    showId: v.id("shows"),
    creatorId: v.id("users"),
    tierId: v.id("showTiers"),
    payerId: v.id("users"),
    idempotencyKey: v.string(),
    queueEntryId: v.optional(v.id("queueEntries")),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    platformFeeBps: v.number(),
    platformFeeCents: v.number(),
    basicCardFeeCents: v.number(),
    creatorProcessingFeeCents: v.number(),
    status: paymentStatus,
    failureCode: v.optional(v.string()),
    authorizedAt: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    savedPaymentMethodId: v.optional(v.string()),
  })
    .index("by_show_key", ["showId", "idempotencyKey"])
    .index("by_intent", ["stripePaymentIntentId"])
    .index("by_creator", ["creatorId"]),

  // At most one refund per payment attempt. Retried with backoff until Stripe
  // reports a final status.
  paymentRefunds: defineTable({
    paymentAttemptId: v.id("paymentAttempts"),
    callId: v.id("calls"),
    stripePaymentIntentId: v.string(),
    stripeRefundId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    reason: v.string(),
    status: refundStatus,
    attempts: v.number(),
    failureCode: v.optional(v.string()),
    nextAttemptAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_attempt", ["paymentAttemptId"])
    .index("by_intent", ["stripePaymentIntentId"])
    .index("by_stripe_refund", ["stripeRefundId"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  paymentDisputes: defineTable({
    stripeDisputeId: v.string(),
    paymentAttemptId: v.optional(v.id("paymentAttempts")),
    stripePaymentIntentId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    reason: v.string(),
    status: v.string(),
    evidenceDueAt: v.optional(v.number()),
  })
    .index("by_stripe_dispute", ["stripeDisputeId"])
    .index("by_attempt", ["paymentAttemptId"]),

  // Stripe webhook events already applied. Each event is applied in one
  // transaction together with this row, so redelivery is a no-op.
  stripeEvents: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    connectedAccountId: v.optional(v.string()),
  }).index("by_stripe_event", ["stripeEventId"]),

  // A signed-in user's Stripe customer, for saved payment methods.
  paymentProfiles: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  }).index("by_user", ["userId"]),

  // The creator's Stripe Connect recipient account (Accounts v2), as last
  // read from Stripe. Bling is merchant of record; creators only receive
  // transfers, so readiness rests on the stripe_transfers capability, bank
  // payouts, a bank account, and no currently-due requirements.
  payoutAccounts: defineTable({
    creatorId: v.id("users"),
    stripeAccountId: v.string(),
    transfersStatus: v.string(),
    bankPayoutsStatus: v.string(),
    externalAccountPresent: v.boolean(),
    externalAccountBankName: v.optional(v.string()),
    externalAccountLast4: v.optional(v.string()),
    externalAccountCurrency: v.optional(v.string()),
    detailsSubmitted: v.boolean(),
    requirementsDue: v.array(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_stripe_account", ["stripeAccountId"]),

  // What Bling owes each creator: an append-only list of signed amounts.
  // idempotencyKey makes every business event post at most once. An entry
  // counts toward the available balance from effectiveAt (earnings are held
  // for CREATOR_EARNINGS_HOLD_HOURS).
  ledgerEntries: defineTable({
    creatorId: v.id("users"),
    kind: ledgerKind,
    amountCents: v.number(),
    currency: v.string(),
    effectiveAt: v.number(),
    idempotencyKey: v.string(),
    paymentAttemptId: v.optional(v.id("paymentAttempts")),
    callId: v.optional(v.id("calls")),
    payoutItemId: v.optional(v.id("payoutItems")),
    metadata: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
  })
    .index("by_key", ["idempotencyKey"])
    // Newest first for the activity list (Convex orders by _creationTime
    // within an index).
    .index("by_creator_currency", ["creatorId", "currency"])
    .index("by_creator_currency_effective", [
      "creatorId",
      "currency",
      "effectiveAt",
    ])
    .index("by_attempt_kind", ["paymentAttemptId", "kind"]),

  // Running total of a creator's ledger, kept in the same transaction as each
  // entry, so a balance never sums the whole history.
  creatorBalances: defineTable({
    creatorId: v.id("users"),
    currency: v.string(),
    totalCents: v.number(),
  }).index("by_creator_currency", ["creatorId", "currency"]),

  // One run per month and currency; one item per creator in it.
  payoutRuns: defineTable({
    periodStart: v.string(),
    periodEnd: v.string(),
    currency: v.string(),
    status: v.union(
      v.literal("PROCESSING"),
      v.literal("COMPLETED"),
      v.literal("PARTIAL_FAILED"),
    ),
    completedAt: v.optional(v.number()),
  })
    .index("by_period", ["periodStart", "currency"])
    .index("by_status", ["status"]),

  payoutItems: defineTable({
    runId: v.id("payoutRuns"),
    creatorId: v.id("users"),
    amountCents: v.number(),
    currency: v.string(),
    destinationAccountId: v.string(),
    idempotencyKey: v.string(),
    stripeTransferId: v.optional(v.string()),
    status: payoutItemStatus,
    attempts: v.number(),
    nextAttemptAt: v.number(),
    failureCode: v.optional(v.string()),
    processedAt: v.optional(v.number()),
  })
    .index("by_run_creator", ["runId", "creatorId"])
    .index("by_run_status", ["runId", "status"])
    .index("by_creator_status", ["creatorId", "status"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // Stripe payouts from a creator's connected balance to their bank, from
  // payout.* webhooks.
  payoutEvents: defineTable({
    stripePayoutId: v.string(),
    creatorId: v.id("users"),
    amountCents: v.number(),
    currency: v.string(),
    status: v.string(),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
    arrivalAt: v.optional(v.number()),
  })
    .index("by_stripe_payout", ["stripePayoutId"])
    .index("by_creator", ["creatorId"]),

  // A creator's public face. Every account with a username has one, created
  // unpublished at sign-up; creating a show publishes it. followerCount is
  // projected from followerShards a few seconds after follows change.
  profiles: defineTable({
    userId: v.id("users"),
    username: v.string(),
    displayName: v.string(),
    bio: v.string(),
    avatarStorageId: v.optional(v.id("_storage")),
    avatarUrl: v.string(),
    coverUrl: v.string(),
    published: v.boolean(),
    followerCount: v.number(),
    isLive: v.boolean(),
    liveShowId: v.optional(v.id("shows")),
    liveStartedAt: v.optional(v.number()),
    /** The announced opening of the creator's next Hotline, if any. */
    nextHotlineAt: v.optional(v.number()),
    /** When followers were last emailed that this creator went live. */
    lastLiveAlertAt: v.optional(v.number()),
    /** username, display name and bio, for the search index. */
    searchText: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_username", ["username"])
    .index("by_avatar", ["avatarStorageId"])
    .index("by_directory", ["published", "isLive", "followerCount"])
    .searchIndex("search", {
      searchField: "searchText",
      filterFields: ["published", "isLive"],
    }),

  follows: defineTable({
    followerId: v.id("users"),
    creatorId: v.id("users"),
  })
    .index("by_follower_creator", ["followerId", "creatorId"])
    .index("by_creator", ["creatorId"]),

  // How many creators a user follows, for the 1,000-follow cap. Written only
  // by that user's own follows.
  followingCounts: defineTable({
    userId: v.id("users"),
    count: v.number(),
  }).index("by_user", ["userId"]),

  // A creator's follower total spread over 64 shards, so a rush of follows
  // to one creator never contends on a single counter.
  followerShards: defineTable({
    creatorId: v.id("users"),
    shard: v.number(),
    count: v.number(),
  }).index("by_creator_shard", ["creatorId", "shard"]),

  // A creator whose shards changed since the last projection. Its existence
  // means a projection is already scheduled.
  followerProjections: defineTable({
    creatorId: v.id("users"),
  }).index("by_creator", ["creatorId"]),

  // One per show that went live: followers' notifications. Kept 30 days.
  liveEvents: defineTable({
    creatorId: v.id("users"),
    showId: v.id("shows"),
  })
    .index("by_creator", ["creatorId"])
    .index("by_show", ["showId"]),

  // A user's email choices. No row means the defaults (alerts on); a row is
  // written only when they change something.
  emailPreferences: defineTable({
    userId: v.id("users"),
    liveAlerts: v.boolean(),
  }).index("by_user", ["userId"]),

  notificationReads: defineTable({
    userId: v.id("users"),
    eventId: v.id("liveEvents"),
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_event", ["eventId"]),

  // Channel-page visitors of a live show, one row per visitor, refreshed by
  // their heartbeat. Counted into channelStats every 30 seconds, never per
  // heartbeat, so a busy channel does not re-run every viewer's query.
  channelVisits: defineTable({
    showId: v.id("shows"),
    visitorId: v.id("users"),
    lastSeenAt: v.number(),
  })
    .index("by_show_visitor", ["showId", "visitorId"])
    .index("by_show_seen", ["showId", "lastSeenAt"]),

  // counting: a recount is scheduled. It starts with the first heartbeat and
  // stops once nobody is left, so a live show with no visitors costs nothing.
  channelStats: defineTable({
    showId: v.id("shows"),
    visitors: v.number(),
    counting: v.boolean(),
  }).index("by_show", ["showId"]),

  // Fixed one-minute windows for per-user limits on social writes.
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});
