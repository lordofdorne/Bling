package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type fakeStore struct {
	createdUsername string
	createdEmail    string
	createdToken    []byte
	credentials     Credentials
	credentialsErr  error
	sessionToken    []byte
	currentUser     User
	currentErr      error
	deletedToken    []byte
}

func (f *fakeStore) CreateUserWithSession(_ context.Context, username, email, _ string, token []byte, _ time.Time) (User, error) {
	f.createdUsername, f.createdEmail, f.createdToken = username, email, token
	return User{ID: "user-1", Username: username, Email: email}, nil
}
func (f *fakeStore) CredentialsByEmail(context.Context, string) (Credentials, error) {
	return f.credentials, f.credentialsErr
}
func (f *fakeStore) CreateSession(_ context.Context, _ string, token []byte, _ time.Time) error {
	f.sessionToken = token
	return nil
}
func (f *fakeStore) UserBySession(_ context.Context, token []byte, _ time.Time) (User, error) {
	f.sessionToken = token
	return f.currentUser, f.currentErr
}
func (f *fakeStore) DeleteSession(_ context.Context, token []byte) error {
	f.deletedToken = token
	return nil
}

func testService(store Store) *Service {
	service := NewService(store, bcrypt.MinCost, time.Hour)
	service.randomToken = func() (string, error) { return "raw-secret-token", nil }
	service.now = func() time.Time { return time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC) }
	return service
}

func TestRegisterNormalizesIdentityAndHashesSecrets(t *testing.T) {
	store := &fakeStore{}
	service := testService(store)

	user, token, err := service.Register(context.Background(), RegisterInput{
		Username: "  Alice_1 ", Email: " Alice@Example.COM ", Password: "long-enough-password",
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if user.Username != "alice_1" || store.createdEmail != "alice@example.com" {
		t.Fatalf("identity was not normalized: user=%+v email=%q", user, store.createdEmail)
	}
	if token != "raw-secret-token" {
		t.Fatalf("unexpected raw token %q", token)
	}
	if string(store.createdToken) == token || string(store.createdToken) != string(HashToken(token)) {
		t.Fatal("store did not receive the token hash")
	}
}

func TestRegisterValidation(t *testing.T) {
	tests := []struct {
		name  string
		input RegisterInput
		want  error
	}{
		{"username", RegisterInput{"No Spaces", "a@example.com", "long-enough-password"}, ErrInvalidUsername},
		{"email", RegisterInput{"alice", "not-email", "long-enough-password"}, ErrInvalidEmail},
		{"password", RegisterInput{"alice", "a@example.com", "short"}, ErrInvalidPassword},
		{"bcrypt password limit", RegisterInput{"alice", "a@example.com", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, ErrInvalidPassword},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := testService(&fakeStore{}).Register(context.Background(), test.input)
			if !errors.Is(err, test.want) {
				t.Fatalf("Register() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestLoginCreatesHashedSession(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeStore{credentials: Credentials{User: User{ID: "user-1"}, PasswordHash: string(passwordHash)}}
	user, token, err := testService(store).Login(context.Background(), "a@example.com", "correct-password")
	if err != nil || user.ID != "user-1" || token == "" {
		t.Fatalf("Login() = user=%+v token=%q err=%v", user, token, err)
	}
	if string(store.sessionToken) != string(HashToken(token)) {
		t.Fatal("session token was not hashed")
	}
}

func TestLoginUsesGenericCredentialFailure(t *testing.T) {
	service := testService(&fakeStore{credentialsErr: ErrInvalidCredentials})
	_, _, err := service.Login(context.Background(), "missing@example.com", "guess")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("Login() error = %v", err)
	}
}

func TestCurrentUserAndLogoutHashCookieToken(t *testing.T) {
	store := &fakeStore{currentUser: User{ID: "user-1"}}
	service := testService(store)
	if _, err := service.CurrentUser(context.Background(), "cookie-token"); err != nil {
		t.Fatal(err)
	}
	if string(store.sessionToken) != string(HashToken("cookie-token")) {
		t.Fatal("current user lookup received raw token")
	}
	if err := service.Logout(context.Background(), "cookie-token"); err != nil {
		t.Fatal(err)
	}
	if string(store.deletedToken) != string(HashToken("cookie-token")) {
		t.Fatal("logout received raw token")
	}
}
