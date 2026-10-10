/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as calls from "../calls.js";
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as directory from "../directory.js";
import type * as follows from "../follows.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calls from "../lib/calls.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_payments from "../lib/payments.js";
import type * as lib_social from "../lib/social.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as notifications from "../notifications.js";
import type * as paymentMethods from "../paymentMethods.js";
import type * as payments from "../payments.js";
import type * as payouts from "../payouts.js";
import type * as presence from "../presence.js";
import type * as profiles from "../profiles.js";
import type * as queue from "../queue.js";
import type * as refunds from "../refunds.js";
import type * as rtc from "../rtc.js";
import type * as shows from "../shows.js";
import type * as signals from "../signals.js";
import type * as tiers from "../tiers.js";
import type * as users from "../users.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  calls: typeof calls;
  channels: typeof channels;
  crons: typeof crons;
  directory: typeof directory;
  follows: typeof follows;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/calls": typeof lib_calls;
  "lib/errors": typeof lib_errors;
  "lib/ledger": typeof lib_ledger;
  "lib/payments": typeof lib_payments;
  "lib/social": typeof lib_social;
  "lib/stripe": typeof lib_stripe;
  notifications: typeof notifications;
  paymentMethods: typeof paymentMethods;
  payments: typeof payments;
  payouts: typeof payouts;
  presence: typeof presence;
  profiles: typeof profiles;
  queue: typeof queue;
  refunds: typeof refunds;
  rtc: typeof rtc;
  shows: typeof shows;
  signals: typeof signals;
  tiers: typeof tiers;
  users: typeof users;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
