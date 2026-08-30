package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	RoleCreator  = "creator"
	RoleViewer   = "viewer"
	SignalOffer  = "signal.offer"
	SignalAnswer = "signal.answer"
	SignalICE    = "signal.ice"
	SignalReady  = "signal.ready"
)

type Signal struct {
	Type       string          `json:"type"`
	CallID     string          `json:"callId"`
	From       string          `json:"from"`
	Target     string          `json:"target"`
	Payload    json.RawMessage `json:"payload"`
	OccurredAt time.Time       `json:"occurredAt"`
}

type SignalSubscription interface {
	Signals() <-chan Signal
	Close() error
}

func (b *RedisBus) PublishSignal(ctx context.Context, signal Signal) error {
	if signal.OccurredAt.IsZero() {
		signal.OccurredAt = b.now().UTC()
	}
	payload, err := json.Marshal(signal)
	if err != nil {
		return fmt.Errorf("encode private signal: %w", err)
	}
	if err := b.client.Publish(ctx, callChannel(signal.CallID), payload).Err(); err != nil {
		return fmt.Errorf("publish private signal: %w", err)
	}
	return nil
}

func (b *RedisBus) SubscribeSignals(ctx context.Context, callID string) (SignalSubscription, error) {
	pubsub := b.client.Subscribe(ctx, callChannel(callID))
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, fmt.Errorf("subscribe to private call: %w", err)
	}
	subscriptionCtx, cancel := context.WithCancel(ctx)
	value := &redisSignalSubscription{pubsub: pubsub, signals: make(chan Signal, 32), cancel: cancel}
	go value.run(subscriptionCtx)
	return value, nil
}

type redisSignalSubscription struct {
	pubsub  *redis.PubSub
	signals chan Signal
	cancel  context.CancelFunc
	once    sync.Once
	err     error
}

func (s *redisSignalSubscription) Signals() <-chan Signal { return s.signals }
func (s *redisSignalSubscription) Close() error {
	s.once.Do(func() { s.cancel(); s.err = s.pubsub.Close() })
	return s.err
}
func (s *redisSignalSubscription) run(ctx context.Context) {
	defer close(s.signals)
	messages := s.pubsub.Channel(redis.WithChannelSize(32), redis.WithChannelSendTimeout(time.Second))
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			var signal Signal
			if json.Unmarshal([]byte(message.Payload), &signal) != nil || signal.CallID == "" || signal.Target == "" {
				continue
			}
			select {
			case s.signals <- signal:
			case <-ctx.Done():
				return
			}
		}
	}
}

type SignalBus interface {
	PublishSignal(context.Context, Signal) error
	SubscribeSignals(context.Context, string) (SignalSubscription, error)
}

type SignalHub struct {
	ctx        context.Context
	bus        SignalBus
	logger     *slog.Logger
	bufferSize int
	maxPerCall int
	mu         sync.Mutex
	rooms      map[string]*signalRoom
}

type signalRoom struct {
	subscription SignalSubscription
	clients      map[*SignalClient]string
	cancel       context.CancelFunc
}

type SignalClient struct {
	Messages <-chan []byte
	messages chan []byte
	done     chan struct{}
	once     sync.Once
}

func NewSignalHub(ctx context.Context, bus SignalBus, logger *slog.Logger, bufferSize, maxPerCall int) *SignalHub {
	return &SignalHub{ctx: ctx, bus: bus, logger: logger, bufferSize: bufferSize, maxPerCall: maxPerCall, rooms: make(map[string]*signalRoom)}
}

func (h *SignalHub) Subscribe(ctx context.Context, callID, role string) (*SignalClient, error) {
	h.mu.Lock()
	if target := h.rooms[callID]; target != nil {
		client, err := h.addClient(target, role)
		h.mu.Unlock()
		return client, err
	}
	h.mu.Unlock()
	roomCtx, cancel := context.WithCancel(h.ctx)
	subscription, err := h.bus.SubscribeSignals(roomCtx, callID)
	if err != nil {
		cancel()
		return nil, err
	}
	h.mu.Lock()
	if target := h.rooms[callID]; target != nil {
		client, addErr := h.addClient(target, role)
		h.mu.Unlock()
		cancel()
		_ = subscription.Close()
		return client, addErr
	}
	target := &signalRoom{subscription: subscription, clients: make(map[*SignalClient]string), cancel: cancel}
	h.rooms[callID] = target
	client, err := h.addClient(target, role)
	h.mu.Unlock()
	if err != nil {
		h.close(callID, target)
		return nil, err
	}
	go h.run(callID, target)
	return client, nil
}

func (h *SignalHub) addClient(target *signalRoom, role string) (*SignalClient, error) {
	if len(target.clients) >= h.maxPerCall {
		return nil, ErrRoomFull
	}
	messages := make(chan []byte, h.bufferSize)
	client := &SignalClient{Messages: messages, messages: messages, done: make(chan struct{})}
	target.clients[client] = role
	return client, nil
}

func (h *SignalHub) Publish(ctx context.Context, signal Signal) error {
	return h.bus.PublishSignal(ctx, signal)
}

func (h *SignalHub) Unsubscribe(callID string, client *SignalClient) {
	h.mu.Lock()
	target := h.rooms[callID]
	if target == nil {
		h.mu.Unlock()
		return
	}
	delete(target.clients, client)
	client.stop()
	empty := len(target.clients) == 0
	if empty {
		delete(h.rooms, callID)
	}
	h.mu.Unlock()
	if empty {
		target.cancel()
		_ = target.subscription.Close()
	}
}

func (h *SignalHub) run(callID string, target *signalRoom) {
	for {
		select {
		case <-h.ctx.Done():
			h.close(callID, target)
			return
		case signal, ok := <-target.subscription.Signals():
			if !ok {
				h.close(callID, target)
				return
			}
			if signal.CallID != callID {
				continue
			}
			payload, err := json.Marshal(signal)
			if err != nil {
				continue
			}
			h.mu.Lock()
			if h.rooms[callID] != target {
				h.mu.Unlock()
				return
			}
			for client, role := range target.clients {
				if role != signal.Target {
					continue
				}
				select {
				case client.messages <- payload:
				default:
					delete(target.clients, client)
					client.stop()
				}
			}
			empty := len(target.clients) == 0
			if empty {
				delete(h.rooms, callID)
			}
			h.mu.Unlock()
			if empty {
				target.cancel()
				_ = target.subscription.Close()
				return
			}
		}
	}
}

func (h *SignalHub) close(callID string, target *signalRoom) {
	h.mu.Lock()
	if h.rooms[callID] != target {
		h.mu.Unlock()
		return
	}
	delete(h.rooms, callID)
	for client := range target.clients {
		client.stop()
	}
	h.mu.Unlock()
	target.cancel()
	if err := target.subscription.Close(); err != nil && !errors.Is(err, context.Canceled) {
		h.logger.Debug("private signal subscription close failed", "error", err)
	}
}

func (c *SignalClient) Done() <-chan struct{} { return c.done }
func (c *SignalClient) stop()                 { c.once.Do(func() { close(c.done) }) }
func callChannel(callID string) string        { return "realtime:call:" + callID }
