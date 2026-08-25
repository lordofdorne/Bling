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
	showdomain "github.com/bling-app/bling/backend/internal/show"
)

const testShowID = "123e4567-e89b-42d3-a456-426614174000"

type fakeShowService struct {
	result        showdomain.Show
	err           error
	creatorID     string
	showID        string
	username      string
	operationCall string
}

func (f *fakeShowService) Create(_ context.Context, creatorID string) (showdomain.Show, error) {
	f.creatorID, f.operationCall = creatorID, "create"
	return f.result, f.err
}
func (f *fakeShowService) Get(_ context.Context, showID, creatorID string) (showdomain.Show, error) {
	f.showID, f.creatorID, f.operationCall = showID, creatorID, "get"
	return f.result, f.err
}
func (f *fakeShowService) Start(_ context.Context, showID, creatorID string) (showdomain.Show, error) {
	f.showID, f.creatorID, f.operationCall = showID, creatorID, "start"
	return f.result, f.err
}
func (f *fakeShowService) End(_ context.Context, showID, creatorID string) (showdomain.Show, error) {
	f.showID, f.creatorID, f.operationCall = showID, creatorID, "end"
	return f.result, f.err
}
func (f *fakeShowService) LiveByUsername(_ context.Context, username string) (showdomain.Show, error) {
	f.username, f.operationCall = username, "live"
	return f.result, f.err
}

func showTestRouter(authentication *fakeAuthService, service *fakeShowService) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authenticationHandler := &authHandler{service: authentication, limiter: fakeLimiter{allowed: true}, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	shows := &showHandler{service: service, logger: logger}
	health := healthHandler{postgres: fakeDependency{}, redis: fakeDependency{}, timeout: time.Second}
	return newRouter(logger, health, authenticationHandler, shows, []string{"http://localhost:5173"})
}

func TestCreateShowUsesAuthenticatedCreator(t *testing.T) {
	service := &fakeShowService{result: showdomain.Show{ID: testShowID, Status: showdomain.StatusCreated}}
	router := showTestRouter(&fakeAuthService{user: auth.User{ID: "creator-1"}}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shows", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated || service.creatorID != "creator-1" || service.operationCall != "create" {
		t.Fatalf("unexpected create: status=%d creator=%q operation=%q body=%s", response.Code, service.creatorID, service.operationCall, response.Body.String())
	}
}

func TestShowMutationRejectsUnauthenticatedRequest(t *testing.T) {
	service := &fakeShowService{}
	router := showTestRouter(&fakeAuthService{err: auth.ErrInvalidSession}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/shows/"+testShowID+"/start", nil))

	if response.Code != http.StatusUnauthorized || service.operationCall != "" {
		t.Fatalf("unexpected response: %d operation=%q", response.Code, service.operationCall)
	}
}

func TestStartShowMapsActiveShowConflict(t *testing.T) {
	service := &fakeShowService{err: showdomain.ErrActiveShowExists}
	router := showTestRouter(&fakeAuthService{user: auth.User{ID: "creator-1"}}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/shows/"+testShowID+"/start", nil))

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"ACTIVE_SHOW_EXISTS"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestInvalidShowIDIsRejectedBeforeRepository(t *testing.T) {
	service := &fakeShowService{}
	router := showTestRouter(&fakeAuthService{user: auth.User{ID: "creator-1"}}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/shows/not-a-uuid", nil))

	if response.Code != http.StatusBadRequest || service.operationCall != "" {
		t.Fatalf("unexpected response: %d operation=%q", response.Code, service.operationCall)
	}
}

func TestPublicLiveShowUsesNormalizedUsername(t *testing.T) {
	service := &fakeShowService{result: showdomain.Show{ID: testShowID, Status: showdomain.StatusLive}}
	router := showTestRouter(&fakeAuthService{}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/creators/Alice/live-show", nil))

	if response.Code != http.StatusOK || service.username != "alice" || !strings.Contains(response.Body.String(), `"status":"LIVE"`) {
		t.Fatalf("unexpected response: %d username=%q body=%s", response.Code, service.username, response.Body.String())
	}
}

func TestPublicMissingLiveShowHasStableError(t *testing.T) {
	service := &fakeShowService{err: showdomain.ErrNotFound}
	router := showTestRouter(&fakeAuthService{}, service)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/creators/alice/live-show", nil))

	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"NO_LIVE_SHOW"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}
