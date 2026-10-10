import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { expectCode, free, liveShow, setup } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("shows", () => {
  it("creates a show with one free Standard tier", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    const showId = await host.client.mutation(api.shows.create, {});
    const tiers = await host.client.query(api.tiers.forCreator, { showId });
    expect(tiers).toMatchObject([
      { name: "Standard", priceCents: 0, enabled: true },
    ]);
    expect(await host.client.query(api.shows.current, {})).toMatchObject({
      _id: showId,
      status: "CREATED",
    });
  });

  it("does not let anonymous viewers create shows", async () => {
    const { viewer } = setup();
    const caller = await viewer();
    await expectCode(
      caller.client.mutation(api.shows.create, {}),
      "UNAUTHENTICATED",
    );
  });

  it("allows one live show per creator", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    await liveShow(host);
    const second = await host.client.mutation(api.shows.create, {});
    await expectCode(
      host.client.mutation(api.shows.start, { showId: second }),
      "ACTIVE_SHOW_EXISTS",
    );
  });

  it("blocks paid shows until the creator finishes payout setup", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    const showId = await host.client.mutation(api.shows.create, {});
    await host.client.mutation(api.tiers.replace, {
      showId,
      tiers: [{ ...free("VIP"), priceCents: 500 }],
    });
    await expectCode(
      host.client.mutation(api.shows.start, { showId }),
      "PAYOUT_SETUP_REQUIRED",
    );
  });

  it("finds the live show by username", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host);
    expect(
      await host.client.query(api.shows.liveByUsername, { username: "Alice" }),
    ).toMatchObject({ _id: showId, status: "LIVE" });
  });
});

describe("tiers", () => {
  it("ranks tiers by the order given and locks them once live", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    const { showId, vip, standard } = await liveShow(host);
    expect(vip).toMatchObject({ name: "VIP", priorityRank: 200 });
    expect(standard).toMatchObject({ name: "Standard", priorityRank: 100 });
    await expectCode(
      host.client.mutation(api.tiers.replace, {
        showId,
        tiers: [free("Other")],
      }),
      "SHOW_NOT_CONFIGURABLE",
    );
  });

  it.each([
    ["no tiers", []],
    ["six tiers", Array.from({ length: 6 }, (_, i) => free(`T${i}`))],
    ["duplicate names", [free("VIP"), free("vip ")]],
    ["none enabled", [{ ...free("VIP"), enabled: false }]],
    ["price under 50 cents", [{ ...free("VIP"), priceCents: 49 }]],
    ["call under 30 seconds", [{ ...free("VIP"), callDurationSeconds: 29 }]],
  ])("rejects %s", async (_, tiers) => {
    const { creator } = setup();
    const host = await creator("alice");
    const showId = await host.client.mutation(api.shows.create, {});
    await expectCode(
      host.client.mutation(api.tiers.replace, { showId, tiers }),
      "INVALID_TIER_CONFIGURATION",
    );
  });
});

describe("queue", () => {
  it("joins once per caller and never reports a place in line", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId, standard } = await liveShow(host);
    const caller = await viewer();

    const request = {
      showId,
      tierId: standard._id,
      displayName: " Sam ",
      topic: "My launch",
    };
    const first = await caller.client.mutation(api.queue.join, request);
    const retry = await caller.client.mutation(api.queue.join, request);
    expect(retry._id).toBe(first._id);
    expect(first).toMatchObject({ displayName: "Sam", status: "WAITING" });

    const mine = await caller.client.query(api.queue.mine, { showId });
    expect(mine?._id).toBe(first._id);
    expect(mine).not.toHaveProperty("position");
  });

  it("lists waiting callers by tier, then join time", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId, vip, standard } = await liveShow(host);
    const join = async (name: string, tierId: Id<"showTiers">) => {
      const caller = await viewer();
      vi.advanceTimersByTime(1000);
      await caller.client.mutation(api.queue.join, {
        showId,
        tierId,
        displayName: name,
        topic: "Hi",
      });
      return caller;
    };
    await join("standard-1", standard._id);
    const leaver = await join("vip-1", vip._id);
    await join("vip-2", vip._id);
    await join("standard-2", standard._id);
    await leaver.client.mutation(api.queue.leave, { showId });

    const waiting = await host.client.query(api.queue.waiting, { showId });
    expect(waiting.map((entry) => entry.displayName)).toEqual([
      "vip-2",
      "standard-1",
      "standard-2",
    ]);
  });

  it("lets a caller who left join again", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host);
    const caller = await viewer();
    const request = { showId, displayName: "Sam", topic: "Hi" };
    const first = await caller.client.mutation(api.queue.join, request);
    expect(
      await caller.client.mutation(api.queue.leave, { showId }),
    ).toMatchObject({ status: "LEFT" });
    const again = await caller.client.mutation(api.queue.join, request);
    expect(again).toMatchObject({ _id: first._id, status: "WAITING" });
    expect(again.leftAt).toBeUndefined();
  });

  it("rejects joins to a show that is not live", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const caller = await viewer();
    const draft = await host.client.mutation(api.shows.create, {});
    await expectCode(
      caller.client.mutation(api.queue.join, {
        showId: draft,
        displayName: "Sam",
        topic: "Hi",
      }),
      "SHOW_NOT_LIVE",
    );
  });

  it("requires payment for a paid tier", async () => {
    const { t, creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host);
    // Starting a paid show needs payout setup, so add the tier directly.
    const paidTier = await t.run((ctx) =>
      ctx.db.insert("showTiers", {
        showId,
        name: "Paid",
        priorityRank: 300,
        callDurationSeconds: 300,
        priceCents: 500,
        enabled: true,
      }),
    );
    const caller = await viewer();
    await expectCode(
      caller.client.mutation(api.queue.join, {
        showId,
        tierId: paidTier,
        displayName: "Sam",
        topic: "Hi",
      }),
      "PAYMENT_REQUIRED",
    );
  });

  it("keeps other creators out of the queue", async () => {
    const { creator } = setup();
    const host = await creator("alice");
    const other = await creator("bob");
    const { showId } = await liveShow(host);
    await expectCode(
      other.client.query(api.queue.waiting, { showId }),
      "SHOW_NOT_FOUND",
    );
  });

  it("ends every active entry in batches when the show ends", async () => {
    const { t, creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host);
    for (let i = 0; i < 205; i++) {
      const caller = await viewer();
      await caller.client.mutation(api.queue.join, {
        showId,
        displayName: `Caller ${i}`,
        topic: "Hi",
      });
    }
    await host.client.mutation(api.shows.end, { showId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const statuses = await t.run(async (ctx) =>
      (await ctx.db.query("queueEntries").collect()).map(
        (entry) => entry.status,
      ),
    );
    expect(statuses).toHaveLength(205);
    expect(new Set(statuses)).toEqual(new Set(["ENDED"]));
    expect(await host.client.query(api.queue.waiting, { showId })).toEqual([]);
  });
});
