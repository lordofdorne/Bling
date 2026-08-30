package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Environment             string
	HTTPAddr                string
	DatabaseURL             string
	RedisURL                string
	FrontendURL             string
	AllowedOrigins          []string
	CookieSecure            bool
	SessionTTL              time.Duration
	BcryptCost              int
	AuthRateLimitWindow     time.Duration
	RealtimeRateLimitWindow time.Duration
	RealtimeHeartbeat       time.Duration
	RealtimeWriteTimeout    time.Duration
	RealtimeConnectLimit    int
	RealtimeClientBuffer    int
	RealtimeMaxPerShow      int
	ShutdownTimeout         time.Duration
	ReadinessTimeout        time.Duration
	ReadHeaderTimeout       time.Duration
	ReadTimeout             time.Duration
	WriteTimeout            time.Duration
	IdleTimeout             time.Duration
	RTCICEServers           []ICEServer
	TURNURL                 string
	TURNSharedSecret        string
	TURNCredentialTTL       time.Duration
	CallPresenceTTL         time.Duration
	CallDisconnectGrace     time.Duration
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

func Load() (Config, error) {
	_ = godotenv.Load("../.env", ".env")

	cfg := Config{
		Environment:       envOrDefault("APP_ENV", "development"),
		HTTPAddr:          envOrDefault("HTTP_ADDR", ":8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		RedisURL:          os.Getenv("REDIS_URL"),
		FrontendURL:       envOrDefault("FRONTEND_URL", "http://localhost:5173"),
		AllowedOrigins:    splitCSV(envOrDefault("ALLOWED_ORIGINS", "http://localhost:5173")),
		CookieSecure:      strings.EqualFold(envOrDefault("COOKIE_SECURE", "false"), "true"),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	stunURLs := splitCSV(envOrDefault("STUN_URLS", "stun:stun.l.google.com:19302"))
	if len(stunURLs) == 0 {
		return Config{}, fmt.Errorf("STUN_URLS must contain at least one URL")
	}
	cfg.RTCICEServers = append(cfg.RTCICEServers, ICEServer{URLs: stunURLs})
	turnURL := strings.TrimSpace(os.Getenv("TURN_URL"))
	turnUsername := strings.TrimSpace(os.Getenv("TURN_USERNAME"))
	turnCredential := strings.TrimSpace(os.Getenv("TURN_CREDENTIAL"))
	turnSharedSecret := strings.TrimSpace(os.Getenv("TURN_SHARED_SECRET"))
	if turnURL != "" {
		if turnSharedSecret == "" && (turnUsername == "" || turnCredential == "") {
			return Config{}, fmt.Errorf("TURN_SHARED_SECRET or TURN_USERNAME and TURN_CREDENTIAL are required when TURN_URL is set")
		}
		cfg.TURNURL = turnURL
		cfg.TURNSharedSecret = turnSharedSecret
		if turnSharedSecret == "" {
			cfg.RTCICEServers = append(cfg.RTCICEServers, ICEServer{URLs: []string{turnURL}, Username: turnUsername, Credential: turnCredential})
		}
	}

	var err error
	if cfg.ShutdownTimeout, err = duration("SHUTDOWN_TIMEOUT", 10*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.ReadinessTimeout, err = duration("READINESS_TIMEOUT", 2*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.SessionTTL, err = duration("SESSION_TTL", 30*24*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.AuthRateLimitWindow, err = duration("AUTH_RATE_LIMIT_WINDOW", time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.RealtimeRateLimitWindow, err = duration("REALTIME_RATE_LIMIT_WINDOW", time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.RealtimeHeartbeat, err = duration("REALTIME_HEARTBEAT", 25*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.RealtimeWriteTimeout, err = duration("REALTIME_WRITE_TIMEOUT", 5*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.TURNCredentialTTL, err = duration("TURN_CREDENTIAL_TTL", 15*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.CallPresenceTTL, err = duration("CALL_PRESENCE_TTL", 45*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.CallDisconnectGrace, err = duration("CALL_DISCONNECT_GRACE", 20*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.CallPresenceTTL <= cfg.RealtimeHeartbeat {
		return Config{}, fmt.Errorf("CALL_PRESENCE_TTL must be greater than REALTIME_HEARTBEAT")
	}
	if cfg.RealtimeConnectLimit, err = positiveInteger("REALTIME_CONNECT_LIMIT", 60); err != nil {
		return Config{}, err
	}
	if cfg.RealtimeClientBuffer, err = positiveInteger("REALTIME_CLIENT_BUFFER", 16); err != nil {
		return Config{}, err
	}
	if cfg.RealtimeMaxPerShow, err = positiveInteger("REALTIME_MAX_PER_SHOW", 10000); err != nil {
		return Config{}, err
	}
	if cfg.BcryptCost, err = integer("BCRYPT_COST", 12); err != nil {
		return Config{}, err
	}
	if cfg.BcryptCost < 10 || cfg.BcryptCost > 15 {
		return Config{}, fmt.Errorf("BCRYPT_COST must be between 10 and 15")
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return Config{}, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.Environment == "production" && !cfg.CookieSecure {
		return Config{}, fmt.Errorf("COOKIE_SECURE must be true in production")
	}
	if cfg.Environment == "production" && turnURL == "" {
		return Config{}, fmt.Errorf("TURN_URL is required in production")
	}
	if cfg.Environment == "production" && turnSharedSecret == "" {
		return Config{}, fmt.Errorf("TURN_SHARED_SECRET is required in production")
	}

	return cfg, nil
}

func integer(key string, fallback int) (int, error) {
	value := envOrDefault(key, fmt.Sprintf("%d", fallback))
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func positiveInteger(key string, fallback int) (int, error) {
	value, err := integer(key, fallback)
	if err != nil {
		return 0, err
	}
	if value <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return value, nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func duration(key string, fallback time.Duration) (time.Duration, error) {
	value := envOrDefault(key, fallback.String())
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return parsed, nil
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
