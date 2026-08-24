package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type postgresDependency struct{ pool *pgxpool.Pool }

func (d postgresDependency) Ping(ctx context.Context) error { return d.pool.Ping(ctx) }

type redisDependency struct{ client *redis.Client }

func (d redisDependency) Ping(ctx context.Context) error { return d.client.Ping(ctx).Err() }

func NewRouter(logger *slog.Logger, postgres *pgxpool.Pool, redisClient *redis.Client, readinessTimeout time.Duration) http.Handler {
	return newRouter(logger, healthHandler{
		postgres: postgresDependency{pool: postgres},
		redis:    redisDependency{client: redisClient},
		timeout:  readinessTimeout,
	})
}

func newRouter(logger *slog.Logger, health healthHandler) http.Handler {
	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.RealIP)
	router.Use(chimiddleware.Recoverer)
	router.Use(accessLog(logger))
	router.Get("/healthz", health.live)
	router.Get("/readyz", health.ready)
	return router
}

func accessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			started := time.Now()
			next.ServeHTTP(wrapped, r)
			logger.Info("request completed",
				"request_id", chimiddleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", wrapped.Status(),
				"bytes", wrapped.BytesWritten(),
				"duration_ms", time.Since(started).Milliseconds(),
			)
		})
	}
}
