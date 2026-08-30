package show

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

const showColumns = `id, creator_id, status, started_at, ended_at, created_at, updated_at`

func (s *PostgresStore) Create(ctx context.Context, creatorID string) (Show, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Show{}, fmt.Errorf("begin create show: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var result Show
	err = tx.QueryRow(ctx, `INSERT INTO shows (creator_id) VALUES ($1) RETURNING `+showColumns, creatorID).
		Scan(&result.ID, &result.CreatorID, &result.Status, &result.StartedAt, &result.EndedAt, &result.CreatedAt, &result.UpdatedAt)
	if err != nil {
		return Show{}, fmt.Errorf("create show: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO show_tiers (show_id, name, priority_rank, call_duration_seconds)
		VALUES ($1, 'Standard', 0, 300)`, result.ID); err != nil {
		return Show{}, fmt.Errorf("create default show tier: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Show{}, fmt.Errorf("commit create show: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) ByIDForCreator(ctx context.Context, showID, creatorID string) (Show, error) {
	var result Show
	err := s.pool.QueryRow(ctx, `SELECT `+showColumns+` FROM shows WHERE id = $1 AND creator_id = $2`, showID, creatorID).
		Scan(&result.ID, &result.CreatorID, &result.Status, &result.StartedAt, &result.EndedAt, &result.CreatedAt, &result.UpdatedAt)
	return result, mapQueryError("get show", err)
}

func (s *PostgresStore) Start(ctx context.Context, showID, creatorID string, now time.Time) (Show, error) {
	return s.transition(ctx, showID, creatorID, ActionStart, now)
}

func (s *PostgresStore) End(ctx context.Context, showID, creatorID string, now time.Time) (Show, error) {
	return s.transition(ctx, showID, creatorID, ActionEnd, now)
}

func (s *PostgresStore) transition(ctx context.Context, showID, creatorID string, action Action, now time.Time) (Show, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Show{}, fmt.Errorf("begin show transition: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current Show
	err = tx.QueryRow(ctx, `SELECT `+showColumns+` FROM shows WHERE id = $1 AND creator_id = $2 FOR UPDATE`, showID, creatorID).
		Scan(&current.ID, &current.CreatorID, &current.Status, &current.StartedAt, &current.EndedAt, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return Show{}, mapQueryError("lock show", err)
	}

	next, err := Transition(current.Status, action)
	if err != nil {
		return Show{}, err
	}
	if next == current.Status {
		if err := tx.Commit(ctx); err != nil {
			return Show{}, fmt.Errorf("commit idempotent show transition: %w", err)
		}
		return current, nil
	}

	var result Show
	switch action {
	case ActionStart:
		err = tx.QueryRow(ctx, `
			UPDATE shows SET status = $1, started_at = $2, updated_at = $2
			WHERE id = $3 RETURNING `+showColumns, next, now, showID).
			Scan(&result.ID, &result.CreatorID, &result.Status, &result.StartedAt, &result.EndedAt, &result.CreatedAt, &result.UpdatedAt)
	case ActionEnd:
		err = tx.QueryRow(ctx, `
			UPDATE shows SET status = $1, ended_at = $2, updated_at = $2
			WHERE id = $3 RETURNING `+showColumns, next, now, showID).
			Scan(&result.ID, &result.CreatorID, &result.Status, &result.StartedAt, &result.EndedAt, &result.CreatedAt, &result.UpdatedAt)
	}
	if err != nil {
		return Show{}, transitionError(err)
	}
	if action == ActionEnd {
		// Lock/finish active calls before closing their queue entries. A concurrent
		// call transition locks the call row first, so this ordering guarantees the
		// final queue state is ENDED after that transition releases its lock.
		if _, err := tx.Exec(ctx, `
			UPDATE calls SET status = 'ENDED', ended_at = $1, updated_at = $1
			WHERE show_id = $2 AND status IN ('CREATED','CONNECTING','LIVE')`, now, showID); err != nil {
			return Show{}, fmt.Errorf("close active call: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE queue_entries SET status = 'ENDED', updated_at = $1
			WHERE show_id = $2 AND status IN ('WAITING','SELECTED','CONNECTING','LIVE')`, now, showID); err != nil {
			return Show{}, fmt.Errorf("close waiting queue: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO queue_outbox (show_id, event_type, payload)
			VALUES ($1::uuid, 'queue.show_ended', jsonb_build_object('showId', $1::text))`, showID); err != nil {
			return Show{}, fmt.Errorf("publish ended queue: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Show{}, transitionError(err)
	}
	return result, nil
}

func (s *PostgresStore) LiveByUsername(ctx context.Context, username string) (Show, error) {
	var result Show
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.creator_id, s.status, s.started_at, s.ended_at, s.created_at, s.updated_at
		FROM shows s JOIN users u ON u.id = s.creator_id
		WHERE lower(u.username) = lower($1) AND s.status = 'LIVE'`, username).
		Scan(&result.ID, &result.CreatorID, &result.Status, &result.StartedAt, &result.EndedAt, &result.CreatedAt, &result.UpdatedAt)
	return result, mapQueryError("get live show", err)
}

func mapQueryError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}

func transitionError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" && postgresError.ConstraintName == "shows_one_live_per_creator_idx" {
		return ErrActiveShowExists
	}
	return fmt.Errorf("transition show: %w", err)
}
