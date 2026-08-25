package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
)

type fakeQueueService struct {
	joinInput queuedomain.JoinInput
	state     queuedomain.ViewerState
	entries   []queuedomain.Entry
	err       error
	listCalls int
}

func (f *fakeQueueService) Join(_ context.Context, input queuedomain.JoinInput) (queuedomain.ViewerState, error) {
	f.joinInput = input
	return f.state, f.err
}
func (f *fakeQueueService) Me(context.Context, string, []byte) (queuedomain.ViewerState, error) {
	return f.state, f.err
}
func (f *fakeQueueService) Leave(context.Context, string, []byte) (queuedomain.Entry, error) {
	return f.state.Entry, f.err
}
func (f *fakeQueueService) List(context.Context, string, string, int, int) ([]queuedomain.Entry, error) {
	f.listCalls++
	return f.entries, f.err
}
func (f *fakeQueueService) Tiers(context.Context, string) ([]queuedomain.Tier, error) {
	return []queuedomain.Tier{{ID: "tier-1", Name: "Standard", CallDurationSeconds: 300}}, f.err
}

func queueTestRouter(authentication *fakeAuthService, service *fakeQueueService) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authenticationHandler := &authHandler{service: authentication, limiter: fakeLimiter{allowed: true}, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	shows := &showHandler{service: &fakeShowService{}, logger: logger}
	queues := &queueHandler{service: service, logger: logger, cookieTTL: time.Hour}
	health := healthHandler{postgres: fakeDependency{}, redis: fakeDependency{}, timeout: time.Second}
	return newRouter(logger, health, authenticationHandler, shows, queues, []string{"http://localhost:5173"})
}

func TestJoinQueueSetsOpaqueRecoveryCookieAndHashesCredentials(t *testing.T) {
	service := &fakeQueueService{state: queuedomain.ViewerState{Entry: queuedomain.Entry{ID: "entry-1", Status: queuedomain.StatusWaiting}, Position: 1}}
	router := queueTestRouter(&fakeAuthService{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shows/"+testShowID+"/queue", strings.NewReader(`{"displayName":"Alice","topic":"Launch","tierId":"tier-1"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "retry-key")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != viewerCookieName || !cookies[0].HttpOnly || cookies[0].Value == "" {
		t.Fatalf("unexpected recovery cookie: %+v", cookies)
	}
	if string(service.joinInput.JoinKeyHash) == "retry-key" || len(service.joinInput.JoinKeyHash) != 32 || len(service.joinInput.SessionTokenHash) != 32 {
		t.Fatalf("credentials were not hashed: %+v", service.joinInput)
	}
}

func TestQueueMeWithoutRecoveryCookieIsPrivate(t *testing.T) {
	router := queueTestRouter(&fakeAuthService{}, &fakeQueueService{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/shows/"+testShowID+"/queue/me", nil))
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"NOT_IN_QUEUE"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCreatorQueueRequiresAuthentication(t *testing.T) {
	service := &fakeQueueService{}
	router := queueTestRouter(&fakeAuthService{err: auth.ErrInvalidSession}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/shows/"+testShowID+"/queue", nil))
	if response.Code != http.StatusUnauthorized || service.listCalls != 0 {
		t.Fatalf("status=%d list calls=%d", response.Code, service.listCalls)
	}
}
