package social

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/bling-app/bling/backend/internal/show"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return NewStore(p)
}
func testUser(t *testing.T, s *Store, published bool) Profile {
	t.Helper()
	var b [6]byte
	_, _ = rand.Read(b[:])
	name := "social_" + hex.EncodeToString(b[:])
	var id string
	err := s.Pool.QueryRow(context.Background(), `INSERT INTO users(username,email,password_hash) VALUES($1,$2,'test-only') RETURNING id`, name, name+"@example.com").Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := s.Pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id)
		if err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	p, err := s.SaveProfile(context.Background(), id, ProfileInput{DisplayName: name, Category: "Music", Published: published})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func flush(t *testing.T, s *Store) {
	t.Helper()
	for i := 0; i < 100; i++ {
		n, err := s.FlushCounts(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			return
		}
	}
	t.Fatal("projection backlog did not drain")
}
func TestConcurrentFollowsAndCascadeCounts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	creator := testUser(t, s, true)
	viewer := testUser(t, s, false)
	if _, err := s.Profile(ctx, viewer.Username, ""); !errors.Is(err, ErrNotFound) {
		t.Fatal("viewer profile leaked", err)
	}
	if _, err := s.Follow(ctx, creator.ID, creator.Username, true); !errors.Is(err, ErrSelfFollow) {
		t.Fatal("self follow accepted", err)
	}
	for _, want := range []bool{true, false, true} {
		var wg sync.WaitGroup
		errs := make(chan error, 32)
		for i := 0; i < 32; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); _, err := s.Follow(ctx, viewer.ID, creator.Username, want); errs <- err }()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		flush(t, s)
		p, err := s.Profile(ctx, creator.Username, "")
		if err != nil {
			t.Fatal(err)
		}
		expected := int64(0)
		if want {
			expected = 1
		}
		if p.FollowerCount != expected {
			t.Fatalf("count=%d want=%d", p.FollowerCount, expected)
		}
	}
	if _, err := s.Pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, viewer.ID); err != nil {
		t.Fatal(err)
	}
	flush(t, s)
	p, _ := s.Profile(ctx, creator.Username, "")
	if p.FollowerCount != 0 {
		t.Fatal("cascade did not decrement", p)
	}
}
func TestProfilesPaginationAndFollowingIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	viewer := testUser(t, s, false)
	other := testUser(t, s, false)
	for i := 0; i < 5; i++ {
		p := testUser(t, s, true)
		if _, err := s.Follow(ctx, viewer.ID, p.Username, true); err != nil {
			t.Fatal(err)
		}
	}
	flush(t, s)
	options := ListOptions{Limit: 2, Category: "Music", Following: true}
	if err := options.Validate(); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for {
		page, err := s.List(ctx, options, viewer.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range page.Items {
			if seen[p.ID] {
				t.Fatal("duplicate cursor result")
			}
			seen[p.ID] = true
		}
		if page.NextCursor == "" {
			break
		}
		options.Cursor = page.NextCursor
		if err := options.Validate(); err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 5 {
		t.Fatalf("got %d creators", len(seen))
	}
	empty, err := s.List(ctx, ListOptions{Following: true, Limit: 24}, other.ID)
	if err != nil || len(empty.Items) != 0 {
		t.Fatal("cross-account following leak", err)
	}
	p := testUser(t, s, true)
	_, err = s.SaveProfile(ctx, p.ID, ProfileInput{DisplayName: "RareSearchToken", Bio: "Independent ceramics", Category: "Creative", Published: true})
	if err != nil {
		t.Fatal(err)
	}
	found, err := s.List(ctx, ListOptions{Query: "RareSearchToken", Category: "Creative", Limit: 24}, "")
	if err != nil || len(found.Items) != 1 || found.Items[0].ID != p.ID {
		t.Fatal("indexed text search failed", found, err)
	}
}
func TestLiveEventsAtomicAndReadOwnership(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	creator := testUser(t, s, true)
	viewer := testUser(t, s, false)
	outsider := testUser(t, s, false)
	if _, err := s.Follow(ctx, viewer.ID, creator.Username, true); err != nil {
		t.Fatal(err)
	}
	shows := show.NewPostgresStore(s.Pool)
	draft, err := shows.Create(ctx, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := shows.Start(ctx, draft.ID, creator.ID, time.Now(), true); err != nil {
			t.Fatal(err)
		}
	}
	inbox, err := s.Notifications(ctx, viewer.ID, "")
	if err != nil || len(inbox.Items) != 1 || inbox.UnreadCount != 1 || !inbox.Items[0].IsLive {
		t.Fatalf("inbox=%+v err=%v", inbox, err)
	}
	eventID, _ := strconv.ParseInt(inbox.Items[0].ID, 10, 64)
	if err := s.MarkRead(ctx, outsider.ID, []int64{eventID}); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_reads WHERE user_id=$1`, outsider.ID).Scan(&n)
	if n != 0 {
		t.Fatal("outsider marked event read")
	}
	for i := 0; i < 2; i++ {
		if err := s.MarkRead(ctx, viewer.ID, []int64{eventID}); err != nil {
			t.Fatal(err)
		}
	}
	inbox, err = s.Notifications(ctx, viewer.ID, "")
	if err != nil || inbox.UnreadCount != 0 || !inbox.Items[0].Read {
		t.Fatal("read state not durable", inbox, err)
	}
	if _, err := shows.End(ctx, draft.ID, creator.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	inbox, err = s.Notifications(ctx, viewer.ID, "")
	if err != nil || inbox.Items[0].IsLive {
		t.Fatal("ended show still live", err)
	}
	if _, err := s.Follow(ctx, outsider.ID, creator.Username, true); err != nil {
		t.Fatal(err)
	}
	inbox, err = s.Notifications(ctx, outsider.ID, "")
	if err != nil || len(inbox.Items) != 0 {
		t.Fatal("historical events sent to new follower", err)
	}
	// Profile projection and event insertion roll back with the show transaction.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var rolled string
	err = tx.QueryRow(ctx, `INSERT INTO shows(creator_id,status,started_at) VALUES($1,'LIVE',now()) RETURNING id`, creator.ID).Scan(&rolled)
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM creator_live_events WHERE show_id=$1`, rolled).Scan(&n); err != nil || n != 0 {
		t.Fatal("rolled back event escaped", err)
	}
}
func TestPresenceExpiryAndPrivateCacheDecoration(t *testing.T) {
	s := testStore(t)
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(opts)
	defer client.Close()
	ctx := context.Background()
	service := NewService(s, client, slog.New(slog.NewTextHandler(io.Discard, nil)))
	creator := testUser(t, s, true)
	viewer := testUser(t, s, false)
	shows := show.NewPostgresStore(s.Pool)
	draft, err := shows.Create(ctx, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := shows.Start(ctx, draft.ID, creator.ID, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	defer client.Del(ctx, presenceKey(draft.ID))
	for i := 0; i < 3; i++ {
		n, err := service.Heartbeat(ctx, creator.Username, "browser-one")
		if err != nil || n != 1 {
			t.Fatal("presence not deduplicated", n, err)
		}
	}
	_ = client.ZAdd(ctx, presenceKey(draft.ID), redis.Z{Score: float64(time.Now().Add(-2 * PresenceTTL).UnixMilli()), Member: "expired"}).Err()
	n, err := service.Heartbeat(ctx, creator.Username, "browser-two")
	if err != nil || n != 2 {
		t.Fatal("expired visitor counted", n, err)
	}
	if _, err := s.Follow(ctx, viewer.ID, creator.Username, true); err != nil {
		t.Fatal(err)
	}
	flush(t, s)
	service.invalidate(ctx)
	for _, userID := range []string{viewer.ID, "", viewer.ID} {
		page, err := service.List(ctx, ListOptions{Live: true, Limit: 24}, userID)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, p := range page.Items {
			if p.ID == creator.ID {
				found = true
				if p.IsFollowing != (userID == viewer.ID) {
					t.Fatal("private follow state leaked through cache")
				}
				if p.ChannelVisitors == nil || *p.ChannelVisitors != 2 {
					t.Fatal("visitor count missing")
				}
			}
		}
		if !found {
			t.Fatal("live creator missing")
		}
	}
	if service.CacheHits.Load() < 2 {
		t.Fatal("shared cache not reused")
	}
}

// Force the race between a worker deleting its dirty marker and an uncommitted
// follower write. The write must requeue the creator rather than lose its count.
func TestProjectionRequeuesConcurrentWriter(t *testing.T) {
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	creator := testUser(t, s, true)
	viewer := testUser(t, s, false)
	if _, err := s.Pool.Exec(ctx, `SELECT mark_social_dirty($1)`, creator.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT 1 FROM social_dirty_creators WHERE creator_id=$1 FOR UPDATE`, creator.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := s.Follow(ctx, viewer.ID, creator.Username, true); done <- err }()
	// Wait until the follower transaction actually blocks on the worker's lock.
	for {
		var waiting bool
		if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO creator_follows%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case err = <-done:
			t.Fatalf("writer escaped dirty lock: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM social_dirty_creators WHERE creator_id=$1`, creator.ID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	flush(t, s)
	p, err := s.Profile(ctx, creator.Username, "")
	if err != nil || p.FollowerCount != 1 {
		t.Fatalf("lost count: %+v %v", p, err)
	}
}

func TestNotificationPaginationAndRetention(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	creator := testUser(t, s, true)
	viewer := testUser(t, s, false)
	if _, err := s.Follow(ctx, viewer.ID, creator.Username, true); err != nil {
		t.Fatal(err)
	}
	// Archived shows are test fixtures; production emits events in the show transaction.
	_, err := s.Pool.Exec(ctx, `WITH fixtures AS (INSERT INTO shows(creator_id,status,ended_at) SELECT $1,'ENDED',now() FROM generate_series(1,110) RETURNING id)
 INSERT INTO creator_live_events(creator_id,show_id) SELECT $1,id FROM fixtures`, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	cursor := ""
	seen := map[string]bool{}
	var ids []int64
	for {
		page, err := s.Notifications(ctx, viewer.ID, cursor)
		if err != nil {
			t.Fatal(err)
		}
		if page.UnreadCount != 100 || !page.UnreadCapped {
			t.Fatal("unread cap", page)
		}
		for _, n := range page.Items {
			if seen[n.ID] {
				t.Fatal("duplicate event")
			}
			seen[n.ID] = true
			id, _ := strconv.ParseInt(n.ID, 10, 64)
			ids = append(ids, id)
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != 110 {
		t.Fatal("missing events", len(seen))
	}
	for i := 0; i < len(ids); i += 50 {
		end := min(i+50, len(ids))
		if err := s.MarkRead(ctx, viewer.ID, ids[i:end]); err != nil {
			t.Fatal(err)
		}
	}
	page, err := s.Notifications(ctx, viewer.ID, "")
	if err != nil || page.UnreadCount != 0 {
		t.Fatal("read count", page, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE creator_live_events SET created_at=now()-interval '31 days' WHERE creator_id=$1`, creator.ID); err != nil {
		t.Fatal(err)
	}
	page, err = s.Notifications(ctx, viewer.ID, "")
	if err != nil || len(page.Items) != 0 {
		t.Fatal("expired events visible", err)
	}
	if err = s.PruneEvents(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_reads WHERE user_id=$1`, viewer.ID).Scan(&n); err != nil || n != 0 {
		t.Fatal("receipt retention", n, err)
	}
}
