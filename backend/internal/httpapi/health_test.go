package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeDependency struct{ err error }

func (f fakeDependency) Ping(context.Context) error { return f.err }

func TestHealthz(t *testing.T) {
	router := testRouter(fakeDependency{}, fakeDependency{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestReadyzReportsFailedDependency(t *testing.T) {
	router := testRouter(fakeDependency{err: errors.New("down")}, fakeDependency{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"postgres":"unavailable"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func testRouter(postgres, redis dependency) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return newRouter(logger, healthHandler{postgres: postgres, redis: redis, timeout: time.Second}, nil, nil, nil, nil, nil)
}
