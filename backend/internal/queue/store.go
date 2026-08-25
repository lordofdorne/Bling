package queue

import (
	"context"
	"encoding/hex"
	"encoding/json"
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

const entryColumns = `id, show_id, display_name, topic, status, tier_id, tier_name, priority_rank, call_duration_seconds, queue_position, joined_at, selected_at, left_at, created_at, updated_at`

func scanEntry(row pgx.Row) (Entry, error) {
	var entry Entry
	err := row.Scan(
		&entry.ID, &entry.ShowID, &entry.DisplayName, &entry.Topic, &entry.Status,
		&entry.TierID, &entry.TierName, &entry.PriorityRank, &entry.CallDurationSeconds,
		&entry.QueuePosition, &entry.JoinedAt, &entry.SelectedAt, &entry.LeftAt,
		&entry.CreatedAt, &entry.UpdatedAt,
	)
	return entry, err
}

func (r *PostgresRepository) Join(ctx context.Context, input JoinInput) (Entry, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Entry{}, fmt.Errorf("begin queue join: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var showStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM shows WHERE id = $1 FOR SHARE`, input.ShowID).Scan(&showStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Entry{}, ErrShowNotLive
		}
		return Entry{}, fmt.Errorf("lock show for queue join: %w", err)
	}
	if showStatus != "LIVE" {
		return Entry{}, ErrShowNotLive
	}
	// Serialize retries for the same viewer/idempotency key without locking the
	// show row exclusively. Unrelated callers can still join concurrently.
	for _, identity := range []struct {
		kind string
		hash []byte
	}{{"viewer", input.SessionTokenHash}, {"join", input.JoinKeyHash}} {
		lockKey := identity.kind + ":" + input.ShowID + ":" + hex.EncodeToString(identity.hash)
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return Entry{}, fmt.Errorf("lock queue join identity: %w", err)
		}
	}

	tier, err := r.tierForJoin(ctx, tx, input.ShowID, input.TierID)
	if err != nil {
		return Entry{}, err
	}

	existing, existingErr := scanEntry(tx.QueryRow(ctx, `
		SELECT `+entryColumns+` FROM queue_entries
		WHERE show_id = $1 AND (session_token_hash = $2 OR join_key_hash = $3)
		ORDER BY (session_token_hash = $2) DESC LIMIT 1 FOR UPDATE`, input.ShowID, input.SessionTokenHash, input.JoinKeyHash))
	if existingErr == nil && existing.Status == StatusWaiting {
		if _, err := tx.Exec(ctx, `
			UPDATE queue_entries SET session_token_hash = $1, join_key_hash = $2, updated_at = now()
			WHERE id = $3`, input.SessionTokenHash, input.JoinKeyHash, existing.ID); err != nil {
			return Entry{}, fmt.Errorf("refresh queue recovery identity: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return Entry{}, fmt.Errorf("commit idempotent queue join: %w", err)
		}
		return existing, nil
	}
	if existingErr != nil && !errors.Is(existingErr, pgx.ErrNoRows) {
		return Entry{}, fmt.Errorf("find existing queue entry: %w", existingErr)
	}

	var entry Entry
	if existingErr == nil && existing.Status == StatusLeft {
		entry, err = scanEntry(tx.QueryRow(ctx, `
			UPDATE queue_entries SET
				display_name = $1, topic = $2, status = 'WAITING', tier_id = $3,
				tier_name = $4, priority_rank = $5, call_duration_seconds = $6,
				queue_position = nextval('queue_entry_position_seq'), session_token_hash = $7,
				join_key_hash = $8, joined_at = now(), left_at = NULL, updated_at = now()
			WHERE id = $9 RETURNING `+entryColumns,
			input.DisplayName, input.Topic, tier.ID, tier.Name, tier.PriorityRank,
			tier.CallDurationSeconds, input.SessionTokenHash, input.JoinKeyHash, existing.ID))
	} else if existingErr == nil {
		if err := tx.Commit(ctx); err != nil {
			return Entry{}, fmt.Errorf("commit existing queue state: %w", err)
		}
		return existing, nil
	} else {
		entry, err = scanEntry(tx.QueryRow(ctx, `
			INSERT INTO queue_entries (
				show_id, display_name, topic, tier_id, tier_name, priority_rank,
				call_duration_seconds, session_token_hash, join_key_hash
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING `+entryColumns,
			input.ShowID, input.DisplayName, input.Topic, tier.ID, tier.Name,
			tier.PriorityRank, tier.CallDurationSeconds, input.SessionTokenHash, input.JoinKeyHash))
	}
	if err != nil {
		return Entry{}, fmt.Errorf("persist queue join: %w", err)
	}
	if err := insertOutbox(ctx, tx, "queue.caller_joined", entry); err != nil {
		return Entry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Entry{}, fmt.Errorf("commit queue join: %w", err)
	}
	return entry, nil
}

func (r *PostgresRepository) tierForJoin(ctx context.Context, tx pgx.Tx, showID, tierID string) (Tier, error) {
	var tier Tier
	var err error
	if tierID == "" {
		err = tx.QueryRow(ctx, `
			SELECT id, name, priority_rank, call_duration_seconds FROM show_tiers
			WHERE show_id = $1 AND enabled = true
			ORDER BY priority_rank DESC, created_at ASC LIMIT 1`, showID).
			Scan(&tier.ID, &tier.Name, &tier.PriorityRank, &tier.CallDurationSeconds)
	} else {
		err = tx.QueryRow(ctx, `
			SELECT id, name, priority_rank, call_duration_seconds FROM show_tiers
			WHERE show_id = $1 AND id = $2 AND enabled = true`, showID, tierID).
			Scan(&tier.ID, &tier.Name, &tier.PriorityRank, &tier.CallDurationSeconds)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Tier{}, ErrTierNotFound
	}
	if err != nil {
		return Tier{}, fmt.Errorf("find queue tier: %w", err)
	}
	return tier, nil
}

func (r *PostgresRepository) Me(ctx context.Context, showID string, tokenHash []byte) (ViewerState, error) {
	entry, err := scanEntry(r.pool.QueryRow(ctx, `SELECT `+entryColumns+` FROM queue_entries WHERE show_id = $1 AND session_token_hash = $2`, showID, tokenHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return ViewerState{}, ErrEntryNotFound
	}
	if err != nil {
		return ViewerState{}, fmt.Errorf("find viewer queue entry: %w", err)
	}

	var position int64
	if entry.Status == StatusWaiting {
		if err := r.pool.QueryRow(ctx, `
			SELECT count(*) FROM queue_entries
			WHERE show_id = $1 AND status = 'WAITING'
			  AND (priority_rank > $2 OR (priority_rank = $2 AND queue_position <= $3))`,
			showID, entry.PriorityRank, entry.QueuePosition).Scan(&position); err != nil {
			return ViewerState{}, fmt.Errorf("calculate queue position: %w", err)
		}
	}
	return ViewerState{Entry: entry, Position: position}, nil
}

func (r *PostgresRepository) Leave(ctx context.Context, showID string, tokenHash []byte, now time.Time) (Entry, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Entry{}, fmt.Errorf("begin leave queue: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	entry, err := scanEntry(tx.QueryRow(ctx, `SELECT `+entryColumns+` FROM queue_entries WHERE show_id = $1 AND session_token_hash = $2 FOR UPDATE`, showID, tokenHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrEntryNotFound
	}
	if err != nil {
		return Entry{}, fmt.Errorf("lock queue entry for leave: %w", err)
	}
	if entry.Status == StatusLeft {
		if err := tx.Commit(ctx); err != nil {
			return Entry{}, fmt.Errorf("commit idempotent queue leave: %w", err)
		}
		return entry, nil
	}
	if entry.Status != StatusWaiting {
		return Entry{}, ErrCannotLeave
	}
	entry, err = scanEntry(tx.QueryRow(ctx, `
		UPDATE queue_entries SET status = 'LEFT', left_at = $1, updated_at = $1
		WHERE id = $2 RETURNING `+entryColumns, now, entry.ID))
	if err != nil {
		return Entry{}, fmt.Errorf("leave queue: %w", err)
	}
	if err := insertOutbox(ctx, tx, "queue.caller_left", entry); err != nil {
		return Entry{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Entry{}, fmt.Errorf("commit leave queue: %w", err)
	}
	return entry, nil
}

func (r *PostgresRepository) ListWaiting(ctx context.Context, showID, creatorID string, limit, offset int) ([]Entry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT q.`+entryColumnsWithPrefix("q")+`
		FROM queue_entries q JOIN shows s ON s.id = q.show_id
		WHERE q.show_id = $1 AND s.creator_id = $2 AND q.status = 'WAITING'
		ORDER BY q.priority_rank DESC, q.queue_position ASC LIMIT $3 OFFSET $4`, showID, creatorID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list waiting queue: %w", err)
	}
	defer rows.Close()
	return collectEntries(rows)
}

func (r *PostgresRepository) AuthorizeShow(ctx context.Context, showID, creatorID string) error {
	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM shows WHERE id = $1 AND creator_id = $2)`, showID, creatorID).Scan(&exists); err != nil {
		return fmt.Errorf("authorize show queue: %w", err)
	}
	if !exists {
		return ErrShowNotFound
	}
	return nil
}

func (r *PostgresRepository) EntriesByIDs(ctx context.Context, showID, creatorID string, ids []string) ([]Entry, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT q.`+entryColumnsWithPrefix("q")+`
		FROM queue_entries q JOIN shows s ON s.id = q.show_id
		WHERE q.show_id = $1 AND s.creator_id = $2 AND q.id = ANY($3) AND q.status = 'WAITING'`, showID, creatorID, ids)
	if err != nil {
		return nil, fmt.Errorf("hydrate queue candidates: %w", err)
	}
	defer rows.Close()
	entries, err := collectEntries(rows)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Entry, len(entries))
	for _, entry := range entries {
		byID[entry.ID] = entry
	}
	ordered := make([]Entry, 0, len(entries))
	for _, id := range ids {
		if entry, ok := byID[id]; ok {
			ordered = append(ordered, entry)
		}
	}
	return ordered, nil
}

func (r *PostgresRepository) Tiers(ctx context.Context, showID string) ([]Tier, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id, t.name, t.priority_rank, t.call_duration_seconds
		FROM show_tiers t JOIN shows s ON s.id = t.show_id
		WHERE t.show_id = $1 AND t.enabled = true AND s.status = 'LIVE'
		ORDER BY t.priority_rank DESC, t.created_at ASC`, showID)
	if err != nil {
		return nil, fmt.Errorf("list show tiers: %w", err)
	}
	defer rows.Close()
	tiers := make([]Tier, 0)
	for rows.Next() {
		var tier Tier
		if err := rows.Scan(&tier.ID, &tier.Name, &tier.PriorityRank, &tier.CallDurationSeconds); err != nil {
			return nil, fmt.Errorf("scan show tier: %w", err)
		}
		tiers = append(tiers, tier)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate show tiers: %w", err)
	}
	if len(tiers) == 0 {
		return nil, ErrShowNotLive
	}
	return tiers, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventType string, entry Entry) error {
	payload, err := json.Marshal(Candidate{EntryID: entry.ID, ShowID: entry.ShowID, PriorityRank: entry.PriorityRank, QueuePosition: entry.QueuePosition})
	if err != nil {
		return fmt.Errorf("encode queue outbox: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO queue_outbox (show_id, event_type, payload) VALUES ($1, $2, $3)`, entry.ShowID, eventType, payload); err != nil {
		return fmt.Errorf("insert queue outbox: %w", err)
	}
	return nil
}

func (r *PostgresRepository) PendingOutbox(ctx context.Context, limit int) ([]OutboxEvent, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, event_type, payload FROM queue_outbox WHERE published_at IS NULL ORDER BY id LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list queue outbox: %w", err)
	}
	defer rows.Close()
	events := make([]OutboxEvent, 0, limit)
	for rows.Next() {
		var event OutboxEvent
		var payload []byte
		if err := rows.Scan(&event.ID, &event.EventType, &payload); err != nil {
			return nil, fmt.Errorf("scan queue outbox: %w", err)
		}
		if err := json.Unmarshal(payload, &event.Candidate); err != nil {
			return nil, fmt.Errorf("decode queue outbox: %w", err)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (r *PostgresRepository) MarkOutboxPublished(ctx context.Context, id int64, publishedAt time.Time) error {
	if _, err := r.pool.Exec(ctx, `UPDATE queue_outbox SET published_at = $1 WHERE id = $2`, publishedAt, id); err != nil {
		return fmt.Errorf("mark queue outbox published: %w", err)
	}
	return nil
}

func collectEntries(rows pgx.Rows) ([]Entry, error) {
	entries := make([]Entry, 0)
	for rows.Next() {
		entry, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("scan queue entry: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate queue entries: %w", err)
	}
	return entries, nil
}

func entryColumnsWithPrefix(prefix string) string {
	return `id, ` + prefix + `.show_id, ` + prefix + `.display_name, ` + prefix + `.topic, ` + prefix + `.status, ` + prefix + `.tier_id, ` + prefix + `.tier_name, ` + prefix + `.priority_rank, ` + prefix + `.call_duration_seconds, ` + prefix + `.queue_position, ` + prefix + `.joined_at, ` + prefix + `.selected_at, ` + prefix + `.left_at, ` + prefix + `.created_at, ` + prefix + `.updated_at`
}
