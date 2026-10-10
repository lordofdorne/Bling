/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { createProfile } from "./lib/social";
import schema from "./schema";

// Shared setup for convex-test suites. Convex does not deploy files with more
// than one dot in their name, so this never ships as a function module.

const modules = import.meta.glob("./**/*.ts");

export function setup() {
  const t = convexTest(schema, modules);
  // Convex Auth identities carry "userId|sessionId" in the subject.
  const as = (userId: Id<"users">) =>
    t.withIdentity({ subject: `${userId}|session` });
  const creator = async (username: string) => {
    const id = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: `${username}@bling.test`,
        username,
      });
      await createProfile(ctx as unknown as MutationCtx, userId, username);
      return userId;
    });
    return { id, client: as(id) };
  };
  const viewer = async () => {
    const id = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true }),
    );
    return { id, client: as(id) };
  };
  return { t, creator, viewer };
}

export type Participant = Awaited<
  ReturnType<ReturnType<typeof setup>["creator"]>
>;

export async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

export const free = (name: string) => ({
  name,
  callDurationSeconds: 300,
  priceCents: 0,
  enabled: true,
});

/** A live show with VIP and Standard free tiers. */
export async function liveShow(
  host: Participant,
  tiers = [free("VIP"), free("Standard")],
) {
  const showId = await host.client.mutation(api.shows.create, {});
  await host.client.mutation(api.tiers.replace, { showId, tiers });
  await host.client.mutation(api.shows.start, { showId });
  const [vip, standard] = await host.client.query(api.tiers.forCreator, {
    showId,
  });
  return { showId, vip, standard };
}
