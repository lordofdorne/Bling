import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  httpAction,
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { fail } from "./lib/errors";
import { profileForUser } from "./lib/social";

// "@creator just opened their Hotline" emails to followers.
//
// Going live schedules a walk over the creator's followers in batches of
// 100 (each batch one small mutation that reschedules the next), and each
// batch becomes one call to Resend's batch API. Followers who are signed in
// and haven't turned alerts off get one; a creator who restarts within six
// hours doesn't email everyone again.
//
// Unsubscribe links carry the user id signed with a server secret, so no
// token is stored per follower. Opening the link shows a confirm button
// (mail scanners open links); mail clients' one-click unsubscribe POSTs.
//
// Environment: AUTH_RESEND_KEY and AUTH_EMAIL_FROM (shared with password
// reset), SITE_URL for links, EMAIL_POSTAL_ADDRESS for the footer (US law
// asks marketing-style email to carry one), AUTH_EMAIL_LOG_CODES=true logs
// instead of sending (local only), UNSUBSCRIBE_SECRET (falls back to the
// auth signing key).

const BATCH = 100;
const ALERT_COOLDOWN_MS = 6 * 60 * 60_000;
const MAX_SEND_ATTEMPTS = 3;

/** Called when a show goes live; a fixed amount of work. */
export async function queueLiveAlert(ctx: MutationCtx, show: Doc<"shows">) {
  const profile = await profileForUser(ctx, show.creatorId);
  if (!profile) return;
  const now = Date.now();
  if (
    profile.lastLiveAlertAt !== undefined &&
    now - profile.lastLiveAlertAt < ALERT_COOLDOWN_MS
  ) {
    return;
  }
  await ctx.db.patch(profile._id, { lastLiveAlertAt: now });
  await ctx.scheduler.runAfter(0, internal.liveAlerts.collect, {
    showId: show._id,
    cursor: null,
    batch: 0,
  });
}

/** One batch of followers who should hear about this show. */
export const collect = internalMutation({
  args: {
    showId: v.id("shows"),
    cursor: v.union(v.string(), v.null()),
    batch: v.number(),
  },
  handler: async (ctx, { showId, cursor, batch }) => {
    const show = await ctx.db.get(showId);
    // A Hotline that already closed isn't worth announcing.
    if (!show || show.status !== "LIVE") return;
    const profile = await profileForUser(ctx, show.creatorId);
    if (!profile) return;

    const page = await ctx.db
      .query("follows")
      .withIndex("by_creator", (q) => q.eq("creatorId", show.creatorId))
      .paginate({ cursor, numItems: BATCH });
    const recipients: { userId: Id<"users">; email: string }[] = [];
    for (const follow of page.page) {
      const user = await ctx.db.get(follow.followerId);
      if (!user?.email || user.isAnonymous) continue;
      const prefs = await ctx.db
        .query("emailPreferences")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (prefs?.liveAlerts === false) continue;
      recipients.push({ userId: user._id, email: user.email });
    }
    if (recipients.length) {
      await ctx.scheduler.runAfter(0, internal.liveAlerts.send, {
        showId,
        batch,
        username: profile.username,
        displayName: profile.displayName,
        recipients,
        attempt: 1,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.liveAlerts.collect, {
        showId,
        cursor: page.continueCursor,
        batch: batch + 1,
      });
    }
  },
});

export const send = internalAction({
  args: {
    showId: v.id("shows"),
    batch: v.number(),
    username: v.string(),
    displayName: v.string(),
    recipients: v.array(v.object({ userId: v.id("users"), email: v.string() })),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const site = (process.env.SITE_URL ?? "https://blinghotline.com").replace(
      /\/$/,
      "",
    );
    const hotlineUrl = `${site}/u/${args.username}`;
    const emails = await Promise.all(
      args.recipients.map(async ({ userId, email }) => {
        const unsubscribeUrl = `${process.env.CONVEX_SITE_URL}/email/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(userId))}`;
        return {
          to: [email],
          subject: `${args.displayName} just opened their Hotline`,
          text: alertText(args.displayName, hotlineUrl, unsubscribeUrl),
          html: alertHtml(args.displayName, hotlineUrl, unsubscribeUrl),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }),
    );

    if (process.env.AUTH_EMAIL_LOG_CODES === "true") {
      console.log(
        `Live alert for @${args.username} to ${emails.length} follower(s)`,
      );
      return;
    }
    const key = process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    if (!key || !from) {
      console.error("Live alerts need AUTH_RESEND_KEY and AUTH_EMAIL_FROM");
      return;
    }
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // A retried batch is never delivered twice.
        "Idempotency-Key": `live-${args.showId}-${args.batch}`,
      },
      body: JSON.stringify(emails.map((email) => ({ from, ...email }))),
    });
    if (response.ok) return;
    console.error(
      `Live alert batch failed (${response.status}): ${await response.text()}`,
    );
    if (args.attempt < MAX_SEND_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        args.attempt * 30_000,
        internal.liveAlerts.send,
        { ...args, attempt: args.attempt + 1 },
      );
    }
  },
});

// ------------------------------------------------------------ preferences

/** The signed-in user's email choices, or null for guests. */
export const preferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user?.email || user.isAnonymous) return null;
    const prefs = await ctx.db
      .query("emailPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { email: user.email, liveAlerts: prefs?.liveAlerts ?? true };
  },
});

export const setLiveAlerts = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user?.email || user.isAnonymous) fail("UNAUTHENTICATED");
    await savePreference(ctx, userId, enabled);
  },
});

export const unsubscribe = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (await ctx.db.get(userId)) await savePreference(ctx, userId, false);
  },
});

async function savePreference(
  ctx: MutationCtx,
  userId: Id<"users">,
  liveAlerts: boolean,
) {
  const prefs = await ctx.db
    .query("emailPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (prefs) await ctx.db.patch(prefs._id, { liveAlerts });
  else await ctx.db.insert("emailPreferences", { userId, liveAlerts });
}

// ------------------------------------------------------------ unsubscribe

async function signingKey() {
  const secret =
    process.env.UNSUBSCRIBE_SECRET ?? process.env.JWT_PRIVATE_KEY ?? "";
  if (!secret) throw new Error("No secret to sign unsubscribe links");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`unsubscribe:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function unsubscribeToken(userId: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(userId),
  );
  return `${userId}.${base64url(signature)}`;
}

/** The user id a token was issued for, or null if it was tampered with. */
export async function verifyUnsubscribeToken(token: string) {
  const [userId, signature] = token.split(".");
  if (!userId || !signature) return null;
  const expected = await unsubscribeToken(userId);
  // Equal-length comparison without early exit.
  if (expected.length !== token.length) return null;
  let difference = 0;
  for (let i = 0; i < token.length; i++) {
    difference |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return difference === 0 ? userId : null;
}

export const unsubscribeRoute = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = await verifyUnsubscribeToken(token);
  if (!userId) {
    return page(400, "This unsubscribe link isn't valid.", "");
  }
  if (request.method === "POST") {
    await ctx.runMutation(internal.liveAlerts.unsubscribe, {
      userId: userId as Id<"users">,
    });
    return page(
      200,
      "You're unsubscribed.",
      "You won't get emails when creators you follow open their Hotline. You can turn them back on in Settings → Account.",
    );
  }
  return page(
    200,
    "Stop live alerts?",
    "You'll stop getting emails when creators you follow open their Hotline.",
    `<form method="post"><button type="submit" style="margin-top:16px;padding:12px 20px;border:0;border-radius:8px;background:#e3655b;color:#171715;font-weight:700;font-size:16px;cursor:pointer">Unsubscribe</button></form>`,
  );
});

// ------------------------------------------------------------ content

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function footerLines() {
  const address = process.env.EMAIL_POSTAL_ADDRESS;
  return [
    "You're getting this because you follow this creator on Bling.",
    ...(address ? [address] : []),
  ];
}

function alertText(name: string, hotlineUrl: string, unsubscribeUrl: string) {
  return [
    `${name} just opened their Hotline on Bling.`,
    "",
    `Request a call: ${hotlineUrl}`,
    "",
    "The creator picks who to talk to, so jump in while it's open.",
    "",
    "--",
    ...footerLines(),
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

// Email clients ignore stylesheets and CSS variables, so the brand colors
// are written inline (tokens.css --accent, --mauve, --ebony).
function alertHtml(name: string, hotlineUrl: string, unsubscribeUrl: string) {
  const who = escapeHtml(name);
  const footer = footerLines().map(escapeHtml).join("<br>");
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#52414c">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <p style="margin:0 0 24px;font-size:20px;font-weight:800;color:#e3655b">Bling</p>
    <p style="margin:0 0 8px;font-size:20px;font-weight:800">${who} just opened their Hotline.</p>
    <p style="margin:0 0 24px;font-size:15px">The creator picks who to talk to, so jump in while it's open.</p>
    <a href="${escapeHtml(hotlineUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#e3655b;color:#171715;font-weight:700;text-decoration:none">Request a call</a>
    <p style="margin:32px 0 0;font-size:12px;color:#596157">${footer}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#596157">Unsubscribe</a></p>
  </div>
</body></html>`;
}

function page(status: number, title: string, body: string, extra = "") {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bling</title></head>
<body style="margin:0;padding:24px;background:#161716;color:#f3f1eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:440px;margin:48px auto">
    <p style="margin:0 0 24px;font-size:20px;font-weight:800;color:#e3655b">Bling</p>
    <h1 style="margin:0 0 8px;font-size:24px">${escapeHtml(title)}</h1>
    <p style="margin:0;color:#c8c6bd">${escapeHtml(body)}</p>
    ${extra}
  </div>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
