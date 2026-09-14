# Bling

Bling is a live call-in platform for streamers. Viewers wait in an application-managed queue; a direct, audio-only WebRTC connection begins only after the creator selects one caller. The backend is the control plane and never carries audio.

The project currently includes a React/Vite client, Go API, PostgreSQL and Redis dependencies, schema migrations, configuration, structured request logging, health checks, creator authentication, show lifecycle controls, a durable caller queue, realtime queue updates, atomic caller selection, and direct audio-only WebRTC calls.

Creator authentication is available through `/register`, `/login`, and the protected `/dashboard`. The versioned API exposes registration, login, logout, and current-user endpoints under `/api/v1`.

Authenticated creators can create, start, inspect, and end a Hotline from the dashboard. Viewers can join or leave with an anonymous recovery cookie and recover their current position after refreshing. A creator can manually choose a waiting caller or randomly choose within the highest available priority tier. PostgreSQL serializes selection, guarantees exactly one active call per show, and enforces call expiry; Redis stores the hot candidate index and carries ephemeral invalidation and participant-scoped signaling events. After both participants explicitly allow microphone access, native browser WebRTC carries audio directly between them. The creator sees caller names and topics, while public viewers can only read their own queue entry and call.

Before going live, a creator can configure one to five ordered caller tiers with availability, duration, and price. Each tier is priced as free or paid, and the paid option stays locked until payout setup is complete: a creator who cannot be paid can neither price a tier nor start a Hotline with an enabled paid tier. Free Hotlines need no setup. Creators receive 80% of every paid call less half of the published basic card-processing fee; Bling retains 20% and pays the other half of that fee. Charges settle to Bling, the creator share enters an append-only balance ledger when the call reaches `LIVE`, and eligible balances are transferred monthly. Identity and bank details are collected through Stripe embedded onboarding inside Bling. Paid callers authorize a card before queue admission and are charged only after selection; captured calls that never reach `LIVE` are automatically refunded. See [docs/creator-payout-implementation-runbook.md](docs/creator-payout-implementation-runbook.md), [docs/payments.md](docs/payments.md), and [docs/tier-configuration.md](docs/tier-configuration.md).

Viewers can create accounts, publish a public creator profile, and discover creators through a searchable, category- and live-filtered directory with cursor pagination. Follows are stored in PostgreSQL, so they survive reloads and move across devices. A following feed lists live creators first. Going live writes one durable in-app update per show with a fixed cost regardless of follower count, and viewers can mark those updates read. A live channel page reports approximate channel-page visitors, which are deduplicated per actor and expire after 90 seconds; they are not broadcast viewer counts. See [docs/social-architecture.md](docs/social-architecture.md).

## Prerequisites

- Node.js 22+
- Go 1.23+
- Docker with Compose

## Local setup

```bash
make db-up
make migrate
cd frontend && npm install
```

Start the API and web client in separate terminals from the repository root:

```bash
make dev-api
make dev-web
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/healthz`, `/readyz`, and `/api` to the API at `http://localhost:8080`.

The Go process reads `.env` from the repository root when launched with `make dev-api`. Environment variables already present in the shell take precedence.

If port 8080 is already occupied, run `VITE_API_PROXY_TARGET=http://localhost:18080 npm run dev` from `frontend/` to point Vite at another API process; the default remains `http://localhost:8080`.

## Verification

```bash
make test
make build
cd backend && go test -race ./...
```

`GET /healthz` reports process liveness. `GET /readyz` returns `200` only when PostgreSQL and Redis are reachable, and otherwise returns a structured `503` response.

With the API running and a live show UUID, exercise the queue admission path with the included load driver:

```bash
cd backend
go run ./cmd/queue-load -show <show-uuid> -callers 500 -concurrency 100 -websockets -hold 60s
```

Operational recovery, metrics, alerting, and the production security checklist are documented in [docs/operations.md](docs/operations.md).

The driver reports failures, throughput, and p50/p95 response latency. It is a repeatable smoke test, not a claim that one local process represents production capacity; million-caller events still require horizontal API capacity, managed PostgreSQL/Redis sizing, and edge admission controls.

Realtime transport behavior, limits, and recovery semantics are documented in [docs/realtime.md](docs/realtime.md). ICE configuration and the two-browser audio test are documented in [docs/audio-calls.md](docs/audio-calls.md).

## Database migrations

Migrations are plain SQL in `backend/migrations`. Apply or roll back one migration with:

```bash
make migrate
make migrate-down
```

The schema encodes core invariants with foreign keys, check constraints, and partial unique indexes, including one live show per creator, one active call per show, idempotent queue admission, and immutable tier/duration snapshots on each caller entry.

Both commands target the local `bling` database defined by the compose `migrate` service. To exercise a migration against an isolated database instead, override the entrypoint:

```bash
docker compose run --rm --entrypoint migrate migrate -path /migrations \
  -database 'postgres://bling:bling@postgres:5432/bling_social_test?sslmode=disable' up
```

Rollback preconditions and what each social migration drops are documented in [docs/operations.md](docs/operations.md).

## Delivery roadmap

The implementation is intentionally split into reviewable slices. See [docs/delivery-plan.md](docs/delivery-plan.md) for scope and acceptance criteria for each PR.

The monthly creator balance and payout architecture is documented in [docs/creator-payout-implementation-runbook.md](docs/creator-payout-implementation-runbook.md). The next-step plan for caller-saved payment methods, Link, and creator bank-account management is documented in [docs/saved-payments-and-bank-payouts-plan.md](docs/saved-payments-and-bank-payouts-plan.md). Monthly execution is disabled by default until operational, finance, and compliance launch checks are complete.

New pull requests use the repository review template to record verification, operational impact, and deliberately deferred work.
