package balance

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) Summary(ctx context.Context, creatorID, currency string, now time.Time) (Summary, error) {
	value := Summary{Currency: currency}
	err := r.pool.QueryRow(ctx, `SELECT
		COALESCE(sum(amount_cents),0),
		COALESCE(sum(amount_cents) FILTER (WHERE effective_at <= $3),0)
		FROM creator_ledger_entries WHERE creator_id=$1 AND currency=$2`, creatorID, currency, now).
		Scan(&value.TotalCents, &value.AvailableCents)
	value.PendingCents = value.TotalCents - value.AvailableCents
	return value, err
}

func (r *PostgresRepository) Entries(ctx context.Context, creatorID, currency string, limit int) ([]Entry, error) {
	rows, err := r.pool.Query(ctx, `SELECT id,kind,amount_cents,currency,effective_at,created_at
		FROM creator_ledger_entries WHERE creator_id=$1 AND currency=$2 ORDER BY id DESC LIMIT $3`, creatorID, currency, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Entry, 0, limit)
	for rows.Next() {
		var value Entry
		if err := rows.Scan(&value.ID, &value.Kind, &value.AmountCents, &value.Currency, &value.EffectiveAt, &value.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (r *PostgresRepository) CreateMonthlyRun(ctx context.Context, start, end time.Time, currency string, minimum int64, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var runID string
	err = tx.QueryRow(ctx, `INSERT INTO creator_payout_runs(period_start,period_end,currency,status,started_at,created_at,updated_at)
		VALUES($1,$2,$3,'PROCESSING',$4,$4,$4)
		ON CONFLICT(period_start,period_end,currency) DO UPDATE SET updated_at=creator_payout_runs.updated_at
		RETURNING id`, start, end, currency, now).Scan(&runID)
	if err != nil {
		return fmt.Errorf("create payout run: %w", err)
	}
	_, err = tx.Exec(ctx, `WITH eligible AS (
		SELECT e.creator_id,sum(e.amount_cents) amount_cents
		FROM creator_ledger_entries e
		JOIN creator_payout_accounts a ON a.creator_id=e.creator_id
		WHERE e.currency=$2 AND e.effective_at <= $3 AND a.transfers_status='active'
		GROUP BY e.creator_id HAVING sum(e.amount_cents) >= $4
	), inserted AS (
		INSERT INTO creator_payout_items(run_id,creator_id,amount_cents,currency,destination_account_id,idempotency_key,next_attempt_at,created_at,updated_at)
		SELECT $1,x.creator_id,x.amount_cents,$2,a.stripe_account_id,
		       'bling-payout-' || x.creator_id::text || '-' || to_char($5::date,'YYYY-MM'),$3,$3,$3
		FROM eligible x JOIN creator_payout_accounts a ON a.creator_id=x.creator_id
		ON CONFLICT(run_id,creator_id,currency) DO NOTHING
		RETURNING id,creator_id,amount_cents,currency
	)
	INSERT INTO creator_ledger_entries(creator_id,kind,amount_cents,currency,effective_at,payout_item_id,idempotency_key)
	SELECT creator_id,'PAYOUT_RESERVATION',-amount_cents,currency,$3,id,'payout-reservation:' || id::text FROM inserted`, runID, currency, now, minimum, start)
	if err != nil {
		return fmt.Errorf("reserve payout balances: %w", err)
	}
	return tx.Commit(ctx)
}

func (r *PostgresRepository) ClaimTransfers(ctx context.Context, now time.Time, limit int) ([]TransferRequest, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id,creator_id,destination_account_id,amount_cents,currency,idempotency_key,attempts
		FROM creator_payout_items WHERE (
			(status IN ('RESERVED','RETRY') AND next_attempt_at <= $1)
			OR (status='SENDING' AND updated_at < $1 - interval '5 minutes')
		) AND attempts < 10
		ORDER BY next_attempt_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`, now, limit)
	if err != nil {
		return nil, err
	}
	values := make([]TransferRequest, 0, limit)
	for rows.Next() {
		var v TransferRequest
		if err := rows.Scan(&v.ItemID, &v.CreatorID, &v.DestinationAccountID, &v.AmountCents, &v.Currency, &v.IdempotencyKey, &v.Attempts); err != nil {
			rows.Close()
			return nil, err
		}
		values = append(values, v)
	}
	rows.Close()
	for i := range values {
		values[i].Attempts++
		if _, err := tx.Exec(ctx, `UPDATE creator_payout_items SET status='SENDING',attempts=$2,updated_at=$3 WHERE id=$1`, values[i].ItemID, values[i].Attempts, now); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return values, nil
}

func (r *PostgresRepository) MarkPaid(ctx context.Context, itemID, transferID string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE creator_payout_items SET status='PAID',stripe_transfer_id=$2,failure_code=NULL,failure_message=NULL,processed_at=$3,updated_at=$3 WHERE id=$1 AND status='SENDING'`, itemID, transferID, now)
	return err
}

func (r *PostgresRepository) MarkRetry(ctx context.Context, request TransferRequest, code string, now time.Time) error {
	delay := time.Second * time.Duration(1<<min(request.Attempts, 8))
	status := "RETRY"
	if request.Attempts >= 10 {
		status = "FAILED"
	}
	_, err := r.pool.Exec(ctx, `UPDATE creator_payout_items SET status=$2,failure_code=$3,next_attempt_at=$4,processed_at=CASE WHEN $2='FAILED' THEN $5 ELSE NULL END,updated_at=$5 WHERE id=$1`, request.ItemID, status, code, now.Add(delay), now)
	return err
}

func (r *PostgresRepository) FinishRuns(ctx context.Context, now time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE creator_payout_runs r SET status=CASE WHEN EXISTS(SELECT 1 FROM creator_payout_items i WHERE i.run_id=r.id AND i.status='FAILED') THEN 'PARTIAL_FAILED' ELSE 'COMPLETED' END,completed_at=$1,updated_at=$1
		WHERE r.status='PROCESSING' AND NOT EXISTS(SELECT 1 FROM creator_payout_items i WHERE i.run_id=r.id AND i.status IN ('RESERVED','SENDING','RETRY'))`, now)
	return err
}

var _ Repository = (*PostgresRepository)(nil)
