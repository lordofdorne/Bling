package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type dependency interface {
	Ping(context.Context) error
}

type healthHandler struct {
	postgres dependency
	redis    dependency
	timeout  time.Duration
}

func (h healthHandler) live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h healthHandler) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	checks := map[string]string{"postgres": "ok", "redis": "ok"}
	status := http.StatusOK
	if err := h.postgres.Ping(ctx); err != nil {
		checks["postgres"] = "unavailable"
		status = http.StatusServiceUnavailable
	}
	if err := h.redis.Ping(ctx); err != nil {
		checks["redis"] = "unavailable"
		status = http.StatusServiceUnavailable
	}

	writeJSON(w, status, map[string]any{
		"status":       map[bool]string{true: "ok", false: "unavailable"}[status == http.StatusOK],
		"dependencies": checks,
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
