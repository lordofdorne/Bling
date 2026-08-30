# Bling

Bling is a live call-in platform for streamers. Viewers wait in an application-managed queue; a direct, audio-only WebRTC connection begins only after the creator selects one caller. The backend is the control plane and never carries audio.

The project currently includes a React/Vite client, Go API, PostgreSQL and Redis dependencies, schema migrations, configuration, structured request logging, health checks, creator authentication, show lifecycle controls, a durable caller queue, realtime queue updates, atomic caller selection, and direct audio-only WebRTC calls.

Creator authentication is available through `/register`, `/login`, and the protected `/dashboard`. The versioned API exposes registration, login, logout, and current-user endpoints under `/api/v1`.

Authenticated creators can create, start, inspect, and end a Hotline from the dashboard. Viewers can join or leave with an anonymous recovery cookie and recover their current position after refreshing. A creator can manually choose a waiting caller or randomly choose within the highest available priority tier. PostgreSQL serializes selection, guarantees exactly one active call per show, and enforces call expiry; Redis stores the hot candidate index and carries ephemeral invalidation and participant-scoped signaling events. After both participants explicitly allow microphone access, native browser WebRTC carries audio directly between them. The creator sees caller names and topics, while public viewers can only read their own queue entry and call.

## Prerequisites

- Node.js 22+
- Go 1.23+
- Docker with Compose

## Local setup

```bash
cp .env.example .env
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
go run ./cmd/queue-load -show <show-uuid> -callers 1000 -concurrency 100
```

The driver reports failures, throughput, and p50/p95 response latency. It is a repeatable smoke test, not a claim that one local process represents production capacity; million-caller events still require horizontal API capacity, managed PostgreSQL/Redis sizing, and edge admission controls.

Realtime transport behavior, limits, and recovery semantics are documented in [docs/realtime.md](docs/realtime.md). ICE configuration and the two-browser audio test are documented in [docs/audio-calls.md](docs/audio-calls.md).

## Database migrations

Migrations are plain SQL in `backend/migrations`. Apply or roll back one migration with:

```bash
make migrate
make migrate-down
```

The schema encodes core invariants with foreign keys, check constraints, and partial unique indexes, including one live show per creator, one active call per show, idempotent queue admission, and immutable tier/duration snapshots on each caller entry.

## Delivery roadmap

The implementation is intentionally split into reviewable slices. See [docs/delivery-plan.md](docs/delivery-plan.md) for scope and acceptance criteria for each PR.

New pull requests use the repository review template to record verification, operational impact, and deliberately deferred work.
