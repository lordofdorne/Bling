package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestLoadRequiresDependencyURLs(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected missing dependency configuration to fail")
	}
}

func TestLoadParsesValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("ALLOWED_ORIGINS", "https://one.example, https://two.example")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("READINESS_TIMEOUT", "750ms")
	t.Setenv("STUN_URLS", "stun:one.example, stun:two.example")
	t.Setenv("TURN_URL", "turn:relay.example")
	t.Setenv("TURN_USERNAME", "user")
	t.Setenv("TURN_CREDENTIAL", "secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.CookieSecure || cfg.ReadinessTimeout.Milliseconds() != 750 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("expected two origins, got %v", cfg.AllowedOrigins)
	}
	if len(cfg.RTCICEServers) != 2 || len(cfg.RTCICEServers[0].URLs) != 2 || cfg.RTCICEServers[1].Credential != "secret" {
		t.Fatalf("unexpected ICE servers: %+v", cfg.RTCICEServers)
	}
}

func TestLoadRejectsIncompleteTURNConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("TURN_URL", "turn:relay.example")
	t.Setenv("TURN_USERNAME", "")
	t.Setenv("TURN_CREDENTIAL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected incomplete TURN credentials to fail configuration")
	}
}

func TestLoadRequiresTURNInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("TURN_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected production without TURN to fail configuration")
	}
}

func TestLoadRequiresEphemeralTURNInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("TURN_URL", "turn:relay.example")
	t.Setenv("TURN_USERNAME", "static-user")
	t.Setenv("TURN_CREDENTIAL", "static-secret")
	t.Setenv("TURN_SHARED_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected production static TURN credentials to fail configuration")
	}
}

func TestLoadRequiresSecureProductionCookies(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("APP_ENV", "production")
	t.Setenv("COOKIE_SECURE", "false")

	_, err := Load()
	if err == nil {
		t.Fatal("expected insecure production cookies to fail configuration")
	}
}

func TestLoadRejectsUnboundedRealtimeConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("REALTIME_MAX_PER_SHOW", "0")
	if _, err := Load(); err == nil {
		t.Fatal("expected zero realtime room capacity to fail configuration")
	}
}

func TestLoadRejectsPartialStripeConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_example")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected incomplete Stripe keys to fail configuration")
	}
}

func TestLoadRejectsInvalidStripeConnectCountry(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("STRIPE_CONNECT_COUNTRY", "USA")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid Stripe Connect country to fail configuration")
	}
}

func TestLoadParsesSupabaseConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("SUPABASE_ENABLED", "true")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co/")
	t.Setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
	t.Setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
	t.Setenv("SUPABASE_STORAGE_BUCKET", "profile-avatars")
	t.Setenv("SUPABASE_STORAGE_SERVICE_KEY", "header.payload.signature")
	t.Setenv("SESSION_ENCRYPTION_KEYS", "v1:"+base64.RawURLEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("AUTH_EMAIL_CONFIRM_URL", "https://api.bling.test/api/v1/auth/confirm")
	t.Setenv("AUTH_PASSWORD_RESET_URL", "https://api.bling.test/api/v1/auth/reset")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.SupabaseEnabled || cfg.SupabaseURL != "https://project.supabase.co" {
		t.Fatalf("unexpected Supabase config: %+v", cfg)
	}
}

func TestLoadRequiresCompleteSupabaseConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("SUPABASE_ENABLED", "true")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "required when SUPABASE_ENABLED") {
		t.Fatalf("Load() error = %v", err)
	}
}

func TestLoadRejectsInvalidSessionEncryptionKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://example")
	t.Setenv("SUPABASE_ENABLED", "true")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")
	t.Setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
	t.Setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
	t.Setenv("SUPABASE_STORAGE_BUCKET", "profile-avatars")
	t.Setenv("SUPABASE_STORAGE_SERVICE_KEY", "header.payload.signature")
	t.Setenv("SESSION_ENCRYPTION_KEYS", "v1:not-a-key")
	t.Setenv("AUTH_EMAIL_CONFIRM_URL", "https://api.bling.test/api/v1/auth/confirm")
	t.Setenv("AUTH_PASSWORD_RESET_URL", "https://api.bling.test/api/v1/auth/reset")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "32-byte key") {
		t.Fatalf("Load() error = %v", err)
	}
}
