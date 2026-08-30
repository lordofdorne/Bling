package call

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const callColumns = `c.id, c.show_id, c.queue_entry_id, c.status, c.selection_mode,
	c.call_duration_seconds, c.started_at, c.ended_at, c.expires_at, c.created_at, c.updated_at,
	q.id, q.display_name, q.topic, q.tier_name, q.priority_rank, q.call_duration_seconds`

func scanCall(row pgx.Row) (Call, error) {
	var value Call
	err := row.Scan(&value.ID, &value.ShowID, &value.QueueEntryID, &value.Status, &value.SelectionMode,
		&value.CallDurationSeconds, &value.StartedAt, &value.EndedAt, &value.ExpiresAt, &value.CreatedAt, &value.UpdatedAt,
		&value.Caller.ID, &value.Caller.DisplayName, &value.Caller.Topic, &value.Caller.TierName,
		&value.Caller.PriorityRank, &value.Caller.CallDurationSeconds)
	return value, err
}

func (r *PostgresRepository) Select(ctx context.Context, showID, creatorID, entryID string, mode SelectionMode, now time.Time) (Call, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Call{}, fmt.Errorf("begin caller selection: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var showStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM shows WHERE id=$1 AND creator_id=$2 FOR UPDATE`, showID, creatorID).Scan(&showStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Call{}, ErrShowNotFound
		}
		return Call{}, fmt.Errorf("lock show for caller selection: %w", err)
	}
	if showStatus != "LIVE" {
		return Call{}, ErrShowNotLive
	}
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE show_id=$1 AND status IN ('CREATED','CONNECTING','LIVE'))`, showID).Scan(&active); err != nil {
		return Call{}, fmt.Errorf("check active call: %w", err)
	}
	if active {
		return Call{}, ErrActiveCall
	}

	var selected callerRow
	if mode == SelectionManual {
		selected, err = lockCaller(ctx, tx, `q.id=$2`, showID, entryID)
		if errors.Is(err, pgx.ErrNoRows) {
			return Call{}, ErrCallerNotWaiting
		}
	} else {
		selected, err = randomCaller(ctx, tx, showID)
		if errors.Is(err, pgx.ErrNoRows) {
			return Call{}, ErrQueueEmpty
		}
	}
	if err != nil {
		return Call{}, fmt.Errorf("select waiting caller: %w", err)
	}

	if _, err := tx.Exec(ctx, `UPDATE queue_entries SET status='SELECTED', selected_at=$1, updated_at=$1 WHERE id=$2`, now, selected.id); err != nil {
		return Call{}, fmt.Errorf("mark caller selected: %w", err)
	}
	var callID string
	if err := tx.QueryRow(ctx, `INSERT INTO calls (show_id, queue_entry_id, selection_mode, call_duration_seconds, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`, showID, selected.id, mode, selected.duration, now).Scan(&callID); err != nil {
		return Call{}, fmt.Errorf("create call: %w", err)
	}
	if err := insertOutbox(ctx, tx, showID, "queue.caller_selected", selected); err != nil {
		return Call{}, err
	}
	value, err := queryCall(ctx, tx, showID, callID)
	if err != nil {
		return Call{}, fmt.Errorf("read selected call: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Call{}, fmt.Errorf("commit caller selection: %w", err)
	}
	return value, nil
}

type callerRow struct {
	id       string
	rank     int
	position int64
	duration int
}

func lockCaller(ctx context.Context, tx pgx.Tx, predicate, showID string, argument any) (callerRow, error) {
	var value callerRow
	err := tx.QueryRow(ctx, `SELECT q.id,q.priority_rank,q.queue_position,q.call_duration_seconds FROM queue_entries q
		WHERE q.show_id=$1 AND q.status='WAITING' AND `+predicate+` FOR UPDATE`, showID, argument).
		Scan(&value.id, &value.rank, &value.position, &value.duration)
	return value, err
}

func randomCaller(ctx context.Context, tx pgx.Tx, showID string) (callerRow, error) {
	var rank int
	var minimum, maximum int64
	if err := tx.QueryRow(ctx, `SELECT priority_rank,min(queue_position),max(queue_position) FROM queue_entries
		WHERE show_id=$1 AND status='WAITING' GROUP BY priority_rank ORDER BY priority_rank DESC LIMIT 1`, showID).
		Scan(&rank, &minimum, &maximum); err != nil {
		return callerRow{}, err
	}
	pivot := minimum
	if width := maximum - minimum + 1; width > 1 {
		pivot += rand.Int64N(width)
	}
	var value callerRow
	err := tx.QueryRow(ctx, `SELECT id,priority_rank,queue_position,call_duration_seconds FROM queue_entries
		WHERE show_id=$1 AND status='WAITING' AND priority_rank=$2
		ORDER BY (queue_position < $3), queue_position LIMIT 1 FOR UPDATE`, showID, rank, pivot).
		Scan(&value.id, &value.rank, &value.position, &value.duration)
	return value, err
}

func (r *PostgresRepository) CreatorActive(ctx context.Context, showID, creatorID string) (Call, error) {
	value, err := scanCall(r.pool.QueryRow(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
		JOIN shows s ON s.id=c.show_id WHERE c.show_id=$1 AND s.creator_id=$2
		AND c.status IN ('CREATED','CONNECTING','LIVE') ORDER BY c.created_at DESC LIMIT 1`, showID, creatorID))
	return mapNotFound(value, err)
}

func (r *PostgresRepository) ViewerLatest(ctx context.Context, showID string, tokenHash []byte) (Call, error) {
	value, err := scanCall(r.pool.QueryRow(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
		WHERE c.show_id=$1 AND q.session_token_hash=$2 ORDER BY c.created_at DESC LIMIT 1`, showID, tokenHash))
	return mapNotFound(value, err)
}

func (r *PostgresRepository) Transition(ctx context.Context, showID, callID, creatorID string, target Status, now time.Time) (Call, error) {
	return r.transition(ctx, showID, callID, target, now, func(ctx context.Context, tx pgx.Tx) (Call, error) {
		return queryAuthorizedCall(ctx, tx, showID, callID, creatorID, true)
	})
}

func (r *PostgresRepository) TransitionViewer(ctx context.Context, showID, callID string, tokenHash []byte, target Status, now time.Time) (Call, error) {
	return r.transition(ctx, showID, callID, target, now, func(ctx context.Context, tx pgx.Tx) (Call, error) {
		return queryViewerCall(ctx, tx, showID, callID, tokenHash, true)
	})
}

func (r *PostgresRepository) transition(ctx context.Context, showID, callID string, target Status, now time.Time, load func(context.Context, pgx.Tx) (Call, error)) (Call, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Call{}, fmt.Errorf("begin call transition: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	current, err := load(ctx, tx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Call{}, ErrCallNotFound
	}
	if err != nil {
		return Call{}, fmt.Errorf("lock call: %w", err)
	}
	if current.Status == target {
		if err := tx.Commit(ctx); err != nil {
			return Call{}, fmt.Errorf("commit idempotent call transition: %w", err)
		}
		return current, nil
	}
	value, err := applyTransition(ctx, tx, current, target, now)
	if err != nil {
		return Call{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Call{}, fmt.Errorf("commit call transition: %w", err)
	}
	return value, nil
}

func applyTransition(ctx context.Context, tx pgx.Tx, current Call, target Status, now time.Time) (Call, error) {
	if !canTransition(current.Status, target) {
		return Call{}, ErrInvalidTransition
	}
	endedAt := any(nil)
	startedAt := current.StartedAt
	expiresAt := current.ExpiresAt
	if target == StatusLive && startedAt == nil {
		startedAt = &now
		expires := now.Add(time.Duration(current.CallDurationSeconds) * time.Second)
		expiresAt = &expires
	}
	if target == StatusEnded || target == StatusFailed {
		endedAt = now
	}
	if _, err := tx.Exec(ctx, `UPDATE calls SET status=$1,started_at=$2,ended_at=$3,expires_at=$4,updated_at=$5 WHERE id=$6`, target, startedAt, endedAt, expiresAt, now, current.ID); err != nil {
		return Call{}, fmt.Errorf("update call state: %w", err)
	}
	queueStatus := target
	if target == StatusFailed {
		queueStatus = StatusEnded
	}
	if _, err := tx.Exec(ctx, `UPDATE queue_entries SET status=$1,updated_at=$2 WHERE id=$3`, queueStatus, now, current.QueueEntryID); err != nil {
		return Call{}, fmt.Errorf("update caller state: %w", err)
	}
	row := callerRow{id: current.QueueEntryID, rank: current.Caller.PriorityRank, duration: current.Caller.CallDurationSeconds}
	eventType := "call." + stringLower(target)
	if err := insertOutbox(ctx, tx, current.ShowID, eventType, row); err != nil {
		return Call{}, err
	}
	value, err := queryCall(ctx, tx, current.ShowID, current.ID)
	if err != nil {
		return Call{}, fmt.Errorf("read transitioned call: %w", err)
	}
	return value, nil
}

func (r *PostgresRepository) ExpireDue(ctx context.Context, now time.Time, limit int) ([]Call, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin call expiry: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
		WHERE c.status='LIVE' AND c.expires_at <= $1
		ORDER BY c.expires_at LIMIT $2 FOR UPDATE OF c SKIP LOCKED`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("lock expired calls: %w", err)
	}
	due := make([]Call, 0, limit)
	for rows.Next() {
		value, scanErr := scanCall(rows)
		if scanErr != nil {
			rows.Close()
			return nil, fmt.Errorf("scan expired call: %w", scanErr)
		}
		due = append(due, value)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate expired calls: %w", err)
	}
	expired := make([]Call, 0, len(due))
	for _, current := range due {
		value, transitionErr := applyTransition(ctx, tx, current, StatusEnded, now)
		if transitionErr != nil {
			return nil, transitionErr
		}
		expired = append(expired, value)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit call expiry: %w", err)
	}
	return expired, nil
}

func canTransition(from, to Status) bool {
	switch from {
	case StatusCreated:
		return to == StatusConnecting || to == StatusEnded || to == StatusFailed
	case StatusConnecting:
		return to == StatusLive || to == StatusEnded || to == StatusFailed
	case StatusLive:
		return to == StatusEnded || to == StatusFailed
	default:
		return false
	}
}

func stringLower(status Status) string {
	switch status {
	case StatusConnecting:
		return "connecting"
	case StatusLive:
		return "live"
	case StatusEnded:
		return "ended"
	default:
		return "failed"
	}
}

func (r *PostgresRepository) AuthorizeCreator(ctx context.Context, showID, callID, creatorID string) error {
	var ok bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calls c JOIN shows s ON s.id=c.show_id WHERE c.id=$1 AND c.show_id=$2 AND s.creator_id=$3 AND c.status IN ('CREATED','CONNECTING','LIVE'))`, callID, showID, creatorID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrCallNotFound
	}
	return nil
}

func (r *PostgresRepository) AuthorizeViewer(ctx context.Context, showID, callID string, tokenHash []byte) error {
	var ok bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id WHERE c.id=$1 AND c.show_id=$2 AND q.session_token_hash=$3 AND c.status IN ('CREATED','CONNECTING','LIVE'))`, callID, showID, tokenHash).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrCallNotFound
	}
	return nil
}

func queryCall(ctx context.Context, tx pgx.Tx, showID, callID string) (Call, error) {
	return scanCall(tx.QueryRow(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id WHERE c.show_id=$1 AND c.id=$2`, showID, callID))
}

func queryAuthorizedCall(ctx context.Context, tx pgx.Tx, showID, callID, creatorID string, lock bool) (Call, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE OF c"
	}
	return scanCall(tx.QueryRow(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
		JOIN shows s ON s.id=c.show_id WHERE c.show_id=$1 AND c.id=$2 AND s.creator_id=$3`+suffix, showID, callID, creatorID))
}

func queryViewerCall(ctx context.Context, tx pgx.Tx, showID, callID string, tokenHash []byte, lock bool) (Call, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE OF c"
	}
	return scanCall(tx.QueryRow(ctx, `SELECT `+callColumns+` FROM calls c JOIN queue_entries q ON q.id=c.queue_entry_id
		WHERE c.show_id=$1 AND c.id=$2 AND q.session_token_hash=$3`+suffix, showID, callID, tokenHash))
}

func mapNotFound(value Call, err error) (Call, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return Call{}, ErrCallNotFound
	}
	if err != nil {
		return Call{}, fmt.Errorf("read call: %w", err)
	}
	return value, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, showID, eventType string, caller callerRow) error {
	_, err := tx.Exec(ctx, `INSERT INTO queue_outbox(show_id,event_type,payload) VALUES($1::uuid,$2,jsonb_build_object(
		'entryId',$3::text,'showId',($1::uuid)::text,'priorityRank',$4::int,'queuePosition',$5::bigint))`, showID, eventType, caller.id, caller.rank, caller.position)
	if err != nil {
		return fmt.Errorf("insert call outbox: %w", err)
	}
	return nil
}
