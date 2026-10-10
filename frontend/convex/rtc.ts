import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { CONNECTABLE_STATUSES, callForParticipant } from "./lib/calls";
import { fail } from "./lib/errors";

// ICE servers for a call participant, with short-lived TURN credentials in
// coturn's shared-secret (REST API) format, as the Go API issues them:
// username "<expiry>:<subject>", credential base64(HMAC-SHA1(secret, username)).
//
// An action, not a query, so a credential is minted per request and never
// served from the query cache after it expires.
//
// Environment (npx convex env set): STUN_URLS (comma-separated, defaults to
// Google's public STUN), TURN_URL, TURN_SHARED_SECRET,
// TURN_CREDENTIAL_TTL_SECONDS (default 900).

type IceServer = { urls: string[]; username?: string; credential?: string };

export const participant = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const { call, role } = await callForParticipant(ctx, callId);
    if (!CONNECTABLE_STATUSES.includes(call.status)) fail("CALL_NOT_FOUND");
    return { subject: role === "creator" ? call.creatorId : call.viewerId };
  },
});

export const config = action({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<{ iceServers: IceServer[] }> => {
    const { subject } = await ctx.runQuery(internal.rtc.participant, {
      callId,
    });
    const stun = (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    const iceServers: IceServer[] = stun.length ? [{ urls: stun }] : [];

    const turnUrl = process.env.TURN_URL;
    const secret = process.env.TURN_SHARED_SECRET;
    if (turnUrl && secret) {
      const ttl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 900);
      iceServers.push({
        urls: [turnUrl],
        ...(await turnCredential(secret, subject, Date.now(), ttl)),
      });
    }
    return { iceServers };
  },
});

export async function turnCredential(
  secret: string,
  subject: string,
  nowMs: number,
  ttlSeconds: number,
) {
  const username = `${Math.floor(nowMs / 1000) + ttlSeconds}:${subject}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(username),
  );
  const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return { username, credential };
}
