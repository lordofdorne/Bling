package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	"github.com/bling-app/bling/backend/internal/show"
	"github.com/bling-app/bling/backend/internal/social"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type socialTestLimiter struct {
	auth.RateLimiter
	prefix string
}

func (l socialTestLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	return l.RateLimiter.Allow(ctx, l.prefix+key, limit, window)
}

func TestSocialHTTPJourney(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if dsn == "" || redisURL == "" {
		t.Skip("requires isolated test services")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	r := redis.NewClient(options)
	defer r.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	var limitToken [8]byte
	_, _ = rand.Read(limitToken[:])
	limiter := socialTestLimiter{auth.NewRedisRateLimiter(r), "social-test:" + hex.EncodeToString(limitToken[:]) + ":"}
	authService := auth.NewService(auth.NewPostgresStore(pool), 10, time.Hour)
	authentication := &authHandler{service: authService, limiter: limiter, logger: logger, sessionTTL: time.Hour, rateWindow: time.Minute}
	svc := social.NewService(social.NewStore(pool), r, logger)
	socialAPI := &socialHandler{service: svc, authentication: authService, limiter: limiter, logger: logger}
	shows := &showHandler{service: show.NewService(show.NewPostgresStore(pool)), logger: logger}
	server := httptest.NewServer(newRouterWithCalls(logger, healthHandler{}, authentication, shows, nil, nil, nil, nil, nil, nil, nil, []string{"http://localhost:5173"}, socialAPI))
	defer server.Close()
	client := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		return &http.Client{Jar: jar, Timeout: 5 * time.Second}
	}
	host, viewer, guest := client(), client(), client()
	request := func(c *http.Client, method, path string, input any, status int) json.RawMessage {
		t.Helper()
		var body []byte
		if input != nil {
			body, _ = json.Marshal(input)
		}
		req, err := http.NewRequest(method, server.URL+"/api/v1"+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:5173")
		response, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status {
			t.Fatalf("%s %s = %d: %s", method, path, response.StatusCode, raw)
		}
		var data struct{ Data json.RawMessage }
		_ = json.Unmarshal(raw, &data)
		return data.Data
	}
	var token [5]byte
	_, _ = rand.Read(token[:])
	prefix := "http_" + hex.EncodeToString(token[:])
	for i, c := range []*http.Client{host, viewer} {
		name := prefix + []string{"_host", "_fan"}[i]
		raw := request(c, "POST", "/auth/register", map[string]string{"username": name, "email": name + "@example.com", "password": "integration-password"}, 201)
		var account struct{ User auth.User }
		if err = json.Unmarshal(raw, &account); err != nil {
			t.Fatal(err)
		}
		defer pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, account.User.ID)
	}
	name := prefix + "_host"
	request(guest, "GET", "/creators/"+name, nil, 404)
	request(guest, "POST", "/creators/"+name+"/follow", map[string]any{}, 401)
	raw := request(host, "POST", "/profile", social.ProfileInput{DisplayName: "HTTP Creator", Bio: "Real profile", Category: "Music", Published: true}, 200)
	if bytes.Contains(raw, []byte("email")) || bytes.Contains(raw, []byte("password")) {
		t.Fatal("private fields in profile")
	}
	request(viewer, "POST", "/creators/"+name+"/follow", map[string]any{}, 200)
	request(viewer, "POST", "/creators/"+name+"/follow", map[string]any{}, 200)
	request(host, "POST", "/creators/"+name+"/follow", map[string]any{}, 422)
	raw = request(host, "POST", "/shows", nil, 201)
	var created struct{ Show show.Show }
	if err = json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}
	request(host, "POST", "/shows/"+created.Show.ID+"/start", nil, 200)
	raw = request(viewer, "GET", "/following?live=true", nil, 200)
	var feed social.Page
	if err = json.Unmarshal(raw, &feed); err != nil || len(feed.Items) != 1 || !feed.Items[0].IsFollowing || !feed.Items[0].IsLive {
		t.Fatalf("feed %+v %v", feed, err)
	}
	// This existing route must still resolve beside the new social profile route.
	request(guest, "GET", "/creators/"+name+"/live-show", nil, 200)
	for i := 0; i < 2; i++ {
		raw = request(guest, "POST", "/creators/"+name+"/presence", map[string]any{}, 200)
		var presence struct{ ChannelVisitors int }
		_ = json.Unmarshal(raw, &presence)
		if presence.ChannelVisitors != 1 {
			t.Fatal("browser presence not deduplicated", string(raw))
		}
	}
	raw = request(viewer, "GET", "/notifications", nil, 200)
	var inbox social.Notifications
	_ = json.Unmarshal(raw, &inbox)
	if len(inbox.Items) != 1 || inbox.UnreadCount != 1 {
		t.Fatal("missing live event", string(raw))
	}
	request(viewer, "POST", "/notifications/read", map[string]any{"ids": []string{inbox.Items[0].ID}}, 204)
	raw = request(viewer, "GET", "/notifications", nil, 200)
	_ = json.Unmarshal(raw, &inbox)
	if inbox.UnreadCount != 0 {
		t.Fatal("read state not persisted")
	}
	request(host, "POST", "/shows/"+created.Show.ID+"/end", nil, 200)
	request(guest, "POST", "/creators/"+name+"/presence", map[string]any{}, 409)
	request(viewer, "DELETE", "/creators/"+name+"/follow", nil, 200)
	raw = request(viewer, "GET", "/following", nil, 200)
	_ = json.Unmarshal(raw, &feed)
	if len(feed.Items) != 0 {
		t.Fatal("unfollow not durable")
	}
	request(viewer, "POST", "/auth/logout", nil, 204)
	request(viewer, "GET", "/following", nil, 401)
}
