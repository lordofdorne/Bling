package social

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

func newTestAvatarStore(t *testing.T, handler http.HandlerFunc) *SupabaseAvatarStore {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	store, err := NewSupabaseAvatarStore(
		server.URL,
		"header.payload.signature",
		"profile-avatars",
		time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	store.client = server.Client()
	return store
}

func TestSupabaseAvatarStoreUploadsWithBackendCredential(t *testing.T) {
	image := []byte{0xff, 0xd8, 0xff}
	store := newTestAvatarStore(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/storage/v1/object/profile-avatars/user-1/avatar" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("apikey") != "header.payload.signature" || r.Header.Get("Authorization") != "Bearer header.payload.signature" {
			t.Error("storage request did not use the backend service credential")
		}
		if r.Header.Get("x-upsert") != "true" || r.Header.Get("Content-Type") != "image/jpeg" {
			t.Error("storage upload headers are incomplete")
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != string(image) {
			t.Errorf("unexpected upload body %v", body)
		}
		w.WriteHeader(http.StatusOK)
	})

	if err := store.Put(context.Background(), "user-1", "image/jpeg", image); err != nil {
		t.Fatalf("Put() error = %v", err)
	}
}

func TestSupabaseAvatarStoreDownloadsBoundedImage(t *testing.T) {
	store := newTestAvatarStore(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/storage/v1/object/authenticated/profile-avatars/user-1/avatar" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png-data"))
	})

	avatar, err := store.Get(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if avatar.ContentType != "image/png" || string(avatar.Data) != "png-data" {
		t.Fatalf("unexpected avatar %+v", avatar)
	}
}

func TestSupabaseAvatarStoreMapsNotFoundAndRedactsProviderErrors(t *testing.T) {
	store := newTestAvatarStore(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "missing") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "sensitive-provider-diagnostic")
	})

	if _, err := store.Get(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get() error = %v, want not found", err)
	}
	err := store.Put(context.Background(), "user-1", "image/jpeg", []byte("image"))
	if err == nil || strings.Contains(err.Error(), "sensitive-provider-diagnostic") {
		t.Fatalf("provider details leaked through error: %v", err)
	}
}

func TestSupabaseAvatarStoreValidatesConfigurationAndObjects(t *testing.T) {
	if _, err := NewSupabaseAvatarStore("http://project.supabase.co", "header.payload.signature", "avatars", time.Second); err == nil {
		t.Fatal("expected insecure URL to fail")
	}
	if _, err := NewSupabaseAvatarStore("https://project.supabase.co", "sb_secret_not-a-jwt", "avatars", time.Second); err == nil {
		t.Fatal("expected non-JWT service key to fail")
	}
	store := newTestAvatarStore(t, func(http.ResponseWriter, *http.Request) {
		t.Fatal("invalid object should not make a request")
	})
	if err := store.Put(context.Background(), "user-1", "text/plain", []byte("bad")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Put() error = %v, want invalid", err)
	}
	if err := store.Put(context.Background(), "user-1", "image/png", make([]byte, maxStoredAvatarBytes+1)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("oversized Put() error = %v, want invalid", err)
	}
}
