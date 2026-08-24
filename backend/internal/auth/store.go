package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) CreateUserWithSession(ctx context.Context, username, email, passwordHash string, tokenHash []byte, expiresAt time.Time) (User, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return User{}, fmt.Errorf("begin registration: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var user User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id, username, email, created_at`, username, email, passwordHash).
		Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if err != nil {
		return User{}, registrationError(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, user.ID, tokenHash, expiresAt); err != nil {
		return User{}, fmt.Errorf("create registration session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, fmt.Errorf("commit registration: %w", err)
	}
	return user, nil
}

func (s *PostgresStore) CredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	var credentials Credentials
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, email, created_at, password_hash
		FROM users WHERE lower(email) = lower($1)`, email).
		Scan(&credentials.ID, &credentials.Username, &credentials.Email, &credentials.CreatedAt, &credentials.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Credentials{}, ErrInvalidCredentials
	}
	if err != nil {
		return Credentials{}, fmt.Errorf("find credentials: %w", err)
	}
	return credentials, nil
}

func (s *PostgresStore) CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expiresAt)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func (s *PostgresStore) UserBySession(ctx context.Context, tokenHash []byte, now time.Time) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.username, u.email, u.created_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > $2`, tokenHash, now).
		Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidSession
	}
	if err != nil {
		return User{}, fmt.Errorf("find session: %w", err)
	}
	return user, nil
}

func (s *PostgresStore) DeleteSession(ctx context.Context, tokenHash []byte) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func registrationError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		switch postgresError.ConstraintName {
		case "users_username_unique":
			return ErrUsernameTaken
		case "users_email_unique":
			return ErrEmailTaken
		}
	}
	return fmt.Errorf("create user: %w", err)
}
