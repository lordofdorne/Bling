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
	if _, err := pool.Exec(ctx, `INSERT INTO creator_payout_accounts(creator_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted) VALUES($1,$2,true,true,true)`, creatorID, "acct_show_"+suffix); err != nil {
		t.Fatal(err)
	}

	store := NewPostgresStore(pool)
	first, err := store.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	configured, err := store.ReplaceTiers(ctx, first.ID, creatorID, []TierInput{
		{Name: "VIP", PriorityRank: 200, CallDurationSeconds: 120, PriceCents: 5000, Enabled: true},
		{Name: "Standard", PriorityRank: 100, CallDurationSeconds: 300, PriceCents: 1000, Enabled: true},
	}, time.Now().UTC())
	if err != nil || len(configured) != 2 || configured[0].Name != "VIP" || configured[0].PriceCents != 5000 {
		t.Fatalf("configured=%+v err=%v", configured, err)
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
	current, err := store.CurrentForCreator(ctx, creatorID)
	if err != nil || current.Status != StatusLive {
		t.Fatalf("current=%+v err=%v", current, err)
	}
	if _, err := store.ReplaceTiers(ctx, current.ID, creatorID, []TierInput{{Name: "Late", PriorityRank: 100, CallDurationSeconds: 60, Enabled: true}}, time.Now().UTC()); !errors.Is(err, ErrShowNotConfigurable) {
		t.Fatalf("live tier replacement err=%v", err)
	}
	if _, err := store.End(ctx, current.ID, creatorID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	raceShow, err := store.Create(ctx, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	raceStart := make(chan struct{})
	startResult := make(chan error, 1)
	configureResult := make(chan error, 1)
	go func() {
		<-raceStart
		_, err := store.Start(ctx, raceShow.ID, creatorID, time.Now().UTC())
		startResult <- err
	}()
	go func() {
		<-raceStart
		_, err := store.ReplaceTiers(ctx, raceShow.ID, creatorID, []TierInput{
			{Name: "Priority", PriorityRank: 200, CallDurationSeconds: 120, PriceCents: 2000, Enabled: true},
			{Name: "Standard", PriorityRank: 100, CallDurationSeconds: 300, PriceCents: 500, Enabled: true},
		}, time.Now().UTC())
		configureResult <- err
	}()
	close(raceStart)
	if err := <-startResult; err != nil {
		t.Fatalf("start/configure race start err=%v", err)
	}
	if err := <-configureResult; err != nil && !errors.Is(err, ErrShowNotConfigurable) {
		t.Fatalf("start/configure race configure err=%v", err)
	}
	finalShow, err := store.ByIDForCreator(ctx, raceShow.ID, creatorID)
	if err != nil || finalShow.Status != StatusLive {
		t.Fatalf("raced show=%+v err=%v", finalShow, err)
	}
}
