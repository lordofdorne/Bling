package auth

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProviderSessionStoreRotationAndRecoveryGrant(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := NewPostgresProviderSessionStore(pool)

	var userID string
	if err := pool.QueryRow(ctx, `SELECT gen_random_uuid()`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	identity := Identity{ID: userID, Email: userID + "@example.com"}
	user, err := store.CreateProviderUser(ctx, identity, "provider_"+userID[:8])
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, user.ID)
	})

	now := time.Now().UTC()
	sessionHash := HashToken("store-session")
	if err := store.CreateProviderSession(ctx, user.ID, sessionHash, "v1.encrypted-old", now.Add(time.Hour), now, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.ProviderSessionByToken(ctx, sessionHash, now)
	if err != nil || loaded.User.ID != user.ID || loaded.EncryptedRefreshToken != "v1.encrypted-old" {
		t.Fatalf("ProviderSessionByToken() session=%+v err=%v", loaded, err)
	}
	rotated, err := store.RotateProviderSession(ctx, sessionHash, "v1.encrypted-old", "v1.encrypted-new", now.Add(2*time.Hour), now.Add(time.Minute))
	if err != nil || !rotated {
		t.Fatalf("first rotation rotated=%v err=%v", rotated, err)
	}
	rotated, err = store.RotateProviderSession(ctx, sessionHash, "v1.encrypted-old", "v1.stale-race", now.Add(2*time.Hour), now.Add(time.Minute))
	if err != nil || rotated {
		t.Fatalf("stale rotation rotated=%v err=%v", rotated, err)
	}

	grantHash := HashToken("store-recovery")
	if err := store.CreateRecoveryGrant(ctx, user.ID, grantHash, "v1.encrypted-access", now.Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	grant, err := store.ClaimRecoveryGrant(ctx, grantHash, now)
	if err != nil || grant.UserID != user.ID || grant.EncryptedAccessToken != "v1.encrypted-access" {
		t.Fatalf("ClaimRecoveryGrant() grant=%+v err=%v", grant, err)
	}
	if _, err := store.ClaimRecoveryGrant(ctx, grantHash, now); !errors.Is(err, ErrInvalidIdentityToken) {
		t.Fatalf("replayed recovery grant error=%v", err)
	}
}
