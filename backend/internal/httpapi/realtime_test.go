package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/bling-app/bling/backend/internal/realtime"
	"github.com/coder/websocket"
)

type websocketTestBus struct {
	mu           sync.Mutex
	subscription *websocketTestSubscription
}

type websocketTestSubscription struct {
	events chan realtime.Event
	once   sync.Once
}

func (b *websocketTestBus) Publish(_ context.Context, event realtime.Event) error {
	b.mu.Lock()
	subscription := b.subscription
	b.mu.Unlock()
	if subscription != nil {
		subscription.events <- event
	}
	return nil
}

func (b *websocketTestBus) Subscribe(context.Context, string) (realtime.Subscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscription = &websocketTestSubscription{events: make(chan realtime.Event, 4)}
	return b.subscription, nil
}

func (s *websocketTestSubscription) Events() <-chan realtime.Event { return s.events }
func (s *websocketTestSubscription) Close() error {
	s.once.Do(func() { close(s.events) })
	return nil
}

func realtimeTestRouter(ctx context.Context, authentication *fakeAuthService, service *fakeQueueService, bus *websocketTestBus, limiters ...auth.RateLimiter) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authenticationHandler := &authHandler{service: authentication, limiter: fakeLimiter{allowed: true}, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	shows := &showHandler{service: &fakeShowService{}, logger: logger}
	queues := &queueHandler{service: service, logger: logger, cookieTTL: time.Hour}
	hub := realtime.NewHub(ctx, bus, logger, 2, 10)
	var limiter auth.RateLimiter = fakeLimiter{allowed: true}
	if len(limiters) > 0 {
		limiter = limiters[0]
	}
	updates := &realtimeHandler{
		service: service, hub: hub, limiter: limiter, logger: logger,
		allowedOrigins: []string{"http://localhost:5173"}, rateLimit: 10, rateWindow: time.Minute,
		heartbeat: time.Hour, writeTimeout: time.Second,
	}
	health := healthHandler{postgres: fakeDependency{}, redis: fakeDependency{}, timeout: time.Second}
	return newRouter(logger, health, authenticationHandler, shows, queues, updates, []string{"http://localhost:5173"})
}

func TestViewerWebsocketReceivesShowScopedEvent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := &websocketTestBus{}
	service := &fakeQueueService{state: queuedomain.ViewerState{Entry: queuedomain.Entry{Status: queuedomain.StatusWaiting}}}
	server := httptest.NewServer(realtimeTestRouter(ctx, &fakeAuthService{}, service, bus))
	defer server.Close()

	header := http.Header{}
	header.Set("Cookie", viewerCookieName+"=viewer-token")
	connection, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/shows/"+testShowID+"/queue/events", &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		if response != nil {
			t.Fatalf("dial status=%d err=%v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	defer connection.CloseNow()

	if err := bus.Publish(ctx, realtime.Event{Type: realtime.EventQueueJoined, ShowID: testShowID, OccurredAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	readCtx, readCancel := context.WithTimeout(ctx, time.Second)
	defer readCancel()
	_, payload, err := connection.Read(readCtx)
	if err != nil || !strings.Contains(string(payload), `"type":"queue.joined"`) || !strings.Contains(string(payload), `"showId":"`+testShowID+`"`) {
		t.Fatalf("payload=%s err=%v", payload, err)
	}
}

func TestViewerWebsocketRequiresQueueIdentity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewServer(realtimeTestRouter(ctx, &fakeAuthService{}, &fakeQueueService{}, &websocketTestBus{}))
	defer server.Close()
	response, err := http.Get(server.URL + "/api/v1/shows/" + testShowID + "/queue/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d", response.StatusCode)
	}
}

func TestWebsocketRejectsUntrustedOriginBeforeUpgrade(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := &websocketTestBus{}
	service := &fakeQueueService{state: queuedomain.ViewerState{Entry: queuedomain.Entry{Status: queuedomain.StatusWaiting}}}
	server := httptest.NewServer(realtimeTestRouter(ctx, &fakeAuthService{}, service, bus))
	defer server.Close()
	header := http.Header{}
	header.Set("Cookie", viewerCookieName+"=viewer-token")
	header.Set("Origin", "https://evil.example")
	_, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/shows/"+testShowID+"/queue/events", &websocket.DialOptions{HTTPHeader: header})
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("response=%v err=%v", response, err)
	}
}

func TestCreatorWebsocketVerifiesShowOwnership(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := &fakeQueueService{authorizeErr: queuedomain.ErrShowNotFound}
	server := httptest.NewServer(realtimeTestRouter(ctx, &fakeAuthService{user: auth.User{ID: "creator-1"}}, service, &websocketTestBus{}))
	defer server.Close()
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/shows/"+testShowID+"/queue/creator-events", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "session"})
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status=%d", response.StatusCode)
	}
}

func TestWebsocketConnectionAttemptsAreRateLimited(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewServer(realtimeTestRouter(ctx, &fakeAuthService{}, &fakeQueueService{}, &websocketTestBus{}, fakeLimiter{allowed: false}))
	defer server.Close()
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/shows/"+testShowID+"/queue/events", nil)
	request.AddCookie(&http.Cookie{Name: viewerCookieName, Value: "viewer-token"})
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests || response.Header.Get("Retry-After") == "" {
		t.Fatalf("status=%d headers=%v", response.StatusCode, response.Header)
	}
}
