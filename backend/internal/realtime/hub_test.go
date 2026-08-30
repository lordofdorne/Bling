package realtime

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

type fakeBus struct {
	mu             sync.Mutex
	subscriptions  int
	subscribeError error
	byShow         map[string]*fakeSubscription
}

type fakeSubscription struct {
	events    chan Event
	closed    chan struct{}
	closeOnce sync.Once
}

func newFakeBus() *fakeBus { return &fakeBus{byShow: make(map[string]*fakeSubscription)} }

func (b *fakeBus) Publish(_ context.Context, event Event) error {
	b.mu.Lock()
	subscription := b.byShow[event.ShowID]
	b.mu.Unlock()
	if subscription != nil {
		subscription.events <- event
	}
	return nil
}

func (b *fakeBus) Subscribe(_ context.Context, showID string) (Subscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribeError != nil {
		return nil, b.subscribeError
	}
	b.subscriptions++
	subscription := &fakeSubscription{events: make(chan Event, 16), closed: make(chan struct{})}
	b.byShow[showID] = subscription
	return subscription, nil
}

func (s *fakeSubscription) Events() <-chan Event { return s.events }
func (s *fakeSubscription) Close() error {
	s.closeOnce.Do(func() {
		close(s.closed)
		close(s.events)
	})
	return nil
}

func (b *fakeBus) subscription(showID string) *fakeSubscription {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.byShow[showID]
}

func testHub(ctx context.Context, bus Bus, buffer, capacity int) *Hub {
	return NewHub(ctx, bus, slog.New(slog.NewTextHandler(io.Discard, nil)), buffer, capacity)
}

func TestHubSharesOneShowSubscriptionAndFansOut(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := newFakeBus()
	hub := testHub(ctx, bus, 2, 10)
	first, err := hub.Subscribe(ctx, "show-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := hub.Subscribe(ctx, "show-1")
	if err != nil {
		t.Fatal(err)
	}
	if bus.subscriptions != 1 || hub.ConnectionCount("show-1") != 2 {
		t.Fatalf("subscriptions=%d connections=%d", bus.subscriptions, hub.ConnectionCount("show-1"))
	}

	event := Event{Type: EventQueueJoined, ShowID: "show-1", OccurredAt: time.Now()}
	bus.subscription("show-1").events <- event
	for number, client := range []*Client{first, second} {
		select {
		case payload := <-client.Messages:
			if len(payload) == 0 {
				t.Fatalf("client %d received an empty event", number)
			}
		case <-time.After(time.Second):
			t.Fatalf("client %d did not receive the event", number)
		}
	}
	hub.Unsubscribe("show-1", first)
	hub.Unsubscribe("show-1", second)
	select {
	case <-bus.subscription("show-1").closed:
	case <-time.After(time.Second):
		t.Fatal("last disconnect did not close the show subscription")
	}
}

func TestHubDropsSlowClientWithoutBlockingFanout(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := newFakeBus()
	hub := testHub(ctx, bus, 1, 10)
	slow, _ := hub.Subscribe(ctx, "show-1")
	fast, _ := hub.Subscribe(ctx, "show-1")
	subscription := bus.subscription("show-1")
	subscription.events <- Event{Type: EventQueueJoined, ShowID: "show-1"}
	select {
	case <-fast.Messages:
	case <-time.After(time.Second):
		t.Fatal("fast client missed first event")
	}
	subscription.events <- Event{Type: EventQueueLeft, ShowID: "show-1"}
	select {
	case <-slow.Done():
	case <-time.After(time.Second):
		t.Fatal("slow client was not disconnected")
	}
	select {
	case <-fast.Messages:
	case <-time.After(time.Second):
		t.Fatal("slow client blocked fast client")
	}
	hub.Unsubscribe("show-1", fast)
}

func TestHubEnforcesPerShowCapacity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := newFakeBus()
	hub := testHub(ctx, bus, 1, 1)
	client, err := hub.Subscribe(ctx, "show-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hub.Subscribe(ctx, "show-1"); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("capacity error=%v", err)
	}
	hub.Unsubscribe("show-1", client)
}

func TestHubFansOutToHundredsOfClientsWithOneSubscription(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := newFakeBus()
	hub := testHub(ctx, bus, 1, 600)
	clients := make([]*Client, 500)
	for index := range clients {
		client, err := hub.Subscribe(ctx, "show-1")
		if err != nil {
			t.Fatal(err)
		}
		clients[index] = client
	}
	if bus.subscriptions != 1 {
		t.Fatalf("Redis subscriptions=%d, want 1", bus.subscriptions)
	}
	bus.subscription("show-1").events <- Event{Type: EventQueueJoined, ShowID: "show-1"}
	for index, client := range clients {
		select {
		case <-client.Messages:
		case <-time.After(time.Second):
			t.Fatalf("client %d missed fanout", index)
		}
		hub.Unsubscribe("show-1", client)
	}
	if hub.ConnectionCount("show-1") != 0 {
		t.Fatalf("connections=%d after cleanup", hub.ConnectionCount("show-1"))
	}
}

func TestHubReturnsBrokerSubscriptionFailure(t *testing.T) {
	bus := newFakeBus()
	bus.subscribeError = errors.New("redis unavailable")
	hub := testHub(context.Background(), bus, 1, 1)
	if _, err := hub.Subscribe(context.Background(), "show-1"); err == nil {
		t.Fatal("expected subscription failure")
	}
}
