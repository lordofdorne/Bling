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

	intentID := "pi_payment_" + suffix
	var entryID, callID string
	if err := pool.QueryRow(ctx, `INSERT INTO queue_entries(show_id,tier_id,display_name,topic,session_token_hash,join_key_hash,tier_name,priority_rank,call_duration_seconds,payment_attempt_id)
		VALUES($1,$2,'Paid caller','Capture after end',$3,$4,'VIP',100,120,$5) RETURNING id`, showID, tierID, input.ViewerTokenHash, []byte("join"), attempt.ID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE payment_attempts SET queue_entry_id=$2,stripe_payment_intent_id=$3,status='AUTHORIZED',authorized_at=now() WHERE id=$1`, attempt.ID, entryID, intentID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO calls(show_id,queue_entry_id,status,payment_attempt_id) VALUES($1,$2,'PAYMENT_PENDING',$3) RETURNING id`, showID, entryID, attempt.ID).Scan(&callID); err != nil {
		t.Fatal(err)
	}
	endedAt := time.Now().UTC()
	if _, err := pool.Exec(ctx, `UPDATE shows SET status='ENDED',ended_at=$2 WHERE id=$1`, showID, endedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE calls SET status='ENDED',ended_at=$2 WHERE id=$1`, callID, endedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE queue_entries SET status='ENDED' WHERE id=$1`, entryID); err != nil {
		t.Fatal(err)
	}
	if err := repository.Reconcile(ctx, intentID, StatusCaptured, "", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var refundCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM payment_refunds WHERE payment_attempt_id=$1 AND call_id=$2 AND status='REQUESTED'`, attempt.ID, callID).Scan(&refundCount); err != nil {
		t.Fatal(err)
	}
	if refundCount != 1 {
		t.Fatalf("capture after show end queued %d refunds, want 1", refundCount)
	}
}
