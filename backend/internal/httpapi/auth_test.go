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

	"github.com/bling-app/bling/backend/internal/auth"
)

type fakeAuthService struct {
	user        auth.User
	token       string
	err         error
	logoutToken string
}

func (f *fakeAuthService) Register(context.Context, auth.RegisterInput) (auth.User, string, error) {
	return f.user, f.token, f.err
}
func (f *fakeAuthService) Login(context.Context, string, string) (auth.User, string, error) {
	return f.user, f.token, f.err
}
func (f *fakeAuthService) CurrentUser(context.Context, string) (auth.User, error) {
	return f.user, f.err
}
func (f *fakeAuthService) Logout(_ context.Context, token string) error {
	f.logoutToken = token
	return f.err
}

type fakeLimiter struct {
	allowed bool
	err     error
}

func (f fakeLimiter) Allow(context.Context, string, int, time.Duration) (bool, error) {
	return f.allowed, f.err
}

func authTestRouter(service *fakeAuthService, limiter auth.RateLimiter) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := &authHandler{service: service, limiter: limiter, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	health := healthHandler{postgres: fakeDependency{}, redis: fakeDependency{}, timeout: time.Second}
	return newRouter(logger, health, handler, nil, []string{"http://localhost:5173"})
}

func TestRegisterSetsSecureSessionCookie(t *testing.T) {
	service := &fakeAuthService{user: auth.User{ID: "user-1", Username: "alice", Email: "alice@example.com"}, token: "secret"}
	router := authTestRouter(service, fakeLimiter{allowed: true})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"username":"alice","email":"alice@example.com","password":"long-enough-password"}`))
	request.Header.Set("Origin", "http://localhost:5173")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName || !cookies[0].HttpOnly || cookies[0].Value != "secret" {
		t.Fatalf("unexpected cookies: %+v", cookies)
	}
}

func TestLoginReturnsStructuredCredentialError(t *testing.T) {
	router := authTestRouter(&fakeAuthService{err: auth.ErrInvalidCredentials}, fakeLimiter{allowed: true})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@example.com","password":"wrong"}`)))

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_CREDENTIALS"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestLoginRateLimit(t *testing.T) {
	router := authTestRouter(&fakeAuthService{}, fakeLimiter{allowed: false})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@example.com","password":"guess"}`)))

	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" {
		t.Fatalf("unexpected response: %d headers=%v", response.Code, response.Header())
	}
}

func TestMeRejectsMissingSession(t *testing.T) {
	router := authTestRouter(&fakeAuthService{err: auth.ErrInvalidSession}, fakeLimiter{allowed: true})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"UNAUTHENTICATED"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestLogoutClearsServerAndBrowserSession(t *testing.T) {
	service := &fakeAuthService{}
	router := authTestRouter(service, fakeLimiter{allowed: true})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "secret"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent || service.logoutToken != "secret" {
		t.Fatalf("unexpected logout: %d token=%q", response.Code, service.logoutToken)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 1 || cookies[0].MaxAge != -1 {
		t.Fatalf("session cookie was not cleared: %+v", cookies)
	}
}

func TestOriginProtectionRejectsUnknownBrowserOrigin(t *testing.T) {
	router := authTestRouter(&fakeAuthService{}, fakeLimiter{allowed: true})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{}`))
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"ORIGIN_NOT_ALLOWED"`) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestMeReturnsInternalErrorWithoutLeakingDetails(t *testing.T) {
	router := authTestRouter(&fakeAuthService{err: errors.New("database password leaked here")}, fakeLimiter{allowed: true})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))

	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "database password") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}
