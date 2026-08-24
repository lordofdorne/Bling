package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInvalidSession     = errors.New("invalid session")
	ErrUsernameTaken      = errors.New("username already taken")
	ErrEmailTaken         = errors.New("email already taken")
	ErrInvalidUsername    = errors.New("username must be 3-30 lowercase letters, numbers, or underscores")
	ErrInvalidEmail       = errors.New("email address is invalid")
	ErrInvalidPassword    = errors.New("password must be 12-72 characters")
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,30}$`)

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

type Credentials struct {
	User
	PasswordHash string
}

type RegisterInput struct {
	Username string
	Email    string
	Password string
}

type Store interface {
	CreateUserWithSession(context.Context, string, string, string, []byte, time.Time) (User, error)
	CredentialsByEmail(context.Context, string) (Credentials, error)
	CreateSession(context.Context, string, []byte, time.Time) error
	UserBySession(context.Context, []byte, time.Time) (User, error)
	DeleteSession(context.Context, []byte) error
}

type Service struct {
	store       Store
	bcryptCost  int
	sessionTTL  time.Duration
	dummyHash   []byte
	now         func() time.Time
	randomToken func() (string, error)
}

func NewService(store Store, bcryptCost int, sessionTTL time.Duration) *Service {
	dummyHash, _ := bcrypt.GenerateFromPassword([]byte("invalid-credential-padding"), bcryptCost)
	return &Service{store: store, bcryptCost: bcryptCost, sessionTTL: sessionTTL, dummyHash: dummyHash, now: time.Now, randomToken: secureToken}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (User, string, error) {
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if err := validate(input); err != nil {
		return User{}, "", err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), s.bcryptCost)
	if err != nil {
		return User{}, "", fmt.Errorf("hash password: %w", err)
	}
	token, err := s.randomToken()
	if err != nil {
		return User{}, "", fmt.Errorf("generate session token: %w", err)
	}

	user, err := s.store.CreateUserWithSession(ctx, input.Username, input.Email, string(passwordHash), HashToken(token), s.now().Add(s.sessionTTL))
	if err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	credentials, err := s.store.CredentialsByEmail(ctx, email)
	if errors.Is(err, ErrInvalidCredentials) {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(password))
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(credentials.PasswordHash), []byte(password)) != nil {
		return User{}, "", ErrInvalidCredentials
	}

	token, err := s.randomToken()
	if err != nil {
		return User{}, "", fmt.Errorf("generate session token: %w", err)
	}
	if err := s.store.CreateSession(ctx, credentials.ID, HashToken(token), s.now().Add(s.sessionTTL)); err != nil {
		return User{}, "", err
	}
	return credentials.User, token, nil
}

func (s *Service) CurrentUser(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrInvalidSession
	}
	return s.store.UserBySession(ctx, HashToken(token), s.now())
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.store.DeleteSession(ctx, HashToken(token))
}

func HashToken(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func validate(input RegisterInput) error {
	if !usernamePattern.MatchString(input.Username) {
		return ErrInvalidUsername
	}
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 {
		return ErrInvalidEmail
	}
	if len(input.Password) < 12 || len(input.Password) > 72 {
		return ErrInvalidPassword
	}
	return nil
}

func secureToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
