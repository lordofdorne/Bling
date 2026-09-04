package payment

import (
	"bytes"
	"context"
	"database/sql"
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

const attemptColumns = `id,show_id,tier_id,queue_entry_id,stripe_payment_intent_id,destination_account_id,amount_cents,platform_fee_bps,platform_fee_cents,currency,status,authorized_at,captured_at,canceled_at,created_at,updated_at`

func scanAttempt(row pgx.Row) (Attempt, error) {
	var value Attempt
	var intentID, destinationID sql.NullString
	var feeBPS, feeCents sql.NullInt64
	err := row.Scan(&value.ID, &value.ShowID, &value.TierID, &value.QueueEntryID, &intentID, &destinationID, &value.AmountCents, &feeBPS, &feeCents, &value.Currency, &value.Status, &value.AuthorizedAt, &value.CapturedAt, &value.CanceledAt, &value.CreatedAt, &value.UpdatedAt)
	if intentID.Valid {
		value.StripePaymentIntentID = intentID.String
	}
	if destinationID.Valid {
		value.DestinationAccountID = destinationID.String
	}
	if feeBPS.Valid {
		value.PlatformFeeBPS = feeBPS.Int64
	}
	if feeCents.Valid {
		value.PlatformFeeCents = feeCents.Int64
	}
	return value, err
}

func (r *PostgresRepository) Prepare(ctx context.Context, input PrepareInput, now time.Time) (Attempt, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Attempt{}, fmt.Errorf("begin payment attempt: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	var amount int64
	var destinationID sql.NullString
	var chargesEnabled, payoutsEnabled, detailsSubmitted bool
	if err := tx.QueryRow(ctx, `SELECT s.status,t.price_cents,p.stripe_account_id,COALESCE(p.charges_enabled,false),COALESCE(p.payouts_enabled,false),COALESCE(p.details_submitted,false)
		FROM shows s JOIN show_tiers t ON t.show_id=s.id
		LEFT JOIN creator_payout_accounts p ON p.creator_id=s.creator_id
		WHERE s.id=$1 AND t.id=$2 AND t.enabled FOR SHARE OF s,t`, input.ShowID, input.TierID).Scan(&status, &amount, &destinationID, &chargesEnabled, &payoutsEnabled, &detailsSubmitted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attempt{}, ErrTierNotFound
		}
		return Attempt{}, fmt.Errorf("load payment tier: %w", err)
	}
	if status != "LIVE" {
		return Attempt{}, ErrShowNotLive
	}
	if amount <= 0 {
		return Attempt{}, ErrFreeTier
	}
	if !destinationID.Valid || !chargesEnabled || !payoutsEnabled || !detailsSubmitted {
		return Attempt{}, ErrPayoutsNotReady
	}
	feeCents := platformFeeCents(amount)
	value, err := scanAttempt(tx.QueryRow(ctx, `INSERT INTO payment_attempts
		(show_id,tier_id,viewer_token_hash,idempotency_key_hash,destination_account_id,amount_cents,platform_fee_bps,platform_fee_cents,currency,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'usd',$9,$9)
		ON CONFLICT (show_id,idempotency_key_hash) DO UPDATE SET updated_at=payment_attempts.updated_at
		RETURNING `+attemptColumns, input.ShowID, input.TierID, input.ViewerTokenHash, input.IdempotencyKeyHash, destinationID.String, amount, PlatformFeeBPS, feeCents, now))
	if err != nil {
		return Attempt{}, fmt.Errorf("persist payment attempt: %w", err)
	}
	var storedViewer []byte
	if err := tx.QueryRow(ctx, `SELECT viewer_token_hash FROM payment_attempts WHERE id=$1`, value.ID).Scan(&storedViewer); err != nil {
		return Attempt{}, err
	}
	if !bytes.Equal(storedViewer, input.ViewerTokenHash) || value.TierID != input.TierID {
		return Attempt{}, ErrAuthorizationUsed
	}
	if err := tx.Commit(ctx); err != nil {
		return Attempt{}, fmt.Errorf("commit payment attempt: %w", err)
	}
	return value, nil
}

func platformFeeCents(amountCents int64) int64 {
	return amountCents * PlatformFeeBPS / 10000
}

func (r *PostgresRepository) AttachIntent(ctx context.Context, attemptID, intentID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `UPDATE payment_attempts SET stripe_payment_intent_id=$2,updated_at=$3 WHERE id=$1 AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id=$2)`, attemptID, intentID, now)
	if err != nil {
		return fmt.Errorf("attach Stripe intent: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrAuthorizationUsed
	}
	return nil
}

func (r *PostgresRepository) FindForViewer(ctx context.Context, showID, attemptID string, viewerHash []byte) (Attempt, error) {
	value, err := scanAttempt(r.pool.QueryRow(ctx, `SELECT `+attemptColumns+` FROM payment_attempts WHERE id=$1 AND show_id=$2 AND viewer_token_hash=$3`, attemptID, showID, viewerHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return Attempt{}, ErrAttemptNotFound
	}
	return value, err
}

func (r *PostgresRepository) MarkAuthorized(ctx context.Context, id string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE payment_attempts SET status='AUTHORIZED',authorized_at=COALESCE(authorized_at,$2),updated_at=$2 WHERE id=$1 AND status IN ('CREATED','AUTHORIZED')`, id, now)
	return err
}

func (r *PostgresRepository) MarkFailed(ctx context.Context, id, code string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE payment_attempts SET status='FAILED',failure_code=$2,updated_at=$3 WHERE id=$1 AND status <> 'CAPTURED'`, id, code, now)
	return err
}

func (r *PostgresRepository) MarkCanceled(ctx context.Context, id string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE payment_attempts SET status='CANCELED',canceled_at=COALESCE(canceled_at,$2),updated_at=$2 WHERE id=$1 AND status <> 'CAPTURED'`, id, now)
	return err
}

func (r *PostgresRepository) Reconcile(ctx context.Context, intentID string, status Status, failureCode string, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin payment reconciliation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var attemptID, showID string
	var current Status
	if err := tx.QueryRow(ctx, `SELECT id,show_id,status FROM payment_attempts WHERE stripe_payment_intent_id=$1 FOR UPDATE`, intentID).Scan(&attemptID, &showID, &current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAttemptNotFound
		}
		return err
	}
	if current == StatusCaptured && status != StatusCaptured {
		return tx.Commit(ctx)
	}
	switch status {
	case StatusCaptured:
		// Serialize capture reconciliation with ending the show. Without this lock,
		// each transaction can observe the other's previous state and miss the
		// refund for a capture that completes while the show is ending.
		var showStatus string
		if err := tx.QueryRow(ctx, `SELECT status FROM shows WHERE id=$1 FOR SHARE`, showID).Scan(&showStatus); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE payment_attempts SET status='CAPTURED',captured_at=COALESCE(captured_at,$2),updated_at=$2 WHERE id=$1`, attemptID, now); err != nil {
			return err
		}
		var callID, entryID, callStatus string
		var startedAt *time.Time
		var rank int
		var position int64
		err := tx.QueryRow(ctx, `SELECT c.id,q.id,q.priority_rank,q.queue_position,c.status,c.started_at
			FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
			WHERE c.payment_attempt_id=$1 FOR UPDATE OF c,q`, attemptID).Scan(&callID, &entryID, &rank, &position, &callStatus, &startedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx)
		}
		if err != nil {
			return err
		}
		shouldRefund := startedAt == nil && showStatus != "LIVE"
		if callStatus != "PAYMENT_PENDING" && !shouldRefund {
			return tx.Commit(ctx)
		}
		if shouldRefund {
			if _, err := tx.Exec(ctx, `UPDATE calls SET status='FAILED',ended_at=COALESCE(ended_at,$2),updated_at=$2 WHERE id=$1 AND status='PAYMENT_PENDING'`, callID, now); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE queue_entries SET status='ENDED',updated_at=$2 WHERE id=$1 AND status IN ('WAITING','SELECTED','CONNECTING','LIVE')`, entryID, now); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO payment_refunds(payment_attempt_id,call_id,stripe_payment_intent_id,amount_cents,currency,reason,next_attempt_at,requested_at,updated_at)
				SELECT p.id,$2,p.stripe_payment_intent_id,p.amount_cents,p.currency,'show_ended_before_call_started',$3,$3,$3
				FROM payment_attempts p WHERE p.id=$1
				ON CONFLICT(payment_attempt_id) DO NOTHING`, attemptID, callID, now); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
		if _, err := tx.Exec(ctx, `UPDATE queue_entries SET status='SELECTED',selected_at=COALESCE(selected_at,$2),updated_at=$2 WHERE id=$1`, entryID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE calls SET status='CREATED',updated_at=$2 WHERE id=$1`, callID, now); err != nil {
			return err
		}
		payload := fmt.Sprintf(`{"entryId":%q,"showId":%q,"priorityRank":%d,"queuePosition":%d}`, entryID, showID, rank, position)
		if _, err := tx.Exec(ctx, `INSERT INTO queue_outbox(show_id,event_type,payload) VALUES($1,'queue.caller_selected',$2::jsonb)`, showID, payload); err != nil {
			return err
		}
	case StatusCanceled, StatusFailed:
		if current == StatusCaptured {
			return tx.Commit(ctx)
		}
		if _, err := tx.Exec(ctx, `UPDATE payment_attempts SET status=$2,failure_code=NULLIF($3,''),canceled_at=CASE WHEN $2='CANCELED' THEN COALESCE(canceled_at,$4) ELSE canceled_at END,updated_at=$4 WHERE id=$1`, attemptID, status, failureCode, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE calls SET status='FAILED',ended_at=COALESCE(ended_at,$2),updated_at=$2 WHERE payment_attempt_id=$1 AND status='PAYMENT_PENDING'`, attemptID, now); err != nil {
			return err
		}
		var entryID string
		var rank int
		var position int64
		err := tx.QueryRow(ctx, `UPDATE queue_entries SET status='LEFT',left_at=COALESCE(left_at,$2),updated_at=$2 WHERE payment_attempt_id=$1 AND status='WAITING' RETURNING id,priority_rank,queue_position`, attemptID, now).Scan(&entryID, &rank, &position)
		if err == nil {
			payload := fmt.Sprintf(`{"entryId":%q,"showId":%q,"priorityRank":%d,"queuePosition":%d}`, entryID, showID, rank, position)
			if _, err := tx.Exec(ctx, `INSERT INTO queue_outbox(show_id,event_type,payload) VALUES($1,'queue.caller_left',$2::jsonb)`, showID, payload); err != nil {
				return err
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	default:
		return fmt.Errorf("unsupported reconciliation status %q", status)
	}
	return tx.Commit(ctx)
}
