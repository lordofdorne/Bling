package payment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPrepareSnapshotsCreatorDestinationAndThirtyPercentFee(t *testing.T) {
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

	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(random)
	var creatorID, showID, tierID string
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,email,password_hash) VALUES($1,$2,'integration-test-only') RETURNING id`, "payment_"+suffix, "payment_"+suffix+"@example.com").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, creatorID) }()
	if err := pool.QueryRow(ctx, `INSERT INTO shows(creator_id,status,started_at) VALUES($1,'LIVE',now()) RETURNING id`, creatorID).Scan(&showID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO show_tiers(show_id,name,priority_rank,call_duration_seconds,price_cents) VALUES($1,'VIP',100,120,999) RETURNING id`, showID).Scan(&tierID); err != nil {
		t.Fatal(err)
	}

	repository := NewPostgresRepository(pool)
	input := PrepareInput{ShowID: showID, TierID: tierID, ViewerTokenHash: []byte("viewer"), IdempotencyKeyHash: []byte("attempt")}
	if _, err := repository.Prepare(ctx, input, time.Now().UTC()); !errors.Is(err, ErrPayoutsNotReady) {
		t.Fatalf("without connected account error=%v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO creator_payout_accounts(creator_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted) VALUES($1,$2,true,true,true)`, creatorID, "acct_payment_"+suffix); err != nil {
		t.Fatal(err)
	}
	attempt, err := repository.Prepare(ctx, input, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if attempt.DestinationAccountID != "acct_payment_"+suffix || attempt.AmountCents != 999 || attempt.PlatformFeeBPS != 3000 || attempt.PlatformFeeCents != 299 {
		t.Fatalf("attempt=%+v", attempt)
	}
}
