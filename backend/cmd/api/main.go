package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	calldomain "github.com/bling-app/bling/backend/internal/call"
	"github.com/bling-app/bling/backend/internal/config"
	"github.com/bling-app/bling/backend/internal/database"
	"github.com/bling-app/bling/backend/internal/httpapi"
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
	callService := calldomain.NewService(calldomain.NewPostgresRepository(postgres))
	queueService := queuedomain.NewService(
		queuedomain.NewPostgresRepository(postgres),
		queuedomain.NewRedisCandidateIndex(redisClient),
		eventBus,
		logger,
	)
	go queueService.RunOutbox(ctx)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.NewRouter(logger, postgres, redisClient, cfg, queueService, realtimeHub, callService, signalHub),
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
