package realtime

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestPresenceMemberRoundTrip(t *testing.T) {
	member := presenceMember("call-id", RoleViewer, "connection-id")
	callID, role, connectionID, ok := parsePresenceMember(member)
	if !ok || callID != "call-id" || role != RoleViewer || connectionID != "connection-id" {
		t.Fatalf("parsed %q as %q %q %q ok=%v", member, callID, role, connectionID, ok)
	}
	if _, _, _, ok := parsePresenceMember("invalid"); ok {
		t.Fatal("accepted malformed presence member")
	}
}

func TestRedisPresenceHandlesMultipleConnectionsAndExpiry(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL is not set")
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	store := NewPresenceStore(client, 20*time.Millisecond)
	callID := fmt.Sprintf("presence-%d", time.Now().UnixNano())
	now := time.Now().UTC()
	if err := store.Touch(ctx, callID, RoleViewer, "one", now); err != nil {
		t.Fatal(err)
	}
	if err := store.Touch(ctx, callID, RoleViewer, "two", now); err != nil {
		t.Fatal(err)
	}
	disconnected, err := store.Disconnect(ctx, callID, RoleViewer, "one", now)
	if err != nil || disconnected {
		t.Fatalf("first disconnect: disconnected=%v err=%v", disconnected, err)
	}
	expired, err := store.Reap(ctx, now.Add(30*time.Millisecond), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 1 || expired[0].CallID != callID || expired[0].Role != RoleViewer {
		t.Fatalf("expired=%+v", expired)
	}
}
