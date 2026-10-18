# Migration to Convex

Bling is moving from the Go API (Postgres, Redis, WebSockets, background workers) to [Convex](https://convex.dev). The target production stack is **Vercel** (frontend) + **Convex** (database, functions, realtime, scheduled jobs) + a **TURN** server for call audio, which no backend replaces.

**Status:** production runs on Convex. The Go API is legacy and not used in production; this document records how each area was ported.

## Where things live

- `frontend/convex/` holds the Convex functions and `schema.ts`. Convex expects this folder next to the `package.json` that installs `convex`.
- `frontend/convex/*.test.ts` are run by Vitest's `convex` project (`convex-test`, edge runtime). `npm test` runs them with the app tests.
- `npm run convex` starts a local Convex backend (no account needed with `CONVEX_AGENT_MODE=anonymous`) and pushes functions on save. It writes `VITE_CONVEX_URL` to `frontend/.env.local`.
- `npm run convex:auth-keys [site-url]` sets Convex Auth's signing keys on the current deployment. Run once per deployment.

## Mapping

| Go API today | Convex |
| --- | --- |
| Postgres tables, SQL migrations | `schema.ts` tables and indexes; schema changes deploy with the functions |
| `FOR UPDATE`, `SKIP LOCKED`, advisory locks | Mutations are serializable transactions; conflicting ones retry automatically |
| Redis fan-out, queue/realtime WebSockets | Live queries: the client re-renders when data it read changes |
| Redis candidate index, rate limits | Indexes; `@convex-dev/rate-limiter` |
| Outbox and background workers | `ctx.scheduler.runAfter`, crons |
| Stripe calls and webhooks | Actions (outbound) and HTTP actions (webhooks) |
| bcrypt sessions, viewer recovery cookie | Convex Auth: Password for creators, Anonymous for callers |
| Call signaling over WebSocket | Signaling documents read by live queries (phase 2) |

## Design rules

- **The queue is a holding place.** Creators pick whom to connect. No positions, no ETAs, no "take next caller" (see `AGENTS.md`).
- **Busy shows never contend.** A write every caller makes (join, leave, heartbeat) touches only that caller's own document. No per-join counters on the show or tier. Documents read by every join (the show, its tiers) do not change while a show is live.
- **Big jobs run in batches.** Anything that can touch an unbounded number of documents (ending a show, payout runs, retention) processes a fixed batch and reschedules itself, so no mutation hits Convex's per-transaction limits.
- **Error codes match the Go API** (`convex/lib/errors.ts`), thrown as `ConvexError({ code, message })`, so the frontend maps them the same way during the switch.
- **External calls go through actions**, never mutations. A mutation records intent, then schedules the action, which writes the result back through an internal mutation.

## Phases

1. **Accounts, shows, tiers, queue** (done). Convex Auth (Password + Anonymous), `shows`, `tiers`, `queue`, ending a show in batches. Paid shows cannot start and paid tiers cannot be joined until phases 3–4. The frontend still uses the Go API.
2. **Calls and signaling** (done). `calls` (pick a caller, or a random one from the highest tier with anyone waiting; lifecycle; expiry scheduled for the exact end time), `signals` (offer/answer/ICE documents with an inbox query and acks), `presence` (heartbeats with a scheduled check per beat; disconnect after 30 s of silence, call fails after a further 20 s grace), `rtc.config` (STUN plus coturn shared-secret TURN credentials). Ending a show ends its open call. Paid callers cannot be selected until phase 3. Measured below.
3. **Payments** (done). `payments` (authorize a hold, verify it, capture on selection, release on leave), `queue.joinPaid`, `refunds` (retries with backoff, a one-minute sweep in `crons.ts` as a safety net), the Stripe webhook at `<CONVEX_SITE_URL>/stripe/webhook` (`webhooks.ts`), saved cards (`paymentMethods`), and the creator's payment activity. Fees and Stripe idempotency keys match the Go API exactly. Paid shows still cannot start until payout readiness moves over in phase 4.
4. **Payouts** (done). `payouts` (Accounts v2 recipient accounts, embedded-onboarding sessions, readiness refreshed from Stripe and on `account.updated`, balance and ledger activity, bank payout failures, and the monthly run), `lib/ledger.ts` (earnings when a paid call goes live, refund reversals, dispute debits and releases), and the paid-show start check. Paid shows can now start once the creator is ready.
5. **Social** (done). `profiles` (with avatars in Convex file storage), `follows` (64 counter shards per creator), `directory` (listing, search, following), `notifications` (go-live events, read state, 30-day retention), and `channels` (approximate visitor counts). Sign-up creates the unpublished profile, creating a show publishes it, and going live records one event per show.
6. **Frontend switch** (done, behind a flag). Every data hook in `src/lib` has a Convex twin in `src/lib/convex/hooks.ts`; `VITE_BACKEND=convex` selects them at build time. See "Frontend switch" below. Still to verify by hand: a real two-person audio call.
7. **Data migration and cutover.** Export Postgres, import into Convex, verify, switch DNS, retire the Go API, Postgres and Redis. Existing users keep their passwords through a bcrypt `crypto` option on the Password provider.

## Payments design

Stripe runs in actions through the SDK's fetch-based worker build, so the default Convex runtime is enough (`convex/lib/stripe.ts`). Mutations record what should happen and schedule an action; the action calls Stripe with a stable idempotency key and writes the result back. A repeated or retried action therefore never charges or refunds twice.

Differences from the Go API, all deliberate:

- **Webhook events apply in one transaction.** The event id is recorded in the same mutation that applies it, so redelivery is a no-op and the Go API's claim, processing and complete states are gone.
- **A paid caller is SELECTED as soon as the creator picks them.** They cannot leave while their payment is captured (about a second), which removes a race in the Go API between leaving and capturing.
- **Ending a show releases waiting callers' card holds** right away. The Go API left them to lapse after seven days.
- **The scheduler, not Workpool, runs captures and refunds.** Captures happen one at a time per show and refunds are rare, so Workpool's concurrency limits are not needed yet.

Environment, set with `npx convex env set`: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (the destination for Bling's own account) and `STRIPE_CONNECT_WEBHOOK_SECRET` (the destination for connected accounts: `account.updated` and `payout.*`). Both destinations use the same URL.

Verified on 2026-10-09 with Stripe test mode against the local backend, with webhooks forwarded by `stripe listen`: authorize created a manual-capture PaymentIntent, a test card confirmed it, `joinPaid` verified the hold, selecting the caller captured $5 and opened the call, ending it before LIVE refunded $5, and the three resulting webhooks were each applied once. A forged signature gets 400. The unit tests (`payments.test.ts`) use an in-memory Stripe but real webhook signing.

## Payouts design

The Postgres ledger triggers became explicit calls (`creditEarning`, `reverseForRefund`, `adjustForDispute`) inside the mutation that changes the call, refund or dispute, so each posting is atomic with its cause. Every entry has an idempotency key, and the keys match the Go API's (`earning:`, `refund:`, `dispute-debit:`, `dispute-release:`, `payout-reservation:`).

- **Balances never sum the history.** `creatorBalances` keeps each creator's running total in the same transaction as every entry; the held part is the entries not yet effective, at most the hold period's worth.
- **The monthly run** is an hourly cron (`creator payouts`) that does nothing unless `CREATOR_PAYOUTS_ENABLED=true`. From the payout day on, it opens the previous month's run and walks payout accounts in batches of 100. For each creator with active transfers, at least the minimum available, no item in this run and no unsettled earlier payout, it reserves the balance with a `PAYOUT_RESERVATION` entry and schedules one Stripe transfer. Transfers retry with backoff; after 10 failures the item is FAILED, the money stays reserved, and that creator's later payouts wait for an operator, as in the Go API.
- **Starting a paid show** checks the stored readiness in the same mutation that opens the show. `payouts.status` refreshes it from Stripe, so the dashboard should call it when payout settings open and after onboarding.
- **Balance query timing.** `payouts.balance` splits held from available at query time, so the split can lag while a cached result is served. Payout runs always use the exact time.

Environment: `STRIPE_CONNECT_COUNTRY` (US), `CREATOR_PAYOUTS_ENABLED` (false), `CREATOR_PAYOUT_DAY` (1), `CREATOR_PAYOUT_MINIMUM_CENTS` (2500), `CREATOR_PAYOUT_CURRENCY` (usd), `CREATOR_EARNINGS_HOLD_HOURS` (168).

Verified on 2026-10-09 against Stripe test mode: `payouts.accountSession` created a v2 recipient account and an onboarding session, and `payouts.status` read back Stripe's real outstanding requirements. Transfers to a fully onboarded account were not run, because onboarding needs the embedded Stripe form in a browser; `payouts.test.ts` covers them against the in-memory Stripe.

## Social design

The Go API's Postgres triggers (profile on sign-up, show projection, follower shards) became explicit calls in the same mutations, and its Redis caches, presence and rate limits became Convex tables. What changed and why:

- **Follower counts.** Each follow or unfollow adjusts one of 64 shards chosen at random. Only the first follow in a 5-second window creates a projection marker and schedules `follows.project`, which sums the shards into `followerCount`. Nothing runs while no one is following; the Go API polled every 5 seconds.
- **Directory and search.** The main listing pages through the `by_directory` index (live, then followers). Search uses a Convex search index over username, display name and bio; it takes 256 candidates and ranks them like the directory. Unlike Postgres `simple` search, the last word matches as a prefix, so "ali" finds "alice". The following list ranks a user's at most 1,000 follows in memory. Convex's query cache replaces the Redis directory cache.
- **Notifications.** There is still no fan-out: one `liveEvents` row per show, gathered per viewer (at most 25 per followed creator, 30 days, only since the follow). The unread count stops at 100, or after checking 500 events, and reports `unreadCapped`. Retention runs every 10 minutes in batches.
- **Channel visitors.** Each heartbeat writes only the visitor's own row. The first heartbeat after a quiet spell starts a recount job. It counts from a read-only snapshot, so it never conflicts with heartbeats, then stores the total in `channelStats` every 30 seconds while anyone is visiting, and stops at zero. Counts therefore refresh every 30 seconds. They are an activity indicator, as in the Go API.
- **Avatars** are uploaded to a Convex upload URL, then `profiles.setAvatar` checks the file's first bytes (real JPG, PNG or WebP signatures, not the browser's Content-Type) and its size (at most 768 KB). Rejected uploads are deleted, a file attached to one profile cannot be claimed by another, and a replaced avatar's file is deleted.
- **Rate limits** match the Go API's per-user numbers: 60 follow changes, 20 profile saves, 10 avatar uploads and 120 read updates a minute, in a fixed-window table. The Go API's per-IP limit has no equivalent, because Convex functions do not see client addresses.
- **Unpublished avatars** are served from Convex storage URLs, which are unguessable but not owner-only as the Go endpoint was.

Verified on 2026-10-09 against the local backend: sign-up created the profile, a real PNG uploaded and was served while a text file labeled image/png was rejected, the follower count projected after the delay, search matched a bio word and a username prefix, going live produced the follower's notification, and three visitors were counted after one recount.

## Frontend switch

`VITE_BACKEND=convex` (with `VITE_CONVEX_URL`, which `npm run convex` writes to `frontend/.env.local`) switches the whole app to Convex; without it the app uses the Go API exactly as before. The switch is all or nothing because sign-in lives in one backend or the other.

- **Same hooks, same shapes.** Each hook in `src/lib` (`useMe`, `useCurrentShow`, `useJoinQueue`, `useActiveCall`, `useCreators`, …) is exported as `usingConvex ? convexHooks.X : XGo`. The Convex versions in `src/lib/convex/hooks.ts` return the same TanStack Query results and types, mapping `_id` to `id` and milliseconds to ISO strings (`mappers.ts`), so components did not change. Convex errors become `ApiError` with the Go API's wording (`toApiError` in `lib/backend.ts`).
- **Live data.** Single-record and list reads use `@convex-dev/react-query`, so they update live; the queue WebSocket hook is a no-op. The paged directory and notifications keep the Go hooks' 30-second polling, because the follow button's optimistic updates are written against those caches.
- **Sessions.** Creators sign in with Convex Auth (password). Callers get an anonymous session the first time they join, pay or open a live channel (`lib/convex/session.ts`). One sign-in is shared and waited on until the server sees it; without that, a heartbeat sent straight after sign-in failed as unauthenticated.
- **Calls.** `WebRTCCallManager` is unchanged. In Convex mode it gets a `ConvexSignalSocket` (`lib/convex/signalSocket.ts`): a WebSocket-shaped object that reads the inbox query, batches ICE candidates for 15 ms, acknowledges after 250 ms of quiet, sends a presence heartbeat every 10 seconds, and reports leaving on close. Ending on page hide is a best-effort mutation; if the page dies first, the presence grace ends the call.
- **Password reset** uses Convex Auth's emailed-code flow (`convex/passwordReset.ts`, sent through Resend): `/forgot-password` asks for the email, then takes the 8-digit code and new password and signs the person in, ending their other sessions. Codes last 15 minutes, each address gets at most 3 emails per 15 minutes, and Convex Auth limits wrong guesses. The page never says whether an account exists. Env: `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`; locally `AUTH_EMAIL_LOG_CODES=true` writes codes to the Convex logs instead.
- **Convex-only features.** The creator's caller list shows tags (follower, first call or number of past calls) and private caller notes (`convex/callerNotes.ts`) only on Convex. The Go API keys a queue entry to a session token rather than an account, so it cannot recognize a caller across shows; its entries have no `caller` field and the list hides tags, filters and notes.

Run it locally with `npm run convex` in one terminal and `VITE_BACKEND=convex npm run dev -- --port 5175` in another (or the `frontend-convex` entry in `.claude/launch.json`).

Verified on 2026-10-09 in the browser against the local backend:

- **Creator path:** registered a creator, created and started a Hotline, and saw a scripted anonymous caller appear on the dashboard within seconds with no refresh. Picked them, and the caller's own live query saw the call. Ended it.
- **Other screens:** profile, payouts, payments and the public channel page loaded with live data; the channel's visitor count updated without a refresh.
- **Guest path:** signed out, joined as a guest from a clean browser, and when the scripted creator picked them the page switched to "You're up" on its own. Ending the call from that page worked.
- **Not verified:** connecting audio. The browser pane blocks the microphone, so test a real call in two normal browsers (or a browser and a phone) before cutover.

## Signaling performance

`npm run bench:signaling` (`frontend/scripts/signaling-bench.mjs`) runs the exchange a call makes before audio flows on both local backends: caller ready → creator offer → caller answer, then 8 ICE candidates each way. Results from 2026-10-09, 30 calls each, one MacBook:

| Backend | Handshake p50 / p90 | ICE (8 each way) p50 / p90 |
| --- | --- | --- |
| Go API (WebSocket relay) | 5 / 10 ms | 11 / 15 ms |
| Convex, one mutation per signal | 30 / 35 ms | 57 / 70 ms |
| Convex, batched ICE and delayed acks | 22 / 25 ms | 12 / 16 ms |

Convex adds about 6 ms per hop locally (a committed write, then a subscription push) against a WebSocket relay. In production both backends also pay network round trips, so expect call setup a few tens of milliseconds slower on Convex. That is small next to ICE connectivity checks and TURN allocation, which take hundreds of milliseconds either way. Audio itself never touches the backend.

The first design was much slower (ICE p50 278 ms): every send counted the recipient's pending signals, which conflicted with the recipient's acks and forced retries. Sends now read nothing from the inbox. The frontend client (phase 6) must also follow two rules, or ICE takes about five times as long:

- **Batch ICE candidates.** Collect candidates for a few milliseconds and send them in one `signals.send` (up to 20).
- **Delay acks.** Acknowledge handled signals after a short quiet period (about 250 ms), never one by one. Convex runs one client's mutations in order, so eager acks queue ahead of sends.

## Open decisions

- **Email.** Password reset sends through Resend: verify the sending domain in Resend, then set `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` on the production deployment. Email verification at sign-up is not on yet (it would use the same provider via `Password({ verify })`).
- **Convex region and plan** for production, chosen before phase 7.
- **Scheduled Hotlines.** `shows.schedule` sets `scheduledFor` on a draft (5 minutes to 60 days ahead) and mirrors it to `profiles.nextHotlineAt`, which the public page shows (with an .ics download) until the Hotline goes live or for 3 hours past the time. It announces; the creator still opens the Hotline.
- **Fan receipts.** Stripe sends them: `payments.authorize` sets `receipt_email` (the account email, or the one a guest gives on a paid tier) and a description like "Call with @alice · Priority (2 min)". Turn on Stripe's customer emails for successful payments and refunds.
- **Live alerts.** Going live (at most once per creator per 6 hours) walks followers in batches of 100 (`liveAlerts.collect`) and sends each batch through Resend's batch API with an idempotency key and up to 3 attempts. Unsubscribe links are HMAC-signed user ids (`UNSUBSCRIBE_SECRET`, else the auth signing key); GET asks to confirm, POST (and mail clients' one-click) unsubscribes. Preferences live in `emailPreferences`, written only on change. `EMAIL_POSTAL_ADDRESS` adds the mailing address US law expects in the footer.
- **TURN.** Production uses Cloudflare's managed TURN: `rtc.config` mints credentials per participant from `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` (4-hour lifetime, port 53 URLs dropped), falling back to STUN only if Cloudflare is unreachable. A self-hosted coturn with `TURN_URL` and `TURN_SHARED_SECRET` still works when Cloudflare isn't configured.
