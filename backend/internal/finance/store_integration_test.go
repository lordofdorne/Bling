package finance

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFinancialEventLedgerAndCreatorActivity(t *testing.T) {
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

	var creatorID, showID, tierID, attemptID string
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,email,password_hash) VALUES($1,$2,'integration-test-only') RETURNING id`, "finance_"+suffix, "finance_"+suffix+"@example.com").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, creatorID) }()
	accountID := "acct_finance_" + suffix
	if _, err := pool.Exec(ctx, `INSERT INTO creator_payout_accounts(creator_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted) VALUES($1,$2,true,true,true)`, creatorID, accountID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO shows(creator_id,status,started_at) VALUES($1,'LIVE',now()) RETURNING id`, creatorID).Scan(&showID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO show_tiers(show_id,name,priority_rank,call_duration_seconds,price_cents) VALUES($1,'VIP',100,120,2500) RETURNING id`, showID).Scan(&tierID); err != nil {
		t.Fatal(err)
	}
	intentID := "pi_finance_" + suffix
	if err := pool.QueryRow(ctx, `INSERT INTO payment_attempts(show_id,tier_id,viewer_token_hash,idempotency_key_hash,stripe_payment_intent_id,destination_account_id,amount_cents,platform_fee_bps,platform_fee_cents,status,captured_at) VALUES($1,$2,$3,$4,$5,$6,2500,3000,750,'CAPTURED',now()) RETURNING id`, showID, tierID, []byte("viewer"), []byte("attempt"), intentID, accountID).Scan(&attemptID); err != nil {
		t.Fatal(err)
	}

	repository := NewPostgresRepository(pool)
	claimed, err := repository.ClaimEvent(ctx, "evt_"+suffix, "charge.dispute.created", "", time.Now().UTC())
	if err != nil || claimed != EventClaimed {
		t.Fatalf("first claim=%v err=%v", claimed, err)
	}
	claimed, err = repository.ClaimEvent(ctx, "evt_"+suffix, "charge.dispute.created", "", time.Now().UTC())
	if err != nil || claimed != EventBusy {
		t.Fatalf("duplicate claim=%v err=%v", claimed, err)
	}
	if err := repository.CompleteEvent(ctx, "evt_"+suffix, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	claimed, err = repository.ClaimEvent(ctx, "evt_"+suffix, "charge.dispute.created", "", time.Now().UTC())
	if err != nil || claimed != EventProcessed {
		t.Fatalf("processed claim=%v err=%v", claimed, err)
	}
	if err := repository.UpsertDispute(ctx, Dispute{ID: "dp_" + suffix, StripePaymentIntentID: intentID, AmountCents: 2500, Currency: "usd", Reason: "fraudulent", Status: "needs_response"}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := repository.UpsertPayout(ctx, Payout{ID: "po_" + suffix, StripeAccountID: accountID, AmountCents: 1750, Currency: "usd", Status: "failed", FailureCode: "account_closed"}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	activity, err := repository.ActivityForCreator(ctx, creatorID, 10)
	if err != nil || len(activity) != 1 || activity[0].PaymentAttemptID != attemptID || activity[0].DisputeStatus != "needs_response" {
		t.Fatalf("activity=%+v err=%v", activity, err)
	}
	failure, err := repository.LatestPayoutFailure(ctx, creatorID)
	if err != nil || failure == nil || failure.FailureCode != "account_closed" {
		t.Fatalf("failure=%+v err=%v", failure, err)
	}
}
