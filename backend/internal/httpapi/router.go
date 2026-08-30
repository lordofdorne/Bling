package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	"github.com/bling-app/bling/backend/internal/config"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/bling-app/bling/backend/internal/realtime"
	showdomain "github.com/bling-app/bling/backend/internal/show"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type postgresDependency struct{ pool *pgxpool.Pool }

func (d postgresDependency) Ping(ctx context.Context) error { return d.pool.Ping(ctx) }

type redisDependency struct{ client *redis.Client }

func (d redisDependency) Ping(ctx context.Context) error { return d.client.Ping(ctx).Err() }

func NewRouter(logger *slog.Logger, postgres *pgxpool.Pool, redisClient *redis.Client, cfg config.Config, queueService *queuedomain.Service, realtimeHub *realtime.Hub) http.Handler {
	authHandler := authHandler{
		service:      auth.NewService(auth.NewPostgresStore(postgres), cfg.BcryptCost, cfg.SessionTTL),
		limiter:      auth.NewRedisRateLimiter(redisClient),
		logger:       logger,
		cookieSecure: cfg.CookieSecure,
		sessionTTL:   cfg.SessionTTL,
		rateWindow:   cfg.AuthRateLimitWindow,
	}
	showHandler := showHandler{service: showdomain.NewService(showdomain.NewPostgresStore(postgres)), logger: logger}
	queueHandler := queueHandler{service: queueService, logger: logger, cookieSecure: cfg.CookieSecure, cookieTTL: cfg.SessionTTL}
	realtimeHandler := realtimeHandler{
		service: queueService, hub: realtimeHub, limiter: auth.NewRedisRateLimiter(redisClient), logger: logger,
		allowedOrigins: cfg.AllowedOrigins, rateLimit: cfg.RealtimeConnectLimit, rateWindow: cfg.RealtimeRateLimitWindow,
		heartbeat: cfg.RealtimeHeartbeat, writeTimeout: cfg.RealtimeWriteTimeout,
	}
	return newRouter(logger, healthHandler{
		postgres: postgresDependency{pool: postgres},
		redis:    redisDependency{client: redisClient},
		timeout:  cfg.ReadinessTimeout,
	}, &authHandler, &showHandler, &queueHandler, &realtimeHandler, cfg.AllowedOrigins)
}

func newRouter(logger *slog.Logger, health healthHandler, authentication *authHandler, shows *showHandler, queues *queueHandler, realtimeUpdates *realtimeHandler, allowedOrigins []string) http.Handler {
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
			if shows != nil {
				api.Get("/creators/{username}/live-show", shows.liveByUsername)
				if queues != nil {
					api.Get("/shows/{showID}/tiers", queues.tiers)
					api.Post("/shows/{showID}/queue", queues.join)
					api.Get("/shows/{showID}/queue/me", queues.me)
					api.Delete("/shows/{showID}/queue/me", queues.leave)
					if realtimeUpdates != nil {
						api.Get("/shows/{showID}/queue/events", realtimeUpdates.viewer)
					}
				}
				api.Group(func(protected chi.Router) {
					protected.Use(requireCreator(authentication.service, logger))
					protected.Mount("/shows", shows.routes())
					if queues != nil {
						protected.Get("/shows/{showID}/queue", queues.list)
						if realtimeUpdates != nil {
							protected.Get("/shows/{showID}/queue/creator-events", realtimeUpdates.creator)
						}
					}
				})
			}
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
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
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
