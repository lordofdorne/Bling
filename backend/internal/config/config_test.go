package config

import "testing"

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
