package realtime

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestRedisBusCarriesEventsAcrossInstances(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL is not set")
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	firstClient := redis.NewClient(options)
	defer firstClient.Close()
	secondClient := redis.NewClient(options)
	defer secondClient.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	showID := "integration-" + time.Now().Format("150405.000000000")
	firstBus := NewRedisBus(firstClient)
	secondBus := NewRedisBus(secondClient)
	subscription, err := secondBus.Subscribe(ctx, showID)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()

	if err := firstBus.PublishQueueEvent(ctx, showID, "queue.caller_joined"); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-subscription.Events():
		if event.Type != EventQueueJoined || event.ShowID != showID || event.OccurredAt.IsZero() {
			t.Fatalf("event=%+v", event)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for cross-instance event")
	}
}
