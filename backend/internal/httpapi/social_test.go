package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
)

func socialSecurityRouter(limiter auth.RateLimiter) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authentication := &fakeAuthService{err: auth.ErrInvalidSession}
	a := &authHandler{service: authentication, limiter: limiter, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	h := &socialHandler{authentication: authentication, limiter: limiter, logger: logger}
	return newRouterWithCalls(logger, healthHandler{}, a, nil, nil, nil, nil, nil, nil, nil, nil, []string{"http://localhost:5173"}, h)
}
func TestSocialSecurityBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, body, contentType, origin string
		status                                        int
	}{
		{name: "following authentication", method: "GET", path: "/api/v1/following", status: 401},
		{name: "notifications authentication", method: "GET", path: "/api/v1/notifications", status: 401},
		{name: "profile authentication", method: "GET", path: "/api/v1/profile", status: 401},
		{name: "follow authentication", method: "POST", path: "/api/v1/creators/alice/follow", body: "{}", contentType: "application/json", status: 401},
		{name: "unfollow authentication", method: "DELETE", path: "/api/v1/creators/alice/follow", status: 401},
		{name: "cross origin rejected", method: "POST", path: "/api/v1/creators/alice/follow", body: "{}", contentType: "application/json", origin: "https://evil.example", status: 403},
		{name: "simple form csrf rejected", method: "POST", path: "/api/v1/creators/alice/presence", body: "x=y", contentType: "application/x-www-form-urlencoded", status: 415},
		{name: "oversized page", method: "GET", path: "/api/v1/creators?limit=5000", status: 422},
		{name: "invalid cursor", method: "GET", path: "/api/v1/creators?cursor=not-valid", status: 422},
		{name: "invalid live", method: "GET", path: "/api/v1/creators?live=anything", status: 422},
		{name: "invalid category", method: "GET", path: "/api/v1/creators?category=invalid", status: 422},
		{name: "invalid username", method: "GET", path: "/api/v1/creators/x", status: 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			r.Header.Set("Origin", tc.origin)
			w := httptest.NewRecorder()
			socialSecurityRouter(fakeLimiter{allowed: true}).ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status != 403 && !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
				t.Fatal("private response cacheable")
			}
		})
	}
}
func TestSocialRateLimitAndUnavailableLimiter(t *testing.T) {
	for _, tc := range []struct {
		limiter fakeLimiter
		status  int
	}{{fakeLimiter{}, 429}, {fakeLimiter{err: errors.New("redis down")}, 503}} {
		w := httptest.NewRecorder()
		socialSecurityRouter(tc.limiter).ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/creators", nil))
		if w.Code != tc.status {
			t.Fatalf("status %d", w.Code)
		}
		if tc.status == 429 && w.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry-after")
		}
	}
}

func TestSocialClientIPTrustBoundary(t *testing.T) {
	h := socialHandler{trustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/24")}}
	for _, tc := range []struct{ peer, forwarded, want string }{
		{"203.0.113.5", "1.1.1.1", "203.0.113.5"},
		{"10.0.0.2", "198.51.100.8,10.0.0.3", "198.51.100.8"},
		{"10.0.0.2", "1.1.1.1,203.0.113.7", "203.0.113.7"},
		{"10.0.0.2", "invalid", "10.0.0.2"},
		{"::ffff:203.0.113.5", "1.1.1.1", "203.0.113.5"},
	} {
		if got := h.clientIP(tc.peer, tc.forwarded); got != tc.want {
			t.Errorf("got %s want %s", got, tc.want)
		}
	}
}
