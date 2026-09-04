package finance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) ClaimEvent(ctx context.Context, id, eventType, accountID string, now time.Time) (EventClaim, error) {
	var claimed string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO stripe_webhook_events(stripe_event_id,event_type,connected_account_id,locked_at,created_at,updated_at)
		VALUES($1,$2,NULLIF($3,''),$4,$4,$4)
		ON CONFLICT(stripe_event_id) DO UPDATE SET
			status='PROCESSING', attempts=stripe_webhook_events.attempts+1,
			failure_code=NULL, locked_at=EXCLUDED.locked_at, updated_at=EXCLUDED.updated_at
		WHERE stripe_webhook_events.status='FAILED'
		   OR (stripe_webhook_events.status='PROCESSING' AND stripe_webhook_events.locked_at < $4 - interval '5 minutes')
		RETURNING stripe_event_id`, id, eventType, accountID, now).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		var status string
		if err := r.pool.QueryRow(ctx, `SELECT status FROM stripe_webhook_events WHERE stripe_event_id=$1`, id).Scan(&status); err != nil {
			return "", fmt.Errorf("read Stripe webhook claim: %w", err)
		}
		if status == "PROCESSED" {
			return EventProcessed, nil
		}
		return EventBusy, nil
	}
	if err != nil {
		return "", fmt.Errorf("claim Stripe webhook event: %w", err)
	}
	return EventClaimed, nil
}

func (r *PostgresRepository) CompleteEvent(ctx context.Context, id string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE stripe_webhook_events SET status='PROCESSED',processed_at=$2,updated_at=$2 WHERE stripe_event_id=$1`, id, now)
	return err
}

func (r *PostgresRepository) FailEvent(ctx context.Context, id, code string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE stripe_webhook_events SET status='FAILED',failure_code=$2,updated_at=$3 WHERE stripe_event_id=$1`, id, code, now)
	return err
}

func (r *PostgresRepository) ClaimRefunds(ctx context.Context, now time.Time, limit int) ([]RefundRequest, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin refund claim: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `
		SELECT id,payment_attempt_id,call_id,stripe_payment_intent_id,COALESCE(stripe_refund_id,''),amount_cents,currency,reason,status,attempts
		FROM payment_refunds
		WHERE status IN ('REQUESTED','RETRY','PENDING') AND next_attempt_at <= $1 AND attempts < 10
		ORDER BY next_attempt_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("lock refund requests: %w", err)
	}
	requests := make([]RefundRequest, 0, limit)
	for rows.Next() {
		var value RefundRequest
		if err := rows.Scan(&value.ID, &value.PaymentAttemptID, &value.CallID, &value.StripePaymentIntentID, &value.StripeRefundID, &value.AmountCents, &value.Currency, &value.Reason, &value.Status, &value.Attempts); err != nil {
			rows.Close()
			return nil, err
		}
		requests = append(requests, value)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for index := range requests {
		requests[index].Attempts++
		if _, err := tx.Exec(ctx, `UPDATE payment_refunds SET status='PROCESSING',attempts=$2,updated_at=$3 WHERE id=$1`, requests[index].ID, requests[index].Attempts, now); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit refund claim: %w", err)
	}
	return requests, nil
}

func (r *PostgresRepository) MarkRefundResult(ctx context.Context, request RefundRequest, result RefundResult, now time.Time) error {
	status := result.Status
	if status != RefundSucceeded && status != RefundFailed {
		status = RefundPending
	}
	next := now.Add(5 * time.Minute)
	_, err := r.pool.Exec(ctx, `UPDATE payment_refunds SET stripe_refund_id=NULLIF($2,''),status=$3,failure_code=NULLIF($4,''),next_attempt_at=$5,processed_at=CASE WHEN $3 IN ('SUCCEEDED','FAILED') THEN $6 ELSE NULL END,updated_at=$6 WHERE id=$1`, request.ID, result.ID, status, result.FailureCode, next, now)
	return err
}

func (r *PostgresRepository) MarkRefundRetry(ctx context.Context, request RefundRequest, code string, now time.Time) error {
	delay := time.Second * time.Duration(1<<min(request.Attempts, 8))
	_, err := r.pool.Exec(ctx, `UPDATE payment_refunds SET
		status=CASE WHEN $5 >= 10 THEN 'FAILED' ELSE 'RETRY' END,
		failure_code=$2,next_attempt_at=$3,
		processed_at=CASE WHEN $5 >= 10 THEN $4 ELSE NULL END,
		updated_at=$4 WHERE id=$1`, request.ID, code, now.Add(delay), now, request.Attempts)
	return err
}

func (r *PostgresRepository) ReconcileRefund(ctx context.Context, refundID, intentID string, status RefundStatus, failureCode string, now time.Time) error {
	if status != RefundSucceeded && status != RefundFailed {
		status = RefundPending
	}
	_, err := r.pool.Exec(ctx, `UPDATE payment_refunds SET stripe_refund_id=COALESCE(stripe_refund_id,NULLIF($1,'')),status=$3,failure_code=NULLIF($4,''),processed_at=CASE WHEN $3 IN ('SUCCEEDED','FAILED') THEN $5 ELSE processed_at END,updated_at=$5 WHERE stripe_refund_id=$1 OR stripe_payment_intent_id=$2`, refundID, intentID, status, failureCode, now)
	return err
}

func (r *PostgresRepository) UpsertDispute(ctx context.Context, value Dispute, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO payment_disputes(stripe_dispute_id,payment_attempt_id,stripe_payment_intent_id,amount_cents,currency,reason,status,evidence_due_at,created_at,updated_at)
		VALUES($1,(SELECT id FROM payment_attempts WHERE stripe_payment_intent_id=$2),NULLIF($2,''),$3,$4,$5,$6,$7,$8,$8)
		ON CONFLICT(stripe_dispute_id) DO UPDATE SET
			payment_attempt_id=COALESCE(payment_disputes.payment_attempt_id,EXCLUDED.payment_attempt_id),
			stripe_payment_intent_id=COALESCE(payment_disputes.stripe_payment_intent_id,EXCLUDED.stripe_payment_intent_id),
			amount_cents=EXCLUDED.amount_cents,currency=EXCLUDED.currency,reason=EXCLUDED.reason,
			status=EXCLUDED.status,evidence_due_at=EXCLUDED.evidence_due_at,updated_at=EXCLUDED.updated_at`, value.ID, value.StripePaymentIntentID, value.AmountCents, value.Currency, value.Reason, value.Status, value.EvidenceDueAt, now)
	return err
}

func (r *PostgresRepository) UpsertPayout(ctx context.Context, value Payout, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO creator_payout_events(stripe_payout_id,creator_id,amount_cents,currency,status,failure_code,failure_message,arrival_at,created_at,updated_at)
		SELECT $1,p.creator_id,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$9 FROM creator_payout_accounts p WHERE p.stripe_account_id=$2
		ON CONFLICT(stripe_payout_id) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,currency=EXCLUDED.currency,status=EXCLUDED.status,failure_code=EXCLUDED.failure_code,failure_message=EXCLUDED.failure_message,arrival_at=EXCLUDED.arrival_at,updated_at=EXCLUDED.updated_at`, value.ID, value.StripeAccountID, value.AmountCents, value.Currency, value.Status, value.FailureCode, value.FailureMessage, value.ArrivalAt, now)
	return err
}

func (r *PostgresRepository) ActivityForCreator(ctx context.Context, creatorID string, limit int) ([]Activity, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.id,p.amount_cents,p.platform_fee_cents,p.currency,p.status,
			COALESCE(r.status,''),COALESCE(r.reason,''),COALESCE(d.status,''),COALESCE(d.reason,''),p.created_at
		FROM payment_attempts p JOIN shows s ON s.id=p.show_id
		LEFT JOIN payment_refunds r ON r.payment_attempt_id=p.id
		LEFT JOIN LATERAL (SELECT status,reason FROM payment_disputes WHERE payment_attempt_id=p.id ORDER BY updated_at DESC LIMIT 1) d ON true
		WHERE s.creator_id=$1 AND p.status IN ('CAPTURED','CAPTURING')
		ORDER BY p.created_at DESC LIMIT $2`, creatorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Activity, 0, limit)
	for rows.Next() {
		var value Activity
		if err := rows.Scan(&value.PaymentAttemptID, &value.AmountCents, &value.PlatformFeeCents, &value.Currency, &value.PaymentStatus, &value.RefundStatus, &value.RefundReason, &value.DisputeStatus, &value.DisputeReason, &value.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (r *PostgresRepository) LatestPayoutFailure(ctx context.Context, creatorID string) (*PayoutFailure, error) {
	var value PayoutFailure
	err := r.pool.QueryRow(ctx, `SELECT failed.stripe_payout_id,failed.amount_cents,failed.currency,COALESCE(failed.failure_code,''),COALESCE(failed.failure_message,''),failed.updated_at
		FROM creator_payout_events failed
		WHERE failed.creator_id=$1 AND failed.status='failed'
		  AND NOT EXISTS(SELECT 1 FROM creator_payout_events paid WHERE paid.creator_id=failed.creator_id AND paid.status='paid' AND paid.updated_at>failed.updated_at)
		ORDER BY failed.updated_at DESC LIMIT 1`, creatorID).Scan(&value.PayoutID, &value.AmountCents, &value.Currency, &value.FailureCode, &value.FailureMessage, &value.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &value, err
}

var _ Repository = (*PostgresRepository)(nil)
