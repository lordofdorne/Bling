package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProviderServiceWithSupabaseHTTPClientRegistrationAndConfirmation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "auth-key" {
			t.Error("missing server-held Supabase key")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/v1/signup":
			if r.URL.Query().Get("redirect_to") != "https://api.test/confirm" {
				t.Errorf("unexpected signup redirect %q", r.URL.Query().Get("redirect_to"))
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["email"] != "alice@example.com" || body["password"] == "" {
				t.Errorf("unexpected signup body %+v", body)
			}
			_, _ = io.WriteString(w, `{"id":"user-1","email":"alice@example.com","identities":[{}]}`)
		case "/auth/v1/verify":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["type"] != "email" || body["token_hash"] != "confirmation-hash" {
				t.Errorf("unexpected verification body %+v", body)
			}
			_, _ = io.WriteString(w, `{
				"access_token":"access-token",
				"refresh_token":"refresh-token",
				"expires_in":3600,
				"user":{"id":"user-1","email":"alice@example.com","email_confirmed_at":"2026-09-20T12:00:00Z"}
			}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider, err := NewSupabaseIdentityProvider(server.URL, "auth-key", "service-key", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	provider.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	store := &fakeProviderStore{
		createUser:   User{ID: "user-1", Username: "alice", Email: "alice@example.com"},
		providerUser: User{ID: "user-1", Username: "alice", Email: "alice@example.com"},
	}
	service := testProviderService(t, store, provider)

	user, session, err := service.Register(context.Background(), RegisterInput{
		Username: "alice", Email: "alice@example.com", Password: "long-enough-password",
	})
	if err != nil || user.ID != "user-1" || session != "" {
		t.Fatalf("Register() user=%+v session=%q err=%v", user, session, err)
	}
	user, session, err = service.ConfirmEmail(context.Background(), "confirmation-hash")
	if err != nil || user.ID != "user-1" || session != "opaque-token" {
		t.Fatalf("ConfirmEmail() user=%+v session=%q err=%v", user, session, err)
	}
	refresh, err := service.cipher.Open(store.createdSessionRefresh)
	if err != nil || refresh != "refresh-token" {
		t.Fatalf("stored refresh token=%q err=%v", refresh, err)
	}
}

func TestProviderServiceWithSupabaseHTTPClientPasswordRecovery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/v1/recover":
			if r.URL.Query().Get("redirect_to") != "https://api.test/reset" {
				t.Errorf("unexpected recovery redirect %q", r.URL.Query().Get("redirect_to"))
			}
			w.WriteHeader(http.StatusOK)
		case "/auth/v1/verify":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["type"] != "recovery" || body["token_hash"] != "recovery-hash" {
				t.Errorf("unexpected recovery verification %+v", body)
			}
			_, _ = io.WriteString(w, `{
				"access_token":"recovery-access",
				"refresh_token":"recovery-refresh",
				"expires_in":3600,
				"user":{"id":"user-1","email":"alice@example.com","email_confirmed_at":"2026-09-20T12:00:00Z"}
			}`)
		case "/auth/v1/user":
			if r.Method != http.MethodPut || r.Header.Get("Authorization") != "Bearer recovery-access" {
				t.Errorf("unexpected password update request")
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["password"] != "a-new-long-password" {
				t.Errorf("unexpected password body %+v err=%v", body, err)
			}
			w.WriteHeader(http.StatusOK)
		case "/auth/v1/logout":
			if r.Header.Get("Authorization") != "Bearer recovery-access" {
				t.Error("logout did not use the recovery access token")
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider, err := NewSupabaseIdentityProvider(server.URL, "auth-key", "service-key", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeProviderStore{providerUser: User{ID: "user-1", Email: "alice@example.com"}}
	service := testProviderService(t, store, provider)

	if err := service.ForgotPassword(context.Background(), "alice@example.com"); err != nil {
		t.Fatalf("ForgotPassword() error = %v", err)
	}
	grant, err := service.BeginPasswordReset(context.Background(), "recovery-hash")
	if err != nil {
		t.Fatalf("BeginPasswordReset() error = %v", err)
	}
	store.recoveryGrant = RecoveryGrant{UserID: "user-1", EncryptedAccessToken: store.recoveryEncryptedToken}
	if err := service.ResetPassword(context.Background(), grant, "a-new-long-password"); err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}
	if store.revokedUserID != "user-1" {
		t.Fatalf("password reset did not revoke sessions: %+v", store)
	}
}
