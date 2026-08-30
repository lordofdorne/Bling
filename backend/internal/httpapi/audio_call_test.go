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

	calldomain "github.com/bling-app/bling/backend/internal/call"
	"github.com/bling-app/bling/backend/internal/config"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/go-chi/chi/v5"
)

const testCallID = "223e4567-e89b-42d3-a456-426614174000"

type fakeCallService struct {
	value     calldomain.Call
	err       error
	target    calldomain.Status
	tokenHash []byte
}

func (f *fakeCallService) SelectManual(context.Context, string, string, string) (calldomain.Call, error) {
	return f.value, f.err
}
func (f *fakeCallService) SelectRandom(context.Context, string, string) (calldomain.Call, error) {
	return f.value, f.err
}
func (f *fakeCallService) CreatorActive(context.Context, string, string) (calldomain.Call, error) {
	return f.value, f.err
}
func (f *fakeCallService) ViewerLatest(context.Context, string, []byte) (calldomain.Call, error) {
	return f.value, f.err
}
func (f *fakeCallService) Transition(_ context.Context, _, _, _ string, target calldomain.Status) (calldomain.Call, error) {
	f.target = target
	return f.value, f.err
}
func (f *fakeCallService) TransitionViewer(_ context.Context, _, _ string, tokenHash []byte, target calldomain.Status) (calldomain.Call, error) {
	f.target, f.tokenHash = target, tokenHash
	return f.value, f.err
}

type fakeSignalCallService struct {
	err       error
	tokenHash []byte
}

func (f *fakeSignalCallService) AuthorizeCreator(context.Context, string, string, string) error {
	return f.err
}
func (f *fakeSignalCallService) AuthorizeViewer(_ context.Context, _, _ string, tokenHash []byte) error {
	f.tokenHash = tokenHash
	return f.err
}
func (f *fakeSignalCallService) ParticipantConnected(context.Context, string, string) error {
	return f.err
}
func (f *fakeSignalCallService) ParticipantDisconnected(context.Context, string, string) error {
	return f.err
}

func TestViewerCanTransitionOnlyTheirCallToLive(t *testing.T) {
	service := &fakeCallService{value: calldomain.Call{ID: testCallID, Status: calldomain.StatusLive}}
	handler := callHandler{service: service, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	router := chi.NewRouter()
	router.Post("/api/v1/shows/{showID}/calls/{callID}/viewer-transition", handler.viewerTransition)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shows/"+testShowID+"/calls/"+testCallID+"/viewer-transition", strings.NewReader(`{"status":"LIVE"}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: viewerCookieName, Value: "viewer-secret"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || service.target != calldomain.StatusLive || string(service.tokenHash) != string(queuedomain.Hash("viewer-secret")) {
		t.Fatalf("status=%d target=%q body=%s", response.Code, service.target, response.Body.String())
	}
}

func TestRTCConfigMintsShortLivedTURNCredentials(t *testing.T) {
	handler := callSignalHandler{
		iceServers: []config.ICEServer{{URLs: []string{"stun:relay.example"}}},
		turnURL:    "turn:relay.example", turnSharedSecret: "shared-secret", turnCredentialTTL: 10 * time.Minute,
	}
	servers := handler.iceServersFor("caller")
	if len(servers) != 2 || !strings.HasSuffix(servers[1].Username, ":caller") || servers[1].Credential == "" {
		t.Fatalf("unexpected ephemeral TURN servers: %+v", servers)
	}
	if servers[1].Credential == "shared-secret" {
		t.Fatal("shared TURN secret was exposed")
	}
}

func TestRTCConfigIsReturnedOnlyAfterActiveCallAuthorization(t *testing.T) {
	service := &fakeSignalCallService{}
	handler := callSignalHandler{
		service: service,
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		iceServers: []config.ICEServer{{URLs: []string{"stun:relay.example"}}, {
			URLs: []string{"turn:relay.example"}, Username: "ephemeral-user", Credential: "ephemeral-secret",
		}},
	}
	router := chi.NewRouter()
	router.Get("/api/v1/shows/{showID}/calls/{callID}/rtc-config", handler.viewerRTCConfig)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/shows/"+testShowID+"/calls/"+testCallID+"/rtc-config", nil)
	request.AddCookie(&http.Cookie{Name: viewerCookieName, Value: "viewer-secret"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "ephemeral-secret") || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d cache=%q body=%s", response.Code, response.Header().Get("Cache-Control"), response.Body.String())
	}
	if string(service.tokenHash) != string(queuedomain.Hash("viewer-secret")) {
		t.Fatal("RTC configuration used the wrong viewer identity")
	}

	service.err = calldomain.ErrCallNotFound
	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, request.Clone(context.Background()))
	if denied.Code != http.StatusNotFound || strings.Contains(denied.Body.String(), "ephemeral-secret") {
		t.Fatalf("unauthorized response=%d body=%s", denied.Code, denied.Body.String())
	}
}
