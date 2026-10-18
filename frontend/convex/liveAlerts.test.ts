import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { unsubscribeToken } from "./liveAlerts";
import { type Participant, setup } from "./test.helpers";

type Email = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  headers: Record<string, string>;
};

let batches: { idempotencyKey: string | null; emails: Email[] }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AUTH_RESEND_KEY", "re_test");
  vi.stubEnv("AUTH_EMAIL_FROM", "Bling <noreply@bling.test>");
  vi.stubEnv("SITE_URL", "https://blinghotline.com");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("JWT_PRIVATE_KEY", "test-signing-key");
  batches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails/batch");
      const headers = new Headers(init.headers);
      batches.push({
        idempotencyKey: headers.get("Idempotency-Key"),
        emails: JSON.parse(String(init.body)),
      });
      return Response.json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function creatorWithFans() {
  const env = setup();
  const host = await env.creator("alice");
  // Following needs a published profile, which the first draft creates.
  await host.client.mutation(api.shows.create, {});
  const fan = await env.creator("fan");
  const quiet = await env.creator("quiet");
  for (const follower of [fan, quiet]) {
    await follower.client.mutation(api.follows.follow, { username: "alice" });
  }
  await quiet.client.mutation(api.liveAlerts.setLiveAlerts, {
    enabled: false,
  });
  // A guest can't receive email, even with a follow on record.
  const guest = await env.viewer();
  await env.t.run((ctx) =>
    ctx.db.insert("follows", { followerId: guest.id, creatorId: host.id }),
  );
  const run = () => env.t.finishAllScheduledFunctions(vi.runAllTimers);
  return { env, host, fan, quiet, guest, run };
}

async function goLive(host: Participant) {
  const showId = await host.client.mutation(api.shows.create, {});
  await host.client.mutation(api.shows.start, { showId });
  return showId;
}

describe("live alerts", () => {
  it("email signed-in followers who haven't opted out", async () => {
    const { host, run } = await creatorWithFans();
    const showId = await goLive(host);
    await run();

    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch.idempotencyKey).toBe(`live-${showId}-0`);
    expect(batch.emails.map((email) => email.to)).toEqual([["fan@bling.test"]]);
    const [email] = batch.emails;
    expect(email.from).toBe("Bling <noreply@bling.test>");
    expect(email.subject).toBe("alice just opened their Hotline");
    expect(email.text).toContain("https://blinghotline.com/u/alice");
    expect(email.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(email.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/example\.convex\.site\/email\/unsubscribe\?token=/,
    );
  });

  it("send at most once per creator every six hours", async () => {
    const { host, run } = await creatorWithFans();
    const first = await goLive(host);
    await run();
    await host.client.mutation(api.shows.end, { showId: first });
    vi.advanceTimersByTime(60 * 60_000);
    await goLive(host).then(async (showId) => {
      await run();
      await host.client.mutation(api.shows.end, { showId });
    });
    expect(batches).toHaveLength(1);

    vi.advanceTimersByTime(6 * 60 * 60_000);
    await goLive(host);
    await run();
    expect(batches).toHaveLength(2);
  });

  it("skip a Hotline that closed before the alert went out", async () => {
    const { host, run } = await creatorWithFans();
    const showId = await goLive(host);
    await host.client.mutation(api.shows.end, { showId });
    await run();
    expect(batches).toHaveLength(0);
  });

  it("go out in batches of 100", async () => {
    const { env, host, run } = await creatorWithFans();
    await env.t.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        const followerId = await ctx.db.insert("users", {
          email: `follower${i}@bling.test`,
        });
        await ctx.db.insert("follows", { followerId, creatorId: host.id });
      }
    });
    const showId = await goLive(host);
    await run();
    expect(batches.map((batch) => batch.idempotencyKey)).toEqual([
      `live-${showId}-0`,
      `live-${showId}-1`,
    ]);
    // fan, plus the 150 (quiet opted out, the guest has no email).
    expect(batches.flatMap((batch) => batch.emails)).toHaveLength(151);
  });
});

describe("unsubscribing", () => {
  const link = (token: string) =>
    `/email/unsubscribe?token=${encodeURIComponent(token)}`;

  it("asks first, then turns alerts off", async () => {
    const { env, fan } = await creatorWithFans();
    const token = await unsubscribeToken(fan.id);
    const preference = async () =>
      (await fan.client.query(api.liveAlerts.preferences, {}))?.liveAlerts;

    // Opening the link (or a mail scanner opening it) changes nothing.
    const confirm = await env.t.fetch(link(token), { method: "GET" });
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain('<form method="post">');
    expect(await preference()).toBe(true);

    const done = await env.t.fetch(link(token), {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    });
    expect(done.status).toBe(200);
    expect(await preference()).toBe(false);
  });

  it("rejects a token signed for someone else", async () => {
    const { env, fan, quiet } = await creatorWithFans();
    const theirs = await unsubscribeToken(quiet.id);
    const forged = `${fan.id}.${theirs.split(".")[1]}`;
    const response = await env.t.fetch(link(forged), { method: "POST" });
    expect(response.status).toBe(400);
    expect(
      (await fan.client.query(api.liveAlerts.preferences, {}))?.liveAlerts,
    ).toBe(true);
  });
});

describe("email preferences", () => {
  it("default to on and can be switched", async () => {
    const { fan } = await creatorWithFans();
    expect(await fan.client.query(api.liveAlerts.preferences, {})).toEqual({
      email: "fan@bling.test",
      liveAlerts: true,
    });
    await fan.client.mutation(api.liveAlerts.setLiveAlerts, { enabled: false });
    await fan.client.mutation(api.liveAlerts.setLiveAlerts, { enabled: true });
    expect(
      (await fan.client.query(api.liveAlerts.preferences, {}))?.liveAlerts,
    ).toBe(true);
  });

  it("are not offered to guests", async () => {
    const { guest } = await creatorWithFans();
    expect(await guest.client.query(api.liveAlerts.preferences, {})).toBeNull();
  });
});
