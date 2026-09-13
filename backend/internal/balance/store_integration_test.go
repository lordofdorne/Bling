package balance

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMonthlyRunReservesAvailableBalanceExactlyOnce(t *testing.T) {
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
	var creatorID string
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,email,password_hash) VALUES($1,$2,'integration-test-only') RETURNING id`, "balance_"+suffix, "balance_"+suffix+"@example.com").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM creator_ledger_entries WHERE creator_id=$1`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM creator_payout_items WHERE creator_id=$1`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM creator_payout_runs WHERE NOT EXISTS(SELECT 1 FROM creator_payout_items i WHERE i.run_id=creator_payout_runs.id)`)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM creator_payout_accounts WHERE creator_id=$1`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id=$1`, creatorID)
	}()
	if _, err := pool.Exec(ctx, `INSERT INTO creator_payout_accounts(creator_id,stripe_account_id,transfers_status,charges_enabled,payouts_enabled,details_submitted) VALUES($1,$2,'active',true,true,true)`, creatorID, "acct_balance_"+suffix); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := pool.Exec(ctx, `INSERT INTO creator_ledger_entries(creator_id,kind,amount_cents,currency,effective_at,idempotency_key) VALUES($1,'ADJUSTMENT',7000,'usd',$2,$3)`, creatorID, now.Add(-time.Hour), "balance-test:"+suffix); err != nil {
		t.Fatal(err)
	}
	repository := NewPostgresRepository(pool)
	year := 2300 + int(random[0])*4 + int(random[1])%4
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	if err := repository.CreateMonthlyRun(ctx, start, end, "usd", 2500, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.CreateMonthlyRun(ctx, start, end, "usd", 2500, now); err != nil {
		t.Fatal(err)
	}
	var items, reservations int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM creator_payout_items WHERE creator_id=$1`, creatorID).Scan(&items); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM creator_ledger_entries WHERE creator_id=$1 AND kind='PAYOUT_RESERVATION'`, creatorID).Scan(&reservations); err != nil {
		t.Fatal(err)
	}
	if items != 1 || reservations != 1 {
		t.Fatalf("items=%d reservations=%d", items, reservations)
	}
	requests, err := repository.ClaimTransfers(ctx, now, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || requests[0].AmountCents != 7000 {
		t.Fatalf("requests=%+v", requests)
	}
	second, err := repository.ClaimTransfers(ctx, now, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 0 {
		t.Fatalf("second claim=%+v", second)
	}
	if err := repository.MarkPaid(ctx, requests[0].ItemID, "tr_"+suffix, now); err != nil {
		t.Fatal(err)
	}
	if err := repository.FinishRuns(ctx, now); err != nil {
		t.Fatal(err)
	}
	summary, err := repository.Summary(ctx, creatorID, "usd", now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalCents != 0 || summary.AvailableCents != 0 || summary.PendingCents != 0 {
		t.Fatalf("summary=%+v", summary)
	}
}
