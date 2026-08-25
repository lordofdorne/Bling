package show

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConcurrentStartAllowsOneLiveShowPerCreator(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	suffixBytes := make([]byte, 6)
	if _, err := rand.Read(suffixBytes); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(suffixBytes)
	var creatorID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash)
		VALUES ($1, $2, 'integration-test-only') RETURNING id`, "show_"+suffix, "show_"+suffix+"@example.com").Scan(&creatorID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1`, creatorID)
	}()

	store := NewPostgresStore(pool)
	first, err := store.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, showID := range []string{first.ID, second.ID} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := store.Start(ctx, showID, creatorID, time.Now())
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)

	successes, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrActiveShowExists):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent start error: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent starts = %d successes, %d conflicts; want one each", successes, conflicts)
	}

	var liveCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM shows WHERE creator_id = $1 AND status = 'LIVE'`, creatorID).Scan(&liveCount); err != nil {
		t.Fatal(err)
	}
	if liveCount != 1 {
		t.Fatalf("live show count = %d, want 1", liveCount)
	}
}
