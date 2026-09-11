package social

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// Opt-in, creates and removes synthetic accounts in an explicitly isolated DB.
// Measures repository/service latency, not HTTP/TLS or production capacity.
func TestSocialLoad(t *testing.T) {
	if os.Getenv("RUN_SOCIAL_LOAD") != "1" {
		t.Skip("opt-in load measurement")
	}
	s := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var db string
	if err := s.Pool.QueryRow(ctx, `SELECT current_database()`).Scan(&db); err != nil {
		t.Fatal(err)
	}
	if db != "bling_social_test" && db != "bling_social_load" {
		t.Fatal("load test requires bling_social_test or bling_social_load")
	}
	var token [5]byte
	_, _ = rand.Read(token[:])
	prefix := "load_" + hex.EncodeToString(token[:]) + "_"
	rows, err := s.Pool.Query(ctx, `INSERT INTO users(username,email,password_hash) SELECT $1||n::text,$1||n::text||'@example.com','load-test-only' FROM generate_series(1,10000) n RETURNING id`, prefix)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if _, err := s.Pool.Exec(cleanup, `DELETE FROM users WHERE id=ANY($1::uuid[])`, ids); err != nil {
			t.Error(err)
		}
	})
	if _, err = s.Pool.Exec(ctx, `UPDATE creator_profiles SET published=true,category=CASE WHEN substring(username from '[0-9]+$')::int%2=0 THEN 'Music' ELSE 'Creative' END WHERE user_id=ANY($1::uuid[])`, ids); err != nil {
		t.Fatal(err)
	}
	viewer := testUser(t, s, false)
	if _, err = s.Pool.Exec(ctx, `INSERT INTO creator_follows(follower_id,creator_id) SELECT $1,unnest($2::uuid[])`, viewer.ID, ids[:1000]); err != nil {
		t.Fatal(err)
	}
	var extraName, followedName string
	_ = s.Pool.QueryRow(ctx, `SELECT username FROM creator_profiles WHERE user_id=$1`, ids[1001]).Scan(&extraName)
	_ = s.Pool.QueryRow(ctx, `SELECT username FROM creator_profiles WHERE user_id=$1`, ids[0]).Scan(&followedName)
	if _, err = s.Follow(ctx, viewer.ID, extraName, true); err != ErrFollowLimit {
		t.Fatal("follow limit bypassed", err)
	}
	if _, err = s.Follow(ctx, viewer.ID, followedName, true); err != nil {
		t.Fatal("idempotent follow at limit failed", err)
	}
	if _, err = s.Pool.Exec(ctx, `WITH fixtures AS (INSERT INTO shows(creator_id,status,ended_at) SELECT unnest($1::uuid[]),'ENDED',now() RETURNING id,creator_id)
 INSERT INTO creator_live_events(creator_id,show_id) SELECT creator_id,id FROM fixtures`, ids[:200]); err != nil {
		t.Fatal(err)
	}
	flush(t, s)
	if _, err = s.Pool.Exec(ctx, `ANALYZE creator_profiles; ANALYZE creator_follows; ANALYZE creator_live_events`); err != nil {
		t.Fatal(err)
	}
	options, err := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if err != nil {
		t.Fatal(err)
	}
	r := redis.NewClient(options)
	defer r.Close()
	service := NewService(s, r, slog.New(slog.NewTextHandler(io.Discard, nil)))
	service.invalidate(ctx)
	// Warm the fixed public first page before measuring its steady-state cache.
	if _, err = service.List(ctx, ListOptions{Limit: 24}, ""); err != nil {
		t.Fatal(err)
	}
	measure := func(name string, n int, fn func(int) error) {
		samples := make([]time.Duration, n)
		jobs := make(chan int)
		errs := make(chan error, n)
		var wg sync.WaitGroup
		start := time.Now()
		for worker := 0; worker < 16; worker++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := range jobs {
					start := time.Now()
					err := fn(i)
					samples[i] = time.Since(start)
					if err != nil {
						errs <- err
					}
				}
			}()
		}
		for i := 0; i < n; i++ {
			jobs <- i
		}
		close(jobs)
		wg.Wait()
		elapsed := time.Since(start)
		close(errs)
		for err := range errs {
			t.Error(name, err)
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		t.Logf("%s: requests=%d concurrency=16 p50=%s p95=%s throughput=%.0f/s", name, n, samples[n/2], samples[(n*95)/100], float64(n)/elapsed.Seconds())
	}
	measure("cached public discovery", 1000, func(int) error { _, err := service.List(ctx, ListOptions{Limit: 24}, ""); return err })
	measure("following feed (1000 follows)", 500, func(int) error {
		_, err := service.List(ctx, ListOptions{Following: true, Limit: 24}, viewer.ID)
		return err
	})
	measure("notifications (1000 follows, 200 events)", 500, func(int) error { _, err := s.Notifications(ctx, viewer.ID, ""); return err })
	actors := make([]Profile, 16)
	for i := range actors {
		actors[i] = testUser(t, s, false)
	}
	measure("follow/unfollow writes", 500, func(i int) error {
		_, err := s.Follow(ctx, actors[i%len(actors)].ID, followedName, (i/len(actors))%2 == 0)
		return err
	})
	for _, query := range []string{
		`SELECT user_id FROM creator_profiles WHERE published ORDER BY is_live DESC,follower_count DESC,user_id DESC LIMIT 25`,
		`SELECT user_id FROM creator_profiles WHERE published AND category='Music' ORDER BY is_live DESC,follower_count DESC,user_id DESC LIMIT 25`,
		`SELECT user_id FROM creator_profiles WHERE published AND search_document @@ plainto_tsquery('simple','nonexistent') ORDER BY is_live DESC,follower_count DESC,user_id DESC LIMIT 25`,
	} {
		rows, err := s.Pool.Query(ctx, "EXPLAIN (ANALYZE,BUFFERS) "+query)
		if err != nil {
			t.Fatal(err)
		}
		plan := ""
		for rows.Next() {
			var line string
			_ = rows.Scan(&line)
			plan += line + "\n"
		}
		rows.Close()
		t.Log(fmt.Sprintf("Plan:\n%s", plan))
	}
	service.invalidate(ctx)
}
