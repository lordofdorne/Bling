package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProviderSession struct {
	User                    User
	EncryptedRefreshToken   string
	ProviderAccessExpiresAt time.Time
	ProviderValidatedAt     time.Time
	ExpiresAt               time.Time
}

type RecoveryGrant struct {
	UserID               string
	EncryptedAccessToken string
}

type ProviderSessionStore interface {
	CreateProviderUser(context.Context, Identity, string) (User, error)
	UserByProviderID(context.Context, string) (User, error)
	CreateProviderSession(context.Context, string, []byte, string, time.Time, time.Time, time.Time) error
	ProviderSessionByToken(context.Context, []byte, time.Time) (ProviderSession, error)
	RotateProviderSession(context.Context, []byte, string, string, time.Time, time.Time) (bool, error)
	RevokeProviderSession(context.Context, []byte, time.Time) error
	RevokeUserSessions(context.Context, string, time.Time) error
	CreateRecoveryGrant(context.Context, string, []byte, string, time.Time) error
	ClaimRecoveryGrant(context.Context, []byte, time.Time) (RecoveryGrant, error)
}

type PostgresProviderSessionStore struct{ pool *pgxpool.Pool }

func NewPostgresProviderSessionStore(pool *pgxpool.Pool) *PostgresProviderSessionStore {
	return &PostgresProviderSessionStore{pool: pool}
}

func (s *PostgresProviderSessionStore) CreateProviderUser(ctx context.Context, identity Identity, username string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (id, username, email, password_hash, auth_provider, provider_user_id)
		VALUES ($1, $2, $3, NULL, 'supabase', $1)
		RETURNING id, username, email, created_at`, identity.ID, username, identity.Email).
		Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if err != nil {
		return User{}, registrationError(err)
	}
	return user, nil
}

func (s *PostgresProviderSessionStore) UserByProviderID(ctx context.Context, providerID string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, email, created_at
		FROM users
		WHERE auth_provider = 'supabase' AND provider_user_id = $1`, providerID).
		Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("find provider user: %w", err)
	}
	return user, nil
}

func (s *PostgresProviderSessionStore) CreateProviderSession(ctx context.Context, userID string, tokenHash []byte, encryptedRefreshToken string, providerExpiresAt, validatedAt, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (
			user_id, token_hash, encrypted_refresh_token,
			provider_access_expires_at, provider_validated_at, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, tokenHash, encryptedRefreshToken, providerExpiresAt, validatedAt, expiresAt)
	if err != nil {
		return fmt.Errorf("create provider session: %w", err)
	}
	return nil
}

func (s *PostgresProviderSessionStore) ProviderSessionByToken(ctx context.Context, tokenHash []byte, now time.Time) (ProviderSession, error) {
	var session ProviderSession
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.username, u.email, u.created_at,
		       s.encrypted_refresh_token, s.provider_access_expires_at,
		       s.provider_validated_at, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.expires_at > $2
		  AND s.revoked_at IS NULL
		  AND s.encrypted_refresh_token IS NOT NULL`, tokenHash, now).
		Scan(
			&session.User.ID, &session.User.Username, &session.User.Email, &session.User.CreatedAt,
			&session.EncryptedRefreshToken, &session.ProviderAccessExpiresAt,
			&session.ProviderValidatedAt, &session.ExpiresAt,
		)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProviderSession{}, ErrInvalidSession
	}
	if err != nil {
		return ProviderSession{}, fmt.Errorf("find provider session: %w", err)
	}
	return session, nil
}

func (s *PostgresProviderSessionStore) RotateProviderSession(ctx context.Context, tokenHash []byte, previousEncryptedToken, nextEncryptedToken string, providerExpiresAt, validatedAt time.Time) (bool, error) {
	result, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET encrypted_refresh_token = $3,
		    provider_access_expires_at = $4,
		    provider_validated_at = $5,
		    last_seen_at = $5
		WHERE token_hash = $1
		  AND encrypted_refresh_token = $2
		  AND revoked_at IS NULL`,
		tokenHash, previousEncryptedToken, nextEncryptedToken, providerExpiresAt, validatedAt)
	if err != nil {
		return false, fmt.Errorf("rotate provider session: %w", err)
	}
	return result.RowsAffected() == 1, nil
}

func (s *PostgresProviderSessionStore) RevokeProviderSession(ctx context.Context, tokenHash []byte, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, $2)
		WHERE token_hash = $1`, tokenHash, now)
	if err != nil {
		return fmt.Errorf("revoke provider session: %w", err)
	}
	return nil
}

func (s *PostgresProviderSessionStore) RevokeUserSessions(ctx context.Context, userID string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, $2)
		WHERE user_id = $1`, userID, now)
	if err != nil {
		return fmt.Errorf("revoke user sessions: %w", err)
	}
	return nil
}

func (s *PostgresProviderSessionStore) CreateRecoveryGrant(ctx context.Context, userID string, tokenHash []byte, encryptedAccessToken string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO auth_recovery_grants (user_id, token_hash, encrypted_access_token, expires_at)
		VALUES ($1, $2, $3, $4)`, userID, tokenHash, encryptedAccessToken, expiresAt)
	if err != nil {
		return fmt.Errorf("create recovery grant: %w", err)
	}
	return nil
}

func (s *PostgresProviderSessionStore) ClaimRecoveryGrant(ctx context.Context, tokenHash []byte, now time.Time) (RecoveryGrant, error) {
	var grant RecoveryGrant
	err := s.pool.QueryRow(ctx, `
		UPDATE auth_recovery_grants
		SET used_at = $2
		WHERE token_hash = $1
		  AND used_at IS NULL
		  AND expires_at > $2
		RETURNING user_id, encrypted_access_token`, tokenHash, now).
		Scan(&grant.UserID, &grant.EncryptedAccessToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return RecoveryGrant{}, ErrInvalidIdentityToken
	}
	if err != nil {
		return RecoveryGrant{}, fmt.Errorf("claim recovery grant: %w", err)
	}
	return grant, nil
}
