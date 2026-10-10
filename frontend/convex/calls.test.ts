import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  DISCONNECT_GRACE_MS,
  HEARTBEAT_MS,
  PRESENCE_TTL_MS,
} from "./lib/calls";
import { turnCredential } from "./rtc";
import {
  expectCode,
  free,
  liveShow,
  type Participant,
  setup,
} from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A live show, one waiting caller, and the creator connected to them. */
async function connectedCall(callDurationSeconds = 300) {
  const env = setup();
  const host = await env.creator("alice");
  const { showId } = await liveShow(host, [
    { ...free("Standard"), callDurationSeconds },
  ]);
  const caller = await env.viewer();
  const entry = await caller.client.mutation(api.queue.join, {
    showId,
    displayName: "Sam",
    topic: "My launch",
  });
  const call = await host.client.mutation(api.calls.select, {
    showId,
    entryId: entry._id,
  });
  return { ...env, host, caller, showId, entry, callId: call._id };
}

async function joinAs(
  viewer: () => Promise<Participant>,
  showId: Id<"shows">,
  tierId: Id<"showTiers">,
  displayName: string,
) {
  const caller = await viewer();
  vi.advanceTimersByTime(1000);
  return caller.client.mutation(api.queue.join, {
    showId,
    tierId,
    displayName,
    topic: "Hi",
  });
}

describe("choosing a caller", () => {
  it("connects the creator to the caller they picked", async () => {
    const { host, caller, showId, entry, callId } = await connectedCall();

    const active = await host.client.query(api.calls.active, { showId });
    expect(active).toMatchObject({
      _id: callId,
      status: "CREATED",
      selectionMode: "MANUAL",
      caller: { displayName: "Sam", topic: "My launch" },
    });
    expect(await caller.client.query(api.calls.mine, { showId })).toMatchObject(
      { _id: callId, status: "CREATED" },
    );
    expect(await caller.client.query(api.queue.mine, { showId })).toMatchObject(
      { _id: entry._id, status: "SELECTED" },
    );
    expect(await host.client.query(api.queue.waiting, { showId })).toEqual([]);
  });

  it("allows one open call per show", async () => {
    const { host, viewer, showId } = await connectedCall();
    const tiers = await host.client.query(api.tiers.forCreator, { showId });
    const second = await joinAs(viewer, showId, tiers[0]._id, "Ana");
    await expectCode(
      host.client.mutation(api.calls.select, { showId, entryId: second._id }),
      "ACTIVE_CALL_EXISTS",
    );
  });

  it("refuses a caller who already left", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId, standard } = await liveShow(host);
    const caller = await viewer();
    const entry = await caller.client.mutation(api.queue.join, {
      showId,
      tierId: standard._id,
      displayName: "Sam",
      topic: "Hi",
    });
    await caller.client.mutation(api.queue.leave, { showId });
    await expectCode(
      host.client.mutation(api.calls.select, { showId, entryId: entry._id }),
      "CALLER_NOT_WAITING",
    );
  });

  it("picks at random from the highest tier with anyone waiting", async () => {
    const { t, creator, viewer } = setup();
    const host = await creator("alice");
    const { showId, vip, standard } = await liveShow(host);
    await expectCode(
      host.client.mutation(api.calls.selectRandom, { showId }),
      "QUEUE_EMPTY",
    );

    await joinAs(viewer, showId, standard._id, "standard");
    const vipNames = ["vip-1", "vip-2", "vip-3", "vip-4"];
    for (const name of vipNames) await joinAs(viewer, showId, vip._id, name);

    const picked = new Set<string>();
    for (let round = 0; round < 40; round++) {
      const call = await host.client.mutation(api.calls.selectRandom, {
        showId,
      });
      picked.add(call.caller!.displayName);
      // Put the caller back so every round draws from the same tier.
      await host.client.mutation(api.calls.transition, {
        callId: call._id,
        status: "ENDED",
      });
      await t.run((ctx) =>
        ctx.db.patch(call.queueEntryId, { status: "WAITING" }),
      );
    }
    expect([...picked].every((name) => vipNames.includes(name))).toBe(true);
    expect(picked.size).toBeGreaterThan(1);
  });
});

describe("call lifecycle", () => {
  it("moves through CONNECTING and LIVE, then ends on time", async () => {
    const { t, host, caller, showId, entry, callId } = await connectedCall(60);
    await host.client.mutation(api.calls.transition, {
      callId,
      status: "CONNECTING",
    });
    const live = await caller.client.mutation(api.calls.transition, {
      callId,
      status: "LIVE",
    });
    expect(live.status).toBe("LIVE");
    expect(live.expiresAt! - live.startedAt!).toBe(60_000);
    expect(await caller.client.query(api.queue.mine, { showId })).toMatchObject(
      { _id: entry._id, status: "LIVE" },
    );

    vi.advanceTimersByTime(60_000);
    await t.finishInProgressScheduledFunctions();
    expect(await caller.client.query(api.calls.mine, { showId })).toMatchObject(
      { status: "ENDED" },
    );
    expect(await host.client.query(api.calls.active, { showId })).toBeNull();
  });

  it("only lets each side make its own moves", async () => {
    const { host, caller, callId } = await connectedCall();
    await expectCode(
      caller.client.mutation(api.calls.transition, {
        callId,
        status: "CONNECTING",
      }),
      "INVALID_CALL_STATE",
    );
    await host.client.mutation(api.calls.transition, {
      callId,
      status: "ENDED",
    });
    await expectCode(
      host.client.mutation(api.calls.transition, { callId, status: "LIVE" }),
      "INVALID_CALL_STATE",
    );
  });

  it("hides calls from everyone but the two participants", async () => {
    const { creator, viewer, callId } = await connectedCall();
    const outsiders = [await creator("bob"), await viewer()];
    for (const outsider of outsiders) {
      await expectCode(
        outsider.client.mutation(api.calls.transition, {
          callId,
          status: "ENDED",
        }),
        "CALL_NOT_FOUND",
      );
      await expectCode(
        outsider.client.query(api.signals.inbox, { callId }),
        "CALL_NOT_FOUND",
      );
    }
  });

  it("ends the open call when the show ends", async () => {
    const { host, caller, showId } = await connectedCall();
    await host.client.mutation(api.shows.end, { showId });
    expect(await caller.client.query(api.calls.mine, { showId })).toMatchObject(
      { status: "ENDED" },
    );
  });
});

describe("signaling", () => {
  const sdp = JSON.stringify({ sdp: { type: "offer", sdp: "v=0" } });
  const ice = (n: number) =>
    JSON.stringify({ candidate: { candidate: `candidate:${n}` } });

  it("delivers each side's signals to the other, in order", async () => {
    const { host, caller, callId } = await connectedCall();
    await caller.client.mutation(api.signals.send, {
      callId,
      signals: [{ type: "signal.ready", payload: "{}" }],
    });
    vi.advanceTimersByTime(1);
    await host.client.mutation(api.signals.send, {
      callId,
      signals: [{ type: "signal.offer", payload: sdp }],
    });
    vi.advanceTimersByTime(1);
    await host.client.mutation(api.signals.send, {
      callId,
      signals: [1, 2, 3].map((n) => ({
        type: "signal.ice" as const,
        payload: ice(n),
      })),
    });

    const forCaller = await caller.client.query(api.signals.inbox, { callId });
    expect(forCaller.map((signal) => signal.type)).toEqual([
      "signal.offer",
      "signal.ice",
      "signal.ice",
      "signal.ice",
    ]);
    expect(forCaller[0].payload).toBe(sdp);
    expect(
      (await host.client.query(api.signals.inbox, { callId })).map(
        (signal) => signal.type,
      ),
    ).toEqual(["signal.ready"]);
  });

  it("removes signals once the recipient acknowledges them", async () => {
    const { host, caller, callId } = await connectedCall();
    await host.client.mutation(api.signals.send, {
      callId,
      signals: [{ type: "signal.offer", payload: sdp }],
    });
    const inbox = await caller.client.query(api.signals.inbox, { callId });
    // A participant cannot delete signals addressed to someone else.
    await host.client.mutation(api.signals.ack, {
      callId,
      ids: inbox.map((signal) => signal._id),
    });
    expect(
      await caller.client.query(api.signals.inbox, { callId }),
    ).toHaveLength(1);
    await caller.client.mutation(api.signals.ack, {
      callId,
      ids: inbox.map((signal) => signal._id),
    });
    expect(await caller.client.query(api.signals.inbox, { callId })).toEqual(
      [],
    );
  });

  it("keeps one pending ready announcement", async () => {
    const { host, caller, callId } = await connectedCall();
    for (let pulse = 0; pulse < 5; pulse++) {
      await caller.client.mutation(api.signals.send, {
        callId,
        signals: [{ type: "signal.ready", payload: "{}" }],
      });
    }
    expect(await host.client.query(api.signals.inbox, { callId })).toHaveLength(
      1,
    );
  });

  it("rejects signals a role may not send and malformed payloads", async () => {
    const { host, caller, callId } = await connectedCall();
    await expectCode(
      caller.client.mutation(api.signals.send, {
        callId,
        signals: [{ type: "signal.offer", payload: sdp }],
      }),
      "INVALID_SIGNAL",
    );
    await expectCode(
      host.client.mutation(api.signals.send, {
        callId,
        signals: [{ type: "signal.answer", payload: sdp }],
      }),
      "INVALID_SIGNAL",
    );
    await expectCode(
      host.client.mutation(api.signals.send, {
        callId,
        signals: [{ type: "signal.ice", payload: "not json" }],
      }),
      "INVALID_SIGNAL",
    );
    await expectCode(
      host.client.mutation(api.signals.send, {
        callId,
        signals: [
          { type: "signal.offer", payload: JSON.stringify("x".repeat(70_000)) },
        ],
      }),
      "INVALID_SIGNAL",
    );
  });

  it("stops signaling and clears leftovers when the call finishes", async () => {
    const { t, host, callId } = await connectedCall();
    await host.client.mutation(api.signals.send, {
      callId,
      signals: [{ type: "signal.offer", payload: sdp }],
    });
    await host.client.mutation(api.calls.transition, {
      callId,
      status: "ENDED",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("callSignals").collect())).toEqual(
      [],
    );
    await expectCode(
      host.client.mutation(api.signals.send, {
        callId,
        signals: [{ type: "signal.offer", payload: sdp }],
      }),
      "CALL_NOT_FOUND",
    );
  });
});

describe("presence", () => {
  it("fails the call when a participant stays gone past the grace", async () => {
    const { t, host, caller, showId, entry, callId } = await connectedCall();
    await host.client.mutation(api.presence.heartbeat, { callId });
    await caller.client.mutation(api.presence.heartbeat, { callId });

    // The creator keeps beating; the caller goes silent.
    const beatUntil = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += HEARTBEAT_MS) {
        vi.advanceTimersByTime(HEARTBEAT_MS);
        await t.finishInProgressScheduledFunctions();
        await host.client.mutation(api.presence.heartbeat, { callId });
      }
    };
    await beatUntil(PRESENCE_TTL_MS);
    expect(await host.client.query(api.calls.active, { showId })).toMatchObject(
      { status: "CREATED", viewerDisconnectedAt: expect.any(Number) },
    );
    expect(
      (await host.client.query(api.calls.active, { showId }))
        ?.creatorDisconnectedAt,
    ).toBeUndefined();

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    await t.finishInProgressScheduledFunctions();
    expect(await caller.client.query(api.calls.mine, { showId })).toMatchObject(
      { status: "FAILED" },
    );
    expect(await caller.client.query(api.queue.mine, { showId })).toMatchObject(
      { _id: entry._id, status: "ENDED" },
    );
  });

  it("recovers when heartbeats return within the grace", async () => {
    const { t, host, caller, showId, callId } = await connectedCall();
    await caller.client.mutation(api.presence.heartbeat, { callId });
    vi.advanceTimersByTime(PRESENCE_TTL_MS);
    await t.finishInProgressScheduledFunctions();
    expect(
      (await host.client.query(api.calls.active, { showId }))
        ?.viewerDisconnectedAt,
    ).toEqual(expect.any(Number));

    await caller.client.mutation(api.presence.heartbeat, { callId });
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    await t.finishInProgressScheduledFunctions();
    const call = await host.client.query(api.calls.active, { showId });
    expect(call?.status).toBe("CREATED");
    expect(call?.viewerDisconnectedAt).toBeUndefined();
  });

  it("starts the grace immediately when a participant leaves the page", async () => {
    const { t, caller, showId, callId } = await connectedCall();
    await caller.client.mutation(api.presence.heartbeat, { callId });
    await caller.client.mutation(api.presence.leave, { callId });
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    await t.finishInProgressScheduledFunctions();
    expect(await caller.client.query(api.calls.mine, { showId })).toMatchObject(
      { status: "FAILED" },
    );
  });
});

describe("RTC configuration", () => {
  it("signs TURN credentials the way coturn expects", async () => {
    // Reference value computed independently with Python's hmac module.
    expect(
      await turnCredential("shared-secret", "user123", 1_700_000_000_000, 900),
    ).toEqual({
      username: "1700000900:user123",
      credential: "T+h9WqxNuZraJbIX3OBP+vo5SeE=",
    });
  });

  it("gives participants STUN and TURN servers", async () => {
    vi.stubEnv("STUN_URLS", "stun:stun.example.test:3478");
    vi.stubEnv("TURN_URL", "turn:turn.blinghotline.com:3478");
    vi.stubEnv("TURN_SHARED_SECRET", "shared-secret");
    const { caller, creator, callId } = await connectedCall();
    const { iceServers } = await caller.client.action(api.rtc.config, {
      callId,
    });
    expect(iceServers).toEqual([
      { urls: ["stun:stun.example.test:3478"] },
      {
        urls: ["turn:turn.blinghotline.com:3478"],
        username: expect.stringMatching(new RegExp(`:${caller.id}$`)),
        credential: expect.any(String),
      },
    ]);
    const outsider = await creator("bob");
    await expectCode(
      outsider.client.action(api.rtc.config, { callId }),
      "CALL_NOT_FOUND",
    );
  });

  describe("with Cloudflare TURN", () => {
    beforeEach(() => {
      vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", "key-id");
      vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "api-token");
      // Cloudflare wins over a coturn configuration.
      vi.stubEnv("TURN_URL", "turn:turn.blinghotline.com:3478");
      vi.stubEnv("TURN_SHARED_SECRET", "shared-secret");
    });
    afterEach(() => vi.unstubAllGlobals());

    it("mints credentials per request and drops port 53", async () => {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(
          "https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers",
        );
        expect(new Headers(init.headers).get("Authorization")).toBe(
          "Bearer api-token",
        );
        expect(JSON.parse(String(init.body))).toEqual({ ttl: 4 * 60 * 60 });
        return Response.json(
          {
            iceServers: [
              {
                urls: [
                  "stun:stun.cloudflare.com:3478",
                  "stun:stun.cloudflare.com:53",
                ],
              },
              {
                urls: [
                  "turn:turn.cloudflare.com:3478?transport=udp",
                  "turn:turn.cloudflare.com:53?transport=udp",
                  "turns:turn.cloudflare.com:443?transport=tcp",
                ],
                username: "cf-user",
                credential: "cf-secret",
              },
            ],
          },
          { status: 201 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const { caller, callId } = await connectedCall();

      expect(await caller.client.action(api.rtc.config, { callId })).toEqual({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478"] },
          {
            urls: [
              "turn:turn.cloudflare.com:3478?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "cf-user",
            credential: "cf-secret",
          },
        ],
      });
      await caller.client.action(api.rtc.config, { callId });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("falls back to STUN when Cloudflare is unreachable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("unavailable", { status: 503 })),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { caller, callId } = await connectedCall();
      expect(await caller.client.action(api.rtc.config, { callId })).toEqual({
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      });
    });
  });
});
