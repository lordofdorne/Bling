import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { NOTIFICATION_WINDOW_MS } from "./lib/social";
import { expectCode, type Participant, setup } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const DAY = 24 * 60 * 60_000;

async function goLive(host: Participant) {
  const showId = await host.client.mutation(api.shows.create, {});
  await host.client.mutation(api.shows.start, { showId });
  return showId;
}

async function publish(host: Participant) {
  await host.client.mutation(api.shows.create, {});
}

/** Runs due scheduled work (projections, counts) without running forever. */
async function settle(env: ReturnType<typeof setup>, ms: number) {
  vi.advanceTimersByTime(ms);
  await env.t.finishInProgressScheduledFunctions();
}

describe("profiles", () => {
  it("are private until the creator's first show, then public", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const visitor = await env.viewer();
    expect(
      await visitor.client.query(api.profiles.get, { username: "alice" }),
    ).toBeNull();
    expect(
      await host.client.query(api.profiles.get, { username: "alice" }),
    ).toMatchObject({ published: false });
    await publish(host);
    expect(
      await visitor.client.query(api.profiles.get, { username: "ALICE" }),
    ).toMatchObject({
      username: "alice",
      displayName: "alice",
      published: true,
      isLive: false,
      isFollowing: false,
    });
  });

  it("saves details, accepts only https images, and keeps live profiles published", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const details = {
      displayName: " Alice A. ",
      bio: "Startup advice",
      coverUrl: "https://img.test/c.png",
      published: true,
    };
    expect(
      await host.client.mutation(api.profiles.save, details),
    ).toMatchObject({ displayName: "Alice A.", published: true });
    await expectCode(
      host.client.mutation(api.profiles.save, {
        ...details,
        coverUrl: "http://img.test/c.png",
      }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      host.client.mutation(api.profiles.save, { ...details, displayName: " " }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      host.client.mutation(api.profiles.save, {
        ...details,
        bio: "x".repeat(501),
      }),
      "VALIDATION_FAILED",
    );
    await goLive(host);
    expect(
      await host.client.mutation(api.profiles.save, {
        ...details,
        published: false,
      }),
    ).toMatchObject({ published: true });
  });

  it("stores uploaded avatars, rejecting the wrong type, size or owner", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const other = await env.creator("bob");
    // Real file signatures; the browser's Content-Type is not trusted.
    const signatures = {
      png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      jpeg: [0xff, 0xd8, 0xff, 0xe0],
      webp: [..."RIFF"]
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [..."WEBP"].map((c) => c.charCodeAt(0)),
        ),
      gif: [..."GIF89a"].map((c) => c.charCodeAt(0)),
    };
    const upload = (
      kind: keyof typeof signatures,
      bytes = 1000,
      type = "image/png",
    ) => {
      const data = new Uint8Array(bytes);
      data.set(signatures[kind]);
      return env.t.run((ctx) => ctx.storage.store(new Blob([data], { type })));
    };

    const avatar = await upload("png");
    expect(
      (await host.client.action(api.profiles.setAvatar, { storageId: avatar }))
        .avatarUrl,
    ).toMatch(/^https?:\/\//);
    await expectCode(
      other.client.action(api.profiles.setAvatar, { storageId: avatar }),
      "INVALID_AVATAR",
    );
    // Someone else's attached avatar survives a failed claim.
    expect(await env.t.run((ctx) => ctx.storage.getUrl(avatar))).not.toBeNull();

    const huge = await upload("png", 768 * 1024 + 1);
    await expectCode(
      host.client.action(api.profiles.setAvatar, { storageId: huge }),
      "INVALID_AVATAR",
    );
    const disguised = await upload("gif", 1000, "image/png");
    await expectCode(
      host.client.action(api.profiles.setAvatar, { storageId: disguised }),
      "INVALID_AVATAR",
    );
    // Rejected files are not kept.
    expect(await env.t.run((ctx) => ctx.storage.getUrl(huge))).toBeNull();
    expect(await env.t.run((ctx) => ctx.storage.getUrl(disguised))).toBeNull();
    await host.client.action(api.profiles.setAvatar, {
      storageId: await upload("jpeg"),
    });

    // Replacing or removing an avatar deletes the old file.
    const next = await upload("webp");
    await host.client.action(api.profiles.setAvatar, { storageId: next });
    expect(await env.t.run((ctx) => ctx.storage.getUrl(avatar))).toBeNull();
    const removed = await host.client.mutation(api.profiles.save, {
      displayName: "alice",
      bio: "",
      coverUrl: "",
      published: false,
      avatarUrl: "",
    });
    expect(removed.avatarUrl).toBe("");
    expect(await env.t.run((ctx) => ctx.storage.getUrl(next))).toBeNull();
  });
});

describe("follows", () => {
  it("are idempotent and need a real account and a published creator", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const fan = await env.creator("bob");
    const guest = await env.viewer();
    await expectCode(
      fan.client.mutation(api.follows.follow, { username: "alice" }),
      "CREATOR_NOT_FOUND",
    );
    await publish(host);
    expect(
      await fan.client.mutation(api.follows.follow, { username: "alice" }),
    ).toEqual({ isFollowing: true });
    expect(
      await fan.client.mutation(api.follows.follow, { username: "alice" }),
    ).toEqual({ isFollowing: true });
    expect(await fan.client.query(api.follows.followingCount, {})).toEqual({
      count: 1,
    });
    await expectCode(
      host.client.mutation(api.follows.follow, { username: "alice" }),
      "SELF_FOLLOW",
    );
    await expectCode(
      guest.client.mutation(api.follows.follow, { username: "alice" }),
      "UNAUTHENTICATED",
    );
    expect(
      await fan.client.mutation(api.follows.unfollow, { username: "alice" }),
    ).toEqual({ isFollowing: false });
    expect(await fan.client.query(api.follows.followingCount, {})).toEqual({
      count: 0,
    });
  });

  it("projects follower counts from shards a few seconds later", async () => {
    const env = setup();
    const host = await env.creator("alice");
    await publish(host);
    const fans = await Promise.all(
      Array.from({ length: 40 }, (_, i) => env.creator(`fan_${i}`)),
    );
    await Promise.all(
      fans.map((fan) =>
        fan.client.mutation(api.follows.follow, { username: "alice" }),
      ),
    );
    await fans[0].client.mutation(api.follows.unfollow, { username: "alice" });
    expect((await host.client.query(api.profiles.mine, {})).followerCount).toBe(
      0,
    );

    await settle(env, 5_000);
    expect((await host.client.query(api.profiles.mine, {})).followerCount).toBe(
      39,
    );
    const shards = await env.t.run((ctx) =>
      ctx.db.query("followerShards").collect(),
    );
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.every((shard) => shard.count >= 0)).toBe(true);
    // The projection marker is gone, so the next follow schedules a new one.
    expect(
      await env.t.run((ctx) => ctx.db.query("followerProjections").collect()),
    ).toEqual([]);
  });

  it("caps follows at 1,000 and limits how fast they change", async () => {
    const env = setup();
    const host = await env.creator("alice");
    await publish(host);
    const fan = await env.creator("bob");
    await env.t.run((ctx) =>
      ctx.db.insert("followingCounts", { userId: fan.id, count: 1000 }),
    );
    await expectCode(
      fan.client.mutation(api.follows.follow, { username: "alice" }),
      "FOLLOW_LIMIT",
    );

    const busy = await env.creator("carol");
    let limited = false;
    for (let change = 0; change < 61 && !limited; change++) {
      const method =
        change % 2 === 0 ? api.follows.follow : api.follows.unfollow;
      await busy.client
        .mutation(method, { username: "alice" })
        .catch((error) => {
          limited = error.data?.code === "RATE_LIMITED";
        });
    }
    expect(limited).toBe(true);
  });
});

describe("directory and search", () => {
  async function creators() {
    const env = setup();
    const quiet = await env.creator("quiet");
    const popular = await env.creator("popular");
    const live = await env.creator("live_one");
    const hidden = await env.creator("hidden");
    await publish(quiet);
    await publish(popular);
    await popular.client.mutation(api.profiles.save, {
      displayName: "Popular Pat",
      bio: "Fundraising and pitch decks",
      coverUrl: "",
      published: true,
    });
    await goLive(live);
    for (const name of ["a", "b"]) {
      const fan = await env.creator(`fan_${name}`);
      await fan.client.mutation(api.follows.follow, { username: "popular" });
    }
    await settle(env, 5_000);
    void hidden;
    return { env, quiet, popular, live };
  }

  it("lists live creators first, then by followers, in pages", async () => {
    const { env } = await creators();
    const guest = await env.viewer();
    const first = await guest.client.query(api.directory.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((p) => p.username)).toEqual(["live_one", "popular"]);
    const second = await guest.client.query(api.directory.list, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((p) => p.username)).toEqual(["quiet"]);
    expect(second.isDone).toBe(true);
    const liveOnly = await guest.client.query(api.directory.list, {
      live: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(liveOnly.page.map((p) => p.username)).toEqual(["live_one"]);
  });

  it("searches names and bios of published creators only", async () => {
    const { env } = await creators();
    const guest = await env.viewer();
    const names = async (query: string) =>
      (await guest.client.query(api.directory.search, { query })).items.map(
        (p) => p.username,
      );
    expect(await names("pitch")).toEqual(["popular"]);
    expect(await names("Pat")).toEqual(["popular"]);
    expect(await names("hidden")).toEqual([]);
    expect(await names("   ")).toEqual([]);
    await expectCode(
      guest.client.query(api.directory.search, { query: "x".repeat(81) }),
      "VALIDATION_FAILED",
    );
  });

  it("shows who the signed-in user follows", async () => {
    const { env } = await creators();
    const fan = await env.creator("fan_c");
    await fan.client.mutation(api.follows.follow, { username: "quiet" });
    await fan.client.mutation(api.follows.follow, { username: "live_one" });
    const following = await fan.client.query(api.directory.following, {});
    expect(following.items.map((p) => [p.username, p.isFollowing])).toEqual([
      ["live_one", true],
      ["quiet", true],
    ]);
  });
});

describe("notifications", () => {
  it("tell followers when a creator goes live, once per show", async () => {
    const env = setup();
    const host = await env.creator("alice");
    await publish(host);
    const fan = await env.creator("bob");
    await fan.client.mutation(api.follows.follow, { username: "alice" });
    vi.advanceTimersByTime(1000);
    const showId = await goLive(host);
    await host.client.mutation(api.shows.start, { showId });

    const feed = await fan.client.query(api.notifications.list, {});
    expect(feed).toMatchObject({ unreadCount: 1, unreadCapped: false });
    expect(feed.items).toMatchObject([
      { username: "alice", showId, isLive: true, read: false },
    ]);

    await fan.client.mutation(api.notifications.markRead, {
      ids: [feed.items[0]._id],
    });
    expect(await fan.client.query(api.notifications.list, {})).toMatchObject({
      unreadCount: 0,
      items: [{ read: true }],
    });
  });

  it("only cover the time a viewer has been following", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const before = await goLive(host);
    await host.client.mutation(api.shows.end, { showId: before });
    vi.advanceTimersByTime(1000);
    const fan = await env.creator("bob");
    await fan.client.mutation(api.follows.follow, { username: "alice" });
    expect((await fan.client.query(api.notifications.list, {})).items).toEqual(
      [],
    );

    // An event from before the follow cannot be marked read either.
    const [event] = await env.t.run((ctx) =>
      ctx.db.query("liveEvents").collect(),
    );
    await fan.client.mutation(api.notifications.markRead, { ids: [event._id] });
    expect(
      await env.t.run((ctx) => ctx.db.query("notificationReads").collect()),
    ).toEqual([]);

    vi.advanceTimersByTime(1000);
    await goLive(host);
    expect(
      (await fan.client.query(api.notifications.list, {})).items,
    ).toHaveLength(1);
    await fan.client.mutation(api.follows.unfollow, { username: "alice" });
    expect((await fan.client.query(api.notifications.list, {})).items).toEqual(
      [],
    );
  });

  it("expire after 30 days and are cleaned up with their read receipts", async () => {
    const env = setup();
    const host = await env.creator("alice");
    await publish(host);
    const fan = await env.creator("bob");
    await fan.client.mutation(api.follows.follow, { username: "alice" });
    vi.advanceTimersByTime(1000);
    const showId = await goLive(host);
    await host.client.mutation(api.shows.end, { showId });
    const [item] = (await fan.client.query(api.notifications.list, {})).items;
    await fan.client.mutation(api.notifications.markRead, { ids: [item._id] });

    vi.advanceTimersByTime(NOTIFICATION_WINDOW_MS + DAY);
    expect((await fan.client.query(api.notifications.list, {})).items).toEqual(
      [],
    );
    await env.t.mutation(internal.notifications.prune, {});
    expect(
      await env.t.run((ctx) => ctx.db.query("liveEvents").collect()),
    ).toEqual([]);
    expect(
      await env.t.run((ctx) => ctx.db.query("notificationReads").collect()),
    ).toEqual([]);
  });

  it("page through older items", async () => {
    const env = setup();
    const fan = await env.creator("fan");
    for (let i = 0; i < 30; i++) {
      const host = await env.creator(`host_${i}`);
      await publish(host);
      await fan.client.mutation(api.follows.follow, { username: `host_${i}` });
      vi.advanceTimersByTime(1000);
      await goLive(host);
    }
    const first = await fan.client.query(api.notifications.list, {});
    expect(first.items).toHaveLength(24);
    expect(first.unreadCount).toBe(30);
    const second = await fan.client.query(api.notifications.list, {
      before: first.before,
    });
    expect(second.items).toHaveLength(6);
    expect(second.before).toBeUndefined();
  });
});

describe("channel visitors", () => {
  it("counts recent visitors while anyone is there, and stops when they leave", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const guest = await env.viewer();
    await expectCode(
      guest.client.mutation(api.channels.heartbeat, { username: "alice" }),
      "SHOW_NOT_LIVE",
    );
    await goLive(host);

    const visitors = [guest, await env.viewer(), await env.viewer()];
    for (const visitor of visitors) {
      await visitor.client.mutation(api.channels.heartbeat, {
        username: "alice",
      });
    }
    // A second tab or quick reload adds nobody.
    await visitors[0].client.mutation(api.channels.heartbeat, {
      username: "alice",
    });
    await settle(env, 0);
    expect(
      (await guest.client.query(api.profiles.get, { username: "alice" }))
        ?.channelVisitors,
    ).toBe(3);

    // Two keep their page open; one leaves.
    for (let tick = 0; tick < 4; tick++) {
      await settle(env, 30_000);
      for (const visitor of visitors.slice(0, 2)) {
        await visitor.client.mutation(api.channels.heartbeat, {
          username: "alice",
        });
      }
    }
    await settle(env, 0);
    expect(
      (await guest.client.query(api.profiles.get, { username: "alice" }))
        ?.channelVisitors,
    ).toBe(2);

    // Everyone leaves: the count drops to zero and recounting stops.
    for (let tick = 0; tick < 5; tick++) await settle(env, 30_000);
    expect(
      (await guest.client.query(api.profiles.get, { username: "alice" }))
        ?.channelVisitors,
    ).toBe(0);
    const [stats] = await env.t.run((ctx) =>
      ctx.db.query("channelStats").collect(),
    );
    expect(stats.counting).toBe(false);
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

describe("scheduled Hotlines", () => {
  const HOUR = 60 * 60_000;

  async function draft(env: ReturnType<typeof setup>) {
    const host = await env.creator("alice");
    const showId = await host.client.mutation(api.shows.create, {});
    const visitor = await env.viewer();
    const next = async () =>
      (await visitor.client.query(api.profiles.get, { username: "alice" }))
        ?.nextHotlineAt;
    return { host, showId, next };
  }

  it("announces the next opening on the public profile until it goes live", async () => {
    const env = setup();
    const { host, showId, next } = await draft(env);
    const at = Date.now() + DAY;
    await host.client.mutation(api.shows.schedule, {
      showId,
      scheduledFor: at,
    });
    expect(await next()).toBe(at);

    await host.client.mutation(api.shows.start, { showId });
    expect(await next()).toBeUndefined();
  });

  it("can be changed or cleared, and only on a draft", async () => {
    const env = setup();
    const { host, showId, next } = await draft(env);
    await host.client.mutation(api.shows.schedule, {
      showId,
      scheduledFor: Date.now() + DAY,
    });
    await host.client.mutation(api.shows.schedule, {
      showId,
      scheduledFor: null,
    });
    expect(await next()).toBeUndefined();

    await host.client.mutation(api.shows.start, { showId });
    await expectCode(
      host.client.mutation(api.shows.schedule, {
        showId,
        scheduledFor: Date.now() + DAY,
      }),
      "INVALID_SHOW_STATE",
    );
  });

  it("must be at least 5 minutes and at most 60 days ahead", async () => {
    const env = setup();
    const { host, showId } = await draft(env);
    for (const scheduledFor of [Date.now() + 60_000, Date.now() + 61 * DAY]) {
      await expectCode(
        host.client.mutation(api.shows.schedule, { showId, scheduledFor }),
        "VALIDATION_FAILED",
      );
    }
  });

  it("shows as starting soon for 3 hours past the time, then drops off", async () => {
    const env = setup();
    const { host, showId, next } = await draft(env);
    const at = Date.now() + HOUR;
    await host.client.mutation(api.shows.schedule, {
      showId,
      scheduledFor: at,
    });
    vi.advanceTimersByTime(3 * HOUR);
    expect(await next()).toBe(at);
    vi.advanceTimersByTime(2 * HOUR);
    expect(await next()).toBeUndefined();
  });

  it("is for the creator alone to set", async () => {
    const env = setup();
    const { showId } = await draft(env);
    const other = await env.creator("bob");
    await expectCode(
      other.client.mutation(api.shows.schedule, {
        showId,
        scheduledFor: Date.now() + DAY,
      }),
      "SHOW_NOT_FOUND",
    );
  });
});
