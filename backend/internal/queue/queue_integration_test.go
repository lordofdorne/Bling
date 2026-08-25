package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	showdomain "github.com/bling-app/bling/backend/internal/show"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func TestDurableQueueConcurrentJoinRecoveryAndShutdown(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("TEST_DATABASE_URL and TEST_REDIS_URL are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	redisClient := redis.NewClient(options)
	defer redisClient.Close()

	suffixBytes := make([]byte, 6)
	if _, err := rand.Read(suffixBytes); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(suffixBytes)
	var creatorID string
	if err := pool.QueryRow(ctx, `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'test') RETURNING id`, "queue_"+suffix, "queue_"+suffix+"@example.com").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1`, creatorID)
	}()

	showStore := showdomain.NewPostgresStore(pool)
	activeShow, err := showStore.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	activeShow, err = showStore.Start(ctx, activeShow.ID, creatorID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	repository := NewPostgresRepository(pool)
	index := NewRedisCandidateIndex(redisClient)
	service := NewService(repository, index, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer index.Clear(context.Background(), activeShow.ID)

	const callers = 100
	start := make(chan struct{})
	results := make(chan error, callers)
	var wait sync.WaitGroup
	for caller := 0; caller < callers; caller++ {
		caller := caller
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := service.Join(ctx, JoinInput{
				ShowID: activeShow.ID, DisplayName: fmt.Sprintf("Caller %d", caller), Topic: "A production question",
				SessionTokenHash: Hash(fmt.Sprintf("viewer-%s-%d", suffix, caller)),
				JoinKeyHash:      Hash(fmt.Sprintf("join-%s-%d", suffix, caller)),
			})
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatalf("concurrent join: %v", err)
		}
	}
	entries, err := service.List(ctx, activeShow.ID, creatorID, callers, 0)
	if err != nil || len(entries) != callers {
		t.Fatalf("queue length=%d err=%v", len(entries), err)
	}
	for position := 1; position < len(entries); position++ {
		if entries[position-1].QueuePosition >= entries[position].QueuePosition {
			t.Fatalf("queue is not ordered at %d", position)
		}
	}

	duplicate := JoinInput{ShowID: activeShow.ID, DisplayName: "Retry caller", Topic: "Retries", SessionTokenHash: Hash("retry-viewer-" + suffix), JoinKeyHash: Hash("retry-join-" + suffix)}
	duplicateIDs := make(chan string, 10)
	results = make(chan error, 10)
	for attempt := 0; attempt < 10; attempt++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			state, err := service.Join(ctx, duplicate)
			results <- err
			duplicateIDs <- state.Entry.ID
		}()
	}
	wait.Wait()
	close(results)
	close(duplicateIDs)
	for err := range results {
		if err != nil {
			t.Fatalf("idempotent join: %v", err)
		}
	}
	var duplicateID string
	for id := range duplicateIDs {
		if duplicateID == "" {
			duplicateID = id
		} else if id != duplicateID {
			t.Fatalf("duplicate join produced %q and %q", duplicateID, id)
		}
	}
	state, err := service.Me(ctx, activeShow.ID, duplicate.SessionTokenHash)
	if err != nil || state.Entry.ID != duplicateID || state.Position == 0 {
		t.Fatalf("recovery state=%+v err=%v", state, err)
	}
	if _, err := service.List(ctx, activeShow.ID, "00000000-0000-0000-0000-000000000000", 10, 0); !errors.Is(err, ErrShowNotFound) {
		t.Fatalf("cross-creator list err=%v", err)
	}
	if _, err := service.Leave(ctx, activeShow.ID, duplicate.SessionTokenHash); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Me(ctx, activeShow.ID, duplicate.SessionTokenHash); err != nil {
		t.Fatalf("left entry should remain recoverable: %v", err)
	}

	if _, err := showStore.End(ctx, activeShow.ID, creatorID, time.Now()); err != nil {
		t.Fatal(err)
	}
	// Drain more than one worker page so the terminal clear follows all joins.
	service.flushOutbox(ctx)
	service.flushOutbox(ctx)
	remaining, err := index.List(ctx, activeShow.ID, 10, 0)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("ended queue index=%v err=%v", remaining, err)
	}
	if _, err := service.Join(ctx, JoinInput{ShowID: activeShow.ID, DisplayName: "Late", Topic: "Too late", SessionTokenHash: Hash("late-viewer"), JoinKeyHash: Hash("late-join")}); !errors.Is(err, ErrShowNotLive) {
		t.Fatalf("join after end err=%v", err)
	}
}
