package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	"github.com/bling-app/bling/backend/internal/config"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type postgresDependency struct{ pool *pgxpool.Pool }

func (d postgresDependency) Ping(ctx context.Context) error { return d.pool.Ping(ctx) }

type redisDependency struct{ client *redis.Client }

func (d redisDependency) Ping(ctx context.Context) error { return d.client.Ping(ctx).Err() }

func NewRouter(logger *slog.Logger, postgres *pgxpool.Pool, redisClient *redis.Client, cfg config.Config) http.Handler {
	authHandler := authHandler{
		service:      auth.NewService(auth.NewPostgresStore(postgres), cfg.BcryptCost, cfg.SessionTTL),
		limiter:      auth.NewRedisRateLimiter(redisClient),
		logger:       logger,
		cookieSecure: cfg.CookieSecure,
		sessionTTL:   cfg.SessionTTL,
		rateWindow:   cfg.AuthRateLimitWindow,
	}
	return newRouter(logger, healthHandler{
		postgres: postgresDependency{pool: postgres},
		redis:    redisDependency{client: redisClient},
		timeout:  cfg.ReadinessTimeout,
	}, &authHandler, cfg.AllowedOrigins)
}

func newRouter(logger *slog.Logger, health healthHandler, authentication *authHandler, allowedOrigins []string) http.Handler {
	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.Recoverer)
	router.Use(chimiddleware.RequestSize(1 << 20))
	router.Use(originProtection(allowedOrigins))
	router.Use(accessLog(logger))
	router.Get("/healthz", health.live)
	router.Get("/readyz", health.ready)
	if authentication != nil {
		router.Route("/api/v1", func(api chi.Router) {
			api.Mount("/auth", authentication.routes())
			api.Get("/me", authentication.me)
		})
	}
	return router
}

func originProtection(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := allowed[origin]; !ok {
					writeError(w, http.StatusForbidden, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.")
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Add("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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
