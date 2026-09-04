package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	calldomain "github.com/bling-app/bling/backend/internal/call"
	"github.com/bling-app/bling/backend/internal/config"
	"github.com/bling-app/bling/backend/internal/database"
	financedomain "github.com/bling-app/bling/backend/internal/finance"
	"github.com/bling-app/bling/backend/internal/httpapi"
	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/bling-app/bling/backend/internal/realtime"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	postgres, err := database.OpenPostgres(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("postgres setup failed", "error", err)
		os.Exit(1)
	}
	defer postgres.Close()

	redisClient, err := database.OpenRedis(cfg.RedisURL)
	if err != nil {
		logger.Error("redis setup failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := redisClient.Close(); err != nil {
			logger.Warn("redis close failed", "error", err)
		}
	}()
	eventBus := realtime.NewRedisBus(redisClient)
	realtimeHub := realtime.NewHub(ctx, eventBus, logger, cfg.RealtimeClientBuffer, cfg.RealtimeMaxPerShow)
	signalHub := realtime.NewSignalHub(ctx, eventBus, logger, cfg.RealtimeClientBuffer, 8)
	var paymentGateway paymentdomain.Gateway
	var payoutGateway payoutdomain.Gateway
	var financeGateway financedomain.Gateway
	if cfg.StripeSecretKey != "" {
		paymentGateway = paymentdomain.NewStripeGateway(cfg.StripeSecretKey)
		payoutGateway = payoutdomain.NewStripeGateway(cfg.StripeSecretKey)
		financeGateway = financedomain.NewStripeGateway(cfg.StripeSecretKey)
	}
	financeService := financedomain.NewService(financedomain.NewPostgresRepository(postgres), financeGateway, logger)
	go financeService.Run(ctx)
	payoutService := payoutdomain.NewService(payoutdomain.NewPostgresRepository(postgres), payoutGateway, cfg.StripeConnectCountry, cfg.FrontendURL)
	paymentService := paymentdomain.NewService(paymentdomain.NewPostgresRepository(postgres), paymentGateway, cfg.StripePublishableKey)
	callService := calldomain.NewService(calldomain.NewPostgresRepository(postgres, paymentGateway), logger)
	go callService.RunTimeouts(ctx)
	presence := realtime.NewPresenceStore(redisClient, cfg.CallPresenceTTL)
	go runPresenceRecovery(ctx, logger, presence, callService, cfg.CallDisconnectGrace)
	queueService := queuedomain.NewService(
		queuedomain.NewPostgresRepository(postgres),
		queuedomain.NewRedisCandidateIndex(redisClient),
		eventBus,
		logger,
	)
	go queueService.RunOutbox(ctx)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.NewRouter(logger, postgres, redisClient, cfg, queueService, realtimeHub, callService, signalHub, paymentService, payoutService, financeService),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("api listening", "address", cfg.HTTPAddr, "environment", cfg.Environment)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown requested")
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("api stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("api stopped")
}

func runPresenceRecovery(ctx context.Context, logger *slog.Logger, presence *realtime.PresenceStore, calls *calldomain.Service, grace time.Duration) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			expired, err := presence.Reap(ctx, now.UTC(), 500)
			if err != nil {
				logger.Error("call presence sweep failed", "error", err)
				continue
			}
			for _, participant := range expired {
				if err := calls.ParticipantDisconnected(ctx, participant.CallID, participant.Role); err != nil {
					logger.Error("stale participant persistence failed", "error", err, "call_id", participant.CallID, "role", participant.Role)
				}
			}
			if err := calls.ExpireDisconnected(ctx, grace); err != nil {
				logger.Error("disconnected call expiry failed", "error", err)
			}
		}
	}
}
