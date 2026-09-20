package auth

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestSupabaseProvider(t *testing.T, handler http.HandlerFunc) *SupabaseIdentityProvider {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	provider, err := NewSupabaseIdentityProvider(server.URL, "auth-key", "service-key", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	provider.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	return provider
}

func TestSupabaseSignInReturnsIdentityAndTokens(t *testing.T) {
	provider := newTestSupabaseProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/token" || r.URL.Query().Get("grant_type") != "password" {
			t.Errorf("unexpected request URL %s", r.URL.String())
		}
		if r.Header.Get("apikey") != "auth-key" || r.Header.Get("Authorization") != "Bearer auth-key" {
			t.Errorf("unexpected auth headers")
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"email":"alice@example.com"`) {
			t.Errorf("unexpected request body %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"access_token":"access-secret",
			"refresh_token":"refresh-secret",
			"expires_in":3600,
			"user":{"id":"user-1","email":"alice@example.com","email_confirmed_at":"2026-09-20T11:00:00Z"}
		}`)
	})

	identity, tokens, err := provider.SignInWithPassword(context.Background(), "alice@example.com", "password")
	if err != nil {
		t.Fatalf("SignInWithPassword() error = %v", err)
	}
	if identity.ID != "user-1" || identity.EmailConfirmedAt == nil {
		t.Fatalf("unexpected identity %+v", identity)
	}
	if tokens.AccessToken != "access-secret" || tokens.RefreshToken != "refresh-secret" {
		t.Fatalf("unexpected tokens %+v", tokens)
	}
	if want := time.Date(2026, 9, 20, 13, 0, 0, 0, time.UTC); !tokens.ExpiresAt.Equal(want) {
		t.Fatalf("ExpiresAt = %v, want %v", tokens.ExpiresAt, want)
	}
}

func TestSupabaseErrorsAreMappedWithoutLeakingResponse(t *testing.T) {
	const sensitive = "provider-debug-password-and-token"
	provider := newTestSupabaseProvider(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error_code":"invalid_credentials","msg":"`+sensitive+`"}`)
	})

	_, _, err := provider.SignInWithPassword(context.Background(), "alice@example.com", "wrong")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("error = %v, want invalid credentials", err)
	}
	if strings.Contains(err.Error(), sensitive) {
		t.Fatal("provider response leaked through error")
	}
}

func TestSupabaseRejectsOversizedResponses(t *testing.T) {
	provider := newTestSupabaseProvider(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", maxIdentityResponseBytes+1))
	})

	_, _, err := provider.SignInWithPassword(context.Background(), "alice@example.com", "password")
	if err == nil || !strings.Contains(err.Error(), "exceeded limit") {
		t.Fatalf("error = %v", err)
	}
}

func TestSupabaseDeleteUserUsesAdministrativeCredential(t *testing.T) {
	provider := newTestSupabaseProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/auth/v1/admin/users/user-1" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer service-key" {
			t.Error("administrative request did not use service-role authorization")
		}
		w.WriteHeader(http.StatusNoContent)
	})

	if err := provider.DeleteUser(context.Background(), "user-1"); err != nil {
		t.Fatalf("DeleteUser() error = %v", err)
	}
}

func TestSupabaseProviderValidatesConstructorInput(t *testing.T) {
	if _, err := NewSupabaseIdentityProvider("not-a-url", "key", "", time.Second); err == nil {
		t.Fatal("expected invalid URL error")
	}
	if _, err := NewSupabaseIdentityProvider("https://project.supabase.co", "", "", time.Second); err == nil {
		t.Fatal("expected missing key error")
	}
	if _, err := NewSupabaseIdentityProvider("https://project.supabase.co", "key", "", 0); err == nil {
		t.Fatal("expected invalid timeout error")
	}
}
