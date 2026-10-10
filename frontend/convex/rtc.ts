import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { CONNECTABLE_STATUSES, callForParticipant } from "./lib/calls";
import { fail } from "./lib/errors";

// ICE servers for a call participant. TURN relays the audio when the two
// devices can't reach each other directly (some cellular carriers, office
// and school networks). Two relay setups are supported:
//
// - Cloudflare's managed TURN (preferred): CLOUDFLARE_TURN_KEY_ID and
//   CLOUDFLARE_TURN_API_TOKEN. Each request mints short-lived credentials
//   (developers.cloudflare.com/realtime/turn/generate-credentials).
// - A self-hosted coturn with a shared secret, as the Go API issues them:
//   TURN_URL and TURN_SHARED_SECRET, username "<expiry>:<subject>",
//   credential base64(HMAC-SHA1(secret, username)).
//
// An action, not a query, so a credential is minted per request and never
// served from the query cache after it expires.
//
// Environment (npx convex env set): the above, STUN_URLS (comma-separated,
// defaults to Google's public STUN; unused with Cloudflare, which returns its
// own), TURN_CREDENTIAL_TTL_SECONDS (default 900 for coturn, 4 hours for
// Cloudflare, which must outlast the longest call).

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
    const cloudflare = await cloudflareIceServers();
    if (cloudflare) return { iceServers: cloudflare };

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

const CLOUDFLARE_TTL_SECONDS = 4 * 60 * 60;

/**
 * Fresh STUN and TURN servers from Cloudflare, or null when Cloudflare isn't
 * configured. If Cloudflare can't be reached the call still gets public STUN,
 * which connects most calls directly, rather than failing outright.
 */
async function cloudflareIceServers(): Promise<IceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;
  const ttl = Number(
    process.env.TURN_CREDENTIAL_TTL_SECONDS ?? CLOUDFLARE_TTL_SECONDS,
  );
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl }),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare TURN ${response.status}`);
    const { iceServers } = (await response.json()) as {
      iceServers?: IceServer[] | IceServer;
    };
    const servers = (
      Array.isArray(iceServers) ? iceServers : iceServers ? [iceServers] : []
    )
      .map((server) => ({
        ...server,
        // Browsers block port 53, so those URLs only ever time out.
        urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)),
      }))
      .filter((server) => server.urls.length);
    if (!servers.length) throw new Error("Cloudflare TURN returned no servers");
    return servers;
  } catch (error) {
    console.error("TURN credentials unavailable; using STUN only", error);
    return [{ urls: ["stun:stun.cloudflare.com:3478"] }];
  }
}

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
