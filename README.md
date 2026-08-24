# Bling

Bling is a live call-in platform for streamers. Viewers wait in an application-managed queue; a direct, audio-only WebRTC connection begins only after the creator selects one caller. The backend is the control plane and never carries audio.

This branch contains the Phase 1 foundation: a React/Vite client, Go API, PostgreSQL and Redis dependencies, schema migrations, configuration, structured request logging, and health checks.

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

## Database migrations

Migrations are plain SQL in `backend/migrations`. Apply or roll back one migration with:

```bash
make migrate
make migrate-down
```

The initial schema encodes core invariants with foreign keys, check constraints, and partial unique indexes, including one live show per creator and one active call per show.

## Delivery roadmap

The implementation is intentionally split into reviewable slices. See [docs/delivery-plan.md](docs/delivery-plan.md) for scope and acceptance criteria for each PR.

# Bling
