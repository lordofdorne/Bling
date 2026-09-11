package social

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{Pool: pool} }

const profileColumns = `p.user_id,p.username,p.display_name,p.bio,p.avatar_url,p.cover_url,p.category,p.published,p.follower_count,p.is_live,p.live_show_id,p.live_started_at`

func scanProfile(row pgx.Row) (Profile, error) {
	var p Profile
	err := row.Scan(&p.ID, &p.Username, &p.DisplayName, &p.Bio, &p.AvatarURL, &p.CoverURL, &p.Category, &p.Published, &p.FollowerCount, &p.IsLive, &p.LiveShowID, &p.LiveStartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}
func (s *Store) Profile(ctx context.Context, username, ownerID string) (Profile, error) {
	return scanProfile(s.Pool.QueryRow(ctx, `SELECT `+profileColumns+` FROM creator_profiles p WHERE p.username=$1 AND (p.published OR p.user_id=NULLIF($2,'')::uuid)`, username, ownerID))
}
func (s *Store) OwnProfile(ctx context.Context, id string) (Profile, error) {
	return scanProfile(s.Pool.QueryRow(ctx, `SELECT `+profileColumns+` FROM creator_profiles p WHERE p.user_id=$1`, id))
}
func (s *Store) SaveProfile(ctx context.Context, id string, input ProfileInput) (Profile, error) {
	return scanProfile(s.Pool.QueryRow(ctx, `UPDATE creator_profiles p SET display_name=$2,bio=$3,avatar_url=$4,cover_url=$5,category=$6,published=$7 OR is_live,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING `+profileColumns, id, input.DisplayName, input.Bio, input.AvatarURL, input.CoverURL, input.Category, input.Published))
}
func (s *Store) List(ctx context.Context, o ListOptions, userID string) (Page, error) {
	result := Page{Items: []Profile{}}
	args := []any{}
	where := []string{"p.published"}
	add := func(value any) string { args = append(args, value); return fmt.Sprintf("$%d", len(args)) }
	from := "creator_profiles p"
	if o.Following {
		from += " JOIN creator_follows f ON f.creator_id=p.user_id"
		where = append(where, "f.follower_id="+add(userID)+"::uuid")
	}
	if o.Live {
		where = append(where, "p.is_live")
	}
	if o.Category != "" {
		where = append(where, "p.category="+add(o.Category))
	}
	if o.Query != "" {
		where = append(where, "p.search_document @@ plainto_tsquery('simple',"+add(o.Query)+")")
	}
	cursor, err := o.decodeCursor()
	if err != nil {
		return result, err
	}
	if cursor != nil {
		where = append(where, "(p.is_live,p.follower_count,p.user_id)<("+add(cursor.Live)+","+add(cursor.Count)+","+add(cursor.ID)+"::uuid)")
	}
	query := `SELECT ` + profileColumns + ` FROM ` + from + ` WHERE ` + strings.Join(where, " AND ") + ` ORDER BY p.is_live DESC,p.follower_count DESC,p.user_id DESC LIMIT ` + add(o.Limit+1)
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, p)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if len(result.Items) > o.Limit {
		result.Items = result.Items[:o.Limit]
		last := result.Items[o.Limit-1]
		result.NextCursor = encodeCursor(directoryCursor{last.IsLive, last.FollowerCount, last.ID, o.scope()})
	}
	return result, nil
}
func (s *Store) FollowingIDs(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	result := map[string]bool{}
	if userID == "" || len(ids) == 0 {
		return result, nil
	}
	rows, err := s.Pool.Query(ctx, `SELECT creator_id FROM creator_follows WHERE follower_id=$1 AND creator_id=ANY($2::uuid[])`, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = true
	}
	return result, rows.Err()
}
func (s *Store) Follow(ctx context.Context, userID, username string, follow bool) (bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Serialize only writes by the same viewer, not every follower of a creator.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1701))`, userID); err != nil {
		return false, err
	}
	var creatorID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM creator_profiles WHERE username=$1 AND (published OR NOT $2)`, username, follow).Scan(&creatorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	if userID == creatorID {
		return false, ErrSelfFollow
	}
	if follow {
		var existing bool
		var count int
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM creator_follows WHERE follower_id=$1 AND creator_id=$2),(SELECT count(*) FROM creator_follows WHERE follower_id=$1)`, userID, creatorID).Scan(&existing, &count); err != nil {
			return false, err
		}
		if !existing && count >= 1000 {
			return false, ErrFollowLimit
		}
		_, err = tx.Exec(ctx, `INSERT INTO creator_follows(follower_id,creator_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, creatorID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM creator_follows WHERE follower_id=$1 AND creator_id=$2`, userID, creatorID)
	}
	if err != nil {
		return false, err
	}
	return follow, tx.Commit(ctx)
}
func (s *Store) FollowingCount(ctx context.Context, id string) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM creator_follows WHERE follower_id=$1`, id).Scan(&count)
	return count, err
}

func (s *Store) Notifications(ctx context.Context, id, cursorRaw string) (Notifications, error) {
	result := Notifications{Items: []Notification{}}
	cursor, err := decodeNotificationCursor(cursorRaw)
	if err != nil {
		return result, err
	}
	at := time.Now().Add(time.Minute)
	beforeID := int64(9223372036854775807)
	if cursor != nil {
		at = cursor.At
		beforeID = cursor.ID
	}
	// A viewer has at most 1000 follows. Each lateral lookup visits at most 25
	// indexed events; no operation scans or materializes a creator's follower list.
	rows, err := s.Pool.Query(ctx, `SELECT e.id::text,p.username,p.display_name,p.avatar_url,e.show_id,e.created_at,
 (p.live_show_id=e.show_id AND p.is_live) IS TRUE, nr.event_id IS NOT NULL
 FROM creator_follows f
 JOIN creator_profiles p ON p.user_id=f.creator_id AND p.published
 CROSS JOIN LATERAL (SELECT id,show_id,created_at FROM creator_live_events e WHERE e.creator_id=f.creator_id
 AND e.created_at>=f.created_at AND e.created_at>now()-interval '30 days' AND (e.created_at,e.id)<($2,$3)
 ORDER BY e.created_at DESC,e.id DESC LIMIT 25) e
 LEFT JOIN notification_reads nr ON nr.user_id=f.follower_id AND nr.event_id=e.id
 WHERE f.follower_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 25`, id, at, beforeID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Username, &n.DisplayName, &n.AvatarURL, &n.ShowID, &n.CreatedAt, &n.IsLive, &n.Read); err != nil {
			return result, err
		}
		result.Items = append(result.Items, n)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	rows.Close()
	if len(result.Items) > 24 {
		result.Items = result.Items[:24]
		last := result.Items[23]
		eventID, _ := strconv.ParseInt(last.ID, 10, 64)
		result.NextCursor = encodeCursor(notificationCursor{last.CreatedAt, eventID})
	}
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM (
 SELECT e.id FROM creator_follows f JOIN creator_profiles p ON p.user_id=f.creator_id AND p.published
 CROSS JOIN LATERAL (SELECT e.id FROM creator_live_events e WHERE e.creator_id=f.creator_id
 AND e.created_at>=f.created_at AND e.created_at>now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.user_id=$1 AND nr.event_id=e.id)
 ORDER BY e.created_at DESC,e.id DESC LIMIT 100) e WHERE f.follower_id=$1 LIMIT 100) unread`, id).Scan(&result.UnreadCount)
	result.UnreadCapped = result.UnreadCount == 100
	return result, err
}
func (s *Store) MarkRead(ctx context.Context, id string, eventIDs []int64) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO notification_reads(user_id,event_id)
 SELECT $1,e.id FROM creator_live_events e JOIN creator_follows f ON f.creator_id=e.creator_id AND f.follower_id=$1
 JOIN creator_profiles p ON p.user_id=e.creator_id AND p.published
 WHERE e.id=ANY($2::bigint[]) AND e.created_at>=f.created_at AND e.created_at>now()-interval '30 days'
 ON CONFLICT DO NOTHING`, id, eventIDs)
	return err
}
func (s *Store) FlushCounts(ctx context.Context) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT creator_id FROM social_dirty_creators ORDER BY queued_at,creator_id LIMIT 100 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	// Shard writers do not acquire profile row locks; projection is eventually consistent.
	_, err = tx.Exec(ctx, `UPDATE creator_profiles p SET follower_count=(SELECT COALESCE(sum(count),0) FROM creator_follower_shards WHERE creator_id=p.user_id) WHERE p.user_id=ANY($1::uuid[])`, ids)
	if err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM social_dirty_creators WHERE creator_id=ANY($1::uuid[])`, ids); err != nil {
		return 0, err
	}
	return len(ids), tx.Commit(ctx)
}
func (s *Store) PruneEvents(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Bound receipt deletion as well as event deletion. A famous creator's event
	// can have millions of read receipts; do not cascade them all in one tick.
	_, err = tx.Exec(ctx, `DELETE FROM notification_reads nr WHERE (user_id,event_id) IN (
  SELECT r.user_id,r.event_id FROM
  (SELECT id FROM creator_live_events WHERE created_at<now()-interval '30 days' ORDER BY created_at,id LIMIT 1000) e
  JOIN notification_reads r ON r.event_id=e.id LIMIT 5000)`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM creator_live_events e WHERE e.id IN (
 SELECT old.id FROM (SELECT id FROM creator_live_events WHERE created_at<now()-interval '30 days' ORDER BY created_at,id LIMIT 1000) old
 WHERE NOT EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.event_id=old.id))`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
