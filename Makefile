.PHONY: dev dev-api dev-web db-up db-down migrate migrate-down test test-backend test-frontend fmt build

dev:
	@echo "Run 'make dev-api' and 'make dev-web' in separate terminals."

dev-api:
	cd backend && go run ./cmd/api

dev-web:
	cd frontend && npm run dev

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose down

migrate:
	docker compose run --rm migrate up

migrate-down:
	docker compose run --rm migrate down 1

test: test-backend test-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm run lint && npm test -- --run

fmt:
	cd backend && gofmt -w $$(find . -name '*.go' -not -path './vendor/*')
	cd frontend && npm run format:check

build:
	cd backend && mkdir -p bin && go build -o bin/api ./cmd/api
	cd frontend && npm run build
