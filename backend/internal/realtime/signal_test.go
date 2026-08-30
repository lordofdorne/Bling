package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

type fakeSignalBus struct {
	mu            sync.Mutex
	subscriptions int
	byCall        map[string]*fakeSignalSubscription
}

func TestSignalHubCapsParticipantConnectionsPerCall(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hub := NewSignalHub(ctx, newFakeSignalBus(), slog.New(slog.NewTextHandler(io.Discard, nil)), 1, 1)
	client, err := hub.Subscribe(ctx, "call-1", RoleCreator)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hub.Subscribe(ctx, "call-1", RoleViewer); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("capacity error=%v", err)
	}
	hub.Unsubscribe("call-1", client)
}

type fakeSignalSubscription struct {
	signals chan Signal
	once    sync.Once
}

func newFakeSignalBus() *fakeSignalBus {
	return &fakeSignalBus{byCall: make(map[string]*fakeSignalSubscription)}
}
func (b *fakeSignalBus) PublishSignal(_ context.Context, signal Signal) error {
	b.mu.Lock()
	sub := b.byCall[signal.CallID]
	b.mu.Unlock()
	if sub != nil {
		sub.signals <- signal
	}
	return nil
}
func (b *fakeSignalBus) SubscribeSignals(_ context.Context, callID string) (SignalSubscription, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscriptions++
	sub := &fakeSignalSubscription{signals: make(chan Signal, 8)}
	b.byCall[callID] = sub
	return sub, nil
}
func (s *fakeSignalSubscription) Signals() <-chan Signal { return s.signals }
func (s *fakeSignalSubscription) Close() error           { s.once.Do(func() { close(s.signals) }); return nil }

func TestSignalHubScopesMessagesToCallAndTargetRole(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bus := newFakeSignalBus()
	hub := NewSignalHub(ctx, bus, slog.New(slog.NewTextHandler(io.Discard, nil)), 2, 8)
	creator, _ := hub.Subscribe(ctx, "call-1", RoleCreator)
	viewer, _ := hub.Subscribe(ctx, "call-1", RoleViewer)
	otherViewer, _ := hub.Subscribe(ctx, "call-2", RoleViewer)
	if bus.subscriptions != 2 {
		t.Fatalf("subscriptions=%d want 2 call rooms", bus.subscriptions)
	}
	payload := json.RawMessage(`{"sdp":"private"}`)
	if err := hub.Publish(ctx, Signal{Type: SignalOffer, CallID: "call-1", From: RoleCreator, Target: RoleViewer, Payload: payload}); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-viewer.Messages:
		if string(message) == "" {
			t.Fatal("empty signal")
		}
	case <-time.After(time.Second):
		t.Fatal("target viewer missed signal")
	}
	select {
	case <-creator.Messages:
		t.Fatal("sender received private signal")
	case <-otherViewer.Messages:
		t.Fatal("other call received private signal")
	case <-time.After(50 * time.Millisecond):
	}
	hub.Unsubscribe("call-1", creator)
	hub.Unsubscribe("call-1", viewer)
	hub.Unsubscribe("call-2", otherViewer)
}
