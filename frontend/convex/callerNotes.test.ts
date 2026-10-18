import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { expectCode, free, liveShow, setup } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const join = { displayName: "Sam", topic: "My launch" };

describe("caller insight", () => {
  it("marks a first-time caller who does not follow", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host, [free("Standard")]);
    const caller = await viewer();
    await caller.client.mutation(api.queue.join, { showId, ...join });

    const [entry] = await host.client.query(api.queue.waiting, { showId });
    expect(entry.caller).toEqual({ follower: false, pastCalls: 0, note: "" });
  });

  it("counts calls that went live on earlier shows, and follows", async () => {
    const { t, creator, viewer } = setup();
    const host = await creator("alice");
    const caller = await viewer();
    await t.run((ctx) =>
      ctx.db.insert("follows", { followerId: caller.id, creatorId: host.id }),
    );

    // One earlier call that went live.
    const first = await liveShow(host, [free("Standard")]);
    const entry = await caller.client.mutation(api.queue.join, {
      showId: first.showId,
      ...join,
    });
    const call = await host.client.mutation(api.calls.select, {
      showId: first.showId,
      entryId: entry._id,
    });
    for (const status of ["CONNECTING", "LIVE"] as const) {
      await host.client.mutation(api.calls.transition, {
        callId: call._id,
        status,
      });
    }
    await host.client.mutation(api.shows.end, { showId: first.showId });

    const second = await liveShow(host, [free("Standard")]);
    await caller.client.mutation(api.queue.join, {
      showId: second.showId,
      ...join,
    });
    const [waiting] = await host.client.query(api.queue.waiting, {
      showId: second.showId,
    });
    expect(waiting.caller).toEqual({ follower: true, pastCalls: 1, note: "" });
  });

  it("never shows a caller the creator's view of them", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host, [free("Standard")]);
    const caller = await viewer();
    await caller.client.mutation(api.queue.join, { showId, ...join });
    const mine = await caller.client.query(api.queue.mine, { showId });
    expect(mine).not.toHaveProperty("caller");
  });
});

describe("caller notes", () => {
  it("keeps a note with the caller across shows, and deletes it when cleared", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const caller = await viewer();
    const first = await liveShow(host, [free("Standard")]);
    const entry = await caller.client.mutation(api.queue.join, {
      showId: first.showId,
      ...join,
    });
    await host.client.mutation(api.callerNotes.save, {
      entryId: entry._id,
      note: "  Asked about pricing last time  ",
    });
    await host.client.mutation(api.shows.end, { showId: first.showId });

    const second = await liveShow(host, [free("Standard")]);
    const rejoined = await caller.client.mutation(api.queue.join, {
      showId: second.showId,
      ...join,
    });
    let [waiting] = await host.client.query(api.queue.waiting, {
      showId: second.showId,
    });
    expect(waiting.caller.note).toBe("Asked about pricing last time");

    await host.client.mutation(api.callerNotes.save, {
      entryId: rejoined._id,
      note: " ",
    });
    [waiting] = await host.client.query(api.queue.waiting, {
      showId: second.showId,
    });
    expect(waiting.caller.note).toBe("");
  });

  it("only lets the show's creator write notes", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const other = await creator("bob");
    const { showId } = await liveShow(host, [free("Standard")]);
    const caller = await viewer();
    const entry = await caller.client.mutation(api.queue.join, {
      showId,
      ...join,
    });
    await expectCode(
      other.client.mutation(api.callerNotes.save, {
        entryId: entry._id,
        note: "Hi",
      }),
      "SHOW_NOT_FOUND",
    );
    await expectCode(
      caller.client.mutation(api.callerNotes.save, {
        entryId: entry._id,
        note: "Hi",
      }),
      "UNAUTHENTICATED",
    );
  });

  it("limits notes to 500 characters", async () => {
    const { creator, viewer } = setup();
    const host = await creator("alice");
    const { showId } = await liveShow(host, [free("Standard")]);
    const caller = await viewer();
    const entry = await caller.client.mutation(api.queue.join, {
      showId,
      ...join,
    });
    await expectCode(
      host.client.mutation(api.callerNotes.save, {
        entryId: entry._id,
        note: "x".repeat(501),
      }),
      "VALIDATION_FAILED",
    );
  });
});
