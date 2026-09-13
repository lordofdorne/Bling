package call

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	showdomain "github.com/bling-app/bling/backend/internal/show"
	"github.com/jackc/pgx/v5/pgxpool"
)

type captureGateway struct {
	captures int
	intentID string
}

func (g *captureGateway) CreateAuthorization(context.Context, paymentdomain.Attempt) (paymentdomain.Intent, error) {
	return paymentdomain.Intent{}, errors.New("unexpected create")
}
func (g *captureGateway) Retrieve(context.Context, string) (paymentdomain.Intent, error) {
	return paymentdomain.Intent{}, errors.New("unexpected retrieve")
}
func (g *captureGateway) Capture(_ context.Context, id, key string) (paymentdomain.Intent, error) {
	g.captures++
	if id != g.intentID || key == "" {
		return paymentdomain.Intent{}, errors.New("invalid capture request")
	}
	return paymentdomain.Intent{ID: id, Status: "succeeded", AmountCents: 2500, Currency: "usd"}, nil
}
func (g *captureGateway) Cancel(context.Context, string, string) error {
	return errors.New("unexpected cancel")
}

func TestConcurrentSelectionCreatesExactlyOneActiveCall(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
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
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,email,password_hash) VALUES($1,$2,'test') RETURNING id`, "call_"+suffix, "call_"+suffix+"@example.com").Scan(&creatorID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM creator_ledger_entries WHERE creator_id=$1`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `UPDATE payment_attempts SET queue_entry_id=NULL WHERE show_id IN (SELECT id FROM shows WHERE creator_id=$1)`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `UPDATE queue_entries SET payment_attempt_id=NULL WHERE show_id IN (SELECT id FROM shows WHERE creator_id=$1)`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM calls WHERE show_id IN (SELECT id FROM shows WHERE creator_id=$1)`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM queue_entries WHERE show_id IN (SELECT id FROM shows WHERE creator_id=$1)`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM payment_attempts WHERE show_id IN (SELECT id FROM shows WHERE creator_id=$1)`, creatorID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id=$1`, creatorID)
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
	queueRepository := queuedomain.NewPostgresRepository(pool)
	entries := make([]queuedomain.Entry, 2)
	tokenHashes := make([][]byte, 2)
	for index := range entries {
		tokenHashes[index] = queuedomain.Hash("viewer-" + suffix + string(rune('a'+index)))
		entries[index], err = queueRepository.Join(ctx, queuedomain.JoinInput{ShowID: activeShow.ID, DisplayName: "Caller", Topic: "Concurrency", SessionTokenHash: tokenHashes[index], JoinKeyHash: queuedomain.Hash("join-" + suffix + string(rune('a'+index)))})
		if err != nil {
			t.Fatal(err)
		}
	}
	repository := NewPostgresRepository(pool)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, entry := range entries {
		entry := entry
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := repository.Select(ctx, activeShow.ID, creatorID, entry.ID, SelectionManual, time.Now().UTC())
			results <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrActiveCall) {
			conflicts++
		} else {
			t.Fatalf("selection error=%v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
	var activeCalls, selectedEntries int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM calls WHERE show_id=$1 AND status IN ('CREATED','CONNECTING','LIVE')`, activeShow.ID).Scan(&activeCalls); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM queue_entries WHERE show_id=$1 AND status IN ('SELECTED','CONNECTING','LIVE')`, activeShow.ID).Scan(&selectedEntries); err != nil {
		t.Fatal(err)
	}
	if activeCalls != 1 || selectedEntries != 1 {
		t.Fatalf("active calls=%d selected entries=%d", activeCalls, selectedEntries)
	}
	activeCall, err := repository.CreatorActive(ctx, activeShow.ID, creatorID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Transition(ctx, activeShow.ID, activeCall.ID, creatorID, StatusConnecting, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	disconnectedAt := time.Now().UTC()
	if err := repository.MarkParticipantDisconnected(ctx, activeCall.ID, "viewer", disconnectedAt); err != nil {
		t.Fatal(err)
	}
	if expired, err := repository.ExpireDisconnected(ctx, disconnectedAt.Add(10*time.Second), 20*time.Second, 10); err != nil || len(expired) != 0 {
		t.Fatalf("call expired inside reconnect grace: expired=%+v err=%v", expired, err)
	}
	if err := repository.MarkParticipantConnected(ctx, activeCall.ID, "viewer", disconnectedAt.Add(11*time.Second)); err != nil {
		t.Fatal(err)
	}
	if expired, err := repository.ExpireDisconnected(ctx, disconnectedAt.Add(time.Minute), 20*time.Second, 10); err != nil || len(expired) != 0 {
		t.Fatalf("reconnected call expired: expired=%+v err=%v", expired, err)
	}
	var winnerToken []byte
	for index, entry := range entries {
		if entry.ID == activeCall.QueueEntryID {
			winnerToken = tokenHashes[index]
		}
	}
	if winnerToken == nil {
		t.Fatal("selected caller token was not found")
	}
	startedAt := time.Now().UTC().Add(-time.Duration(activeCall.CallDurationSeconds+1) * time.Second)
	if _, err := repository.TransitionViewer(ctx, activeShow.ID, activeCall.ID, winnerToken, StatusLive, startedAt); err != nil {
		t.Fatal(err)
	}
	expired, err := repository.ExpireDue(ctx, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 1 || expired[0].Status != StatusEnded {
		t.Fatalf("expired calls=%+v", expired)
	}

	remainingID := ""
	for _, entry := range entries {
		if entry.ID != activeCall.QueueEntryID {
			remainingID = entry.ID
		}
	}
	secondCall, err := repository.Select(ctx, activeShow.ID, creatorID, remainingID, SelectionManual, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	secondDisconnectedAt := time.Now().UTC()
	if err := repository.MarkParticipantDisconnected(ctx, secondCall.ID, "creator", secondDisconnectedAt); err != nil {
		t.Fatal(err)
	}
	disconnected, err := repository.ExpireDisconnected(ctx, secondDisconnectedAt.Add(21*time.Second), 20*time.Second, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(disconnected) != 1 || disconnected[0].Status != StatusFailed {
		t.Fatalf("disconnected calls=%+v", disconnected)
	}

	var paidTierID, attemptID string
	if _, err := pool.Exec(ctx, `INSERT INTO creator_payout_accounts(creator_id,stripe_account_id,charges_enabled,payouts_enabled,details_submitted) VALUES($1,$2,true,true,true)`, creatorID, "acct_call_"+suffix); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO show_tiers(show_id,name,priority_rank,call_duration_seconds,price_cents) VALUES($1,'Paid',500,120,2500) RETURNING id`, activeShow.ID).Scan(&paidTierID); err != nil {
		t.Fatal(err)
	}
	paidToken := queuedomain.Hash("paid-viewer-" + suffix)
	intentID := "pi_paid_" + suffix
	if err := pool.QueryRow(ctx, `INSERT INTO payment_attempts(show_id,tier_id,viewer_token_hash,idempotency_key_hash,stripe_payment_intent_id,amount_cents,status,authorized_at) VALUES($1,$2,$3,$4,$5,2500,'AUTHORIZED',now()) RETURNING id`, activeShow.ID, paidTierID, paidToken, queuedomain.Hash("paid-attempt-"+suffix), intentID).Scan(&attemptID); err != nil {
		t.Fatal(err)
	}
	paidEntry, err := queueRepository.Join(ctx, queuedomain.JoinInput{ShowID: activeShow.ID, TierID: paidTierID, DisplayName: "Paid caller", Topic: "Paid selection", SessionTokenHash: paidToken, JoinKeyHash: queuedomain.Hash("paid-join-" + suffix), PaymentAttemptID: attemptID})
	if err != nil {
		t.Fatal(err)
	}
	gateway := &captureGateway{intentID: intentID}
	paidRepository := NewPostgresRepository(pool, gateway)
	paidCall, err := paidRepository.Select(ctx, activeShow.ID, creatorID, paidEntry.ID, SelectionManual, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if paidCall.Status != StatusCreated || gateway.captures != 1 {
		t.Fatalf("paid call=%+v captures=%d", paidCall, gateway.captures)
	}
	var paymentStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM payment_attempts WHERE id=$1`, attemptID).Scan(&paymentStatus); err != nil {
		t.Fatal(err)
	}
	if paymentStatus != "CAPTURED" {
		t.Fatalf("payment status=%q", paymentStatus)
	}
	if _, err := paidRepository.Transition(ctx, activeShow.ID, paidCall.ID, creatorID, StatusFailed, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var refundCount int
	var refundStatus, refundReason string
	if err := pool.QueryRow(ctx, `SELECT count(*),min(status),min(reason) FROM payment_refunds WHERE payment_attempt_id=$1`, attemptID).Scan(&refundCount, &refundStatus, &refundReason); err != nil {
		t.Fatal(err)
	}
	if refundCount != 1 || refundStatus != "REQUESTED" || refundReason != "call_failed_before_live" {
		t.Fatalf("refund count=%d status=%q reason=%q", refundCount, refundStatus, refundReason)
	}

	platformToken := queuedomain.Hash("platform-viewer-" + suffix)
	platformIntentID := "pi_platform_" + suffix
	var platformAttemptID string
	if err := pool.QueryRow(ctx, `INSERT INTO payment_attempts(show_id,tier_id,viewer_token_hash,idempotency_key_hash,stripe_payment_intent_id,payment_flow,amount_cents,platform_fee_bps,platform_fee_cents,status,authorized_at)
		VALUES($1,$2,$3,$4,$5,'PLATFORM',2500,3000,750,'AUTHORIZED',now()) RETURNING id`, activeShow.ID, paidTierID, platformToken, queuedomain.Hash("platform-attempt-"+suffix), platformIntentID).Scan(&platformAttemptID); err != nil {
		t.Fatal(err)
	}
	platformEntry, err := queueRepository.Join(ctx, queuedomain.JoinInput{ShowID: activeShow.ID, TierID: paidTierID, DisplayName: "Platform caller", Topic: "Ledger credit", SessionTokenHash: platformToken, JoinKeyHash: queuedomain.Hash("platform-join-" + suffix), PaymentAttemptID: platformAttemptID})
	if err != nil {
		t.Fatal(err)
	}
	gateway.intentID = platformIntentID
	platformCall, err := paidRepository.Select(ctx, activeShow.ID, creatorID, platformEntry.ID, SelectionManual, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	liveAt := time.Now().UTC()
	if _, err := paidRepository.Transition(ctx, activeShow.ID, platformCall.ID, creatorID, StatusConnecting, liveAt.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := paidRepository.Transition(ctx, activeShow.ID, platformCall.ID, creatorID, StatusLive, liveAt); err != nil {
		t.Fatal(err)
	}
	if _, err := paidRepository.Transition(ctx, activeShow.ID, platformCall.ID, creatorID, StatusEnded, liveAt.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var earningCount int
	var earningAmount int64
	var effectiveAt time.Time
	if err := pool.QueryRow(ctx, `SELECT count(*),min(amount_cents),min(effective_at) FROM creator_ledger_entries WHERE payment_attempt_id=$1 AND kind='EARNING'`, platformAttemptID).Scan(&earningCount, &earningAmount, &effectiveAt); err != nil {
		t.Fatal(err)
	}
	if earningCount != 1 || earningAmount != 1750 || effectiveAt.Before(liveAt.Add(7*24*time.Hour-time.Second)) {
		t.Fatalf("earning count=%d amount=%d effective_at=%v", earningCount, earningAmount, effectiveAt)
	}
}
