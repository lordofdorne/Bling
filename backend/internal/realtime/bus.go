package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Subscription interface {
	Events() <-chan Event
	Close() error
}

type Bus interface {
	Publish(context.Context, Event) error
	Subscribe(context.Context, string) (Subscription, error)
}

type RedisBus struct {
	client *redis.Client
	now    func() time.Time
}

func NewRedisBus(client *redis.Client) *RedisBus {
	return &RedisBus{client: client, now: time.Now}
}

func (b *RedisBus) PublishQueueEvent(ctx context.Context, showID, eventType string) error {
	eventType = mapQueueEventType(eventType)
	if eventType == "" {
		return nil
	}
	return b.Publish(ctx, Event{Type: eventType, ShowID: showID, OccurredAt: b.now().UTC()})
}

func (b *RedisBus) Publish(ctx context.Context, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode realtime event: %w", err)
	}
	if err := b.client.Publish(ctx, showChannel(event.ShowID), payload).Err(); err != nil {
		return fmt.Errorf("publish realtime event: %w", err)
	}
	return nil
}

func (b *RedisBus) Subscribe(ctx context.Context, showID string) (Subscription, error) {
	pubsub := b.client.Subscribe(ctx, showChannel(showID))
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, fmt.Errorf("subscribe to realtime show: %w", err)
	}
	subscriptionCtx, cancel := context.WithCancel(ctx)
	subscription := &redisSubscription{
		pubsub: pubsub,
		events: make(chan Event, 256),
		cancel: cancel,
	}
	go subscription.run(subscriptionCtx)
	return subscription, nil
}

type redisSubscription struct {
	pubsub    *redis.PubSub
	events    chan Event
	cancel    context.CancelFunc
	closeOnce sync.Once
	closeErr  error
}

func (s *redisSubscription) Events() <-chan Event { return s.events }

func (s *redisSubscription) Close() error {
	s.closeOnce.Do(func() {
		s.cancel()
		s.closeErr = s.pubsub.Close()
	})
	return s.closeErr
}

func (s *redisSubscription) run(ctx context.Context) {
	defer close(s.events)
	messages := s.pubsub.Channel(redis.WithChannelSize(256), redis.WithChannelSendTimeout(time.Second))
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			var event Event
			if json.Unmarshal([]byte(message.Payload), &event) != nil || event.ShowID == "" || event.Type == "" {
				continue
			}
			select {
			case s.events <- event:
			case <-ctx.Done():
				return
			}
		}
	}
}

func mapQueueEventType(eventType string) string {
	switch eventType {
	case "queue.caller_joined":
		return EventQueueJoined
	case "queue.caller_left":
		return EventQueueLeft
	case "queue.show_ended":
		return EventShowEnded
	default:
		return ""
	}
}

func showChannel(showID string) string { return "realtime:show:" + showID }
