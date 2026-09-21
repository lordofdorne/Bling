package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeIdentityProvider struct {
	signUpIdentity   Identity
	signUpTokens     IdentityTokens
	signUpErr        error
	signInIdentity   Identity
	signInTokens     IdentityTokens
	signInErr        error
	refreshIdentity  Identity
	refreshTokens    IdentityTokens
	refreshErr       error
	verifyIdentity   Identity
	verifyTokens     IdentityTokens
	verifyErr        error
	recoveryIdentity Identity
	recoveryTokens   IdentityTokens
	recoveryErr      error
	deletedUserID    string
	updatedAccess    string
	updatedPassword  string
	signedOutAccess  string
	resentEmail      string
	resetEmail       string
}

func (f *fakeIdentityProvider) SignUp(context.Context, string, string, string) (Identity, IdentityTokens, error) {
	return f.signUpIdentity, f.signUpTokens, f.signUpErr
}
func (f *fakeIdentityProvider) SignInWithPassword(context.Context, string, string) (Identity, IdentityTokens, error) {
	return f.signInIdentity, f.signInTokens, f.signInErr
}
func (f *fakeIdentityProvider) Refresh(context.Context, string) (Identity, IdentityTokens, error) {
	return f.refreshIdentity, f.refreshTokens, f.refreshErr
}
func (f *fakeIdentityProvider) VerifyEmailOTP(context.Context, string) (Identity, IdentityTokens, error) {
	return f.verifyIdentity, f.verifyTokens, f.verifyErr
}
func (f *fakeIdentityProvider) VerifyRecoveryOTP(context.Context, string) (Identity, IdentityTokens, error) {
	return f.recoveryIdentity, f.recoveryTokens, f.recoveryErr
}
func (f *fakeIdentityProvider) ResendEmailConfirmation(_ context.Context, email, _ string) error {
	f.resentEmail = email
	return nil
}
func (f *fakeIdentityProvider) SendPasswordReset(_ context.Context, email, _ string) error {
	f.resetEmail = email
	return nil
}
func (f *fakeIdentityProvider) UpdatePassword(_ context.Context, accessToken, password string) error {
	f.updatedAccess, f.updatedPassword = accessToken, password
	return nil
}
func (f *fakeIdentityProvider) SignOut(_ context.Context, accessToken string) error {
	f.signedOutAccess = accessToken
	return nil
}
func (f *fakeIdentityProvider) DeleteUser(_ context.Context, userID string) error {
	f.deletedUserID = userID
	return nil
}

type fakeProviderStore struct {
	createdIdentity        Identity
	createdUsername        string
	createUser             User
	createUserErr          error
	providerUser           User
	providerUserErr        error
	createdSessionUserID   string
	createdSessionHash     []byte
	createdSessionRefresh  string
	createdProviderExpiry  time.Time
	providerSession        ProviderSession
	providerSessionErr     error
	rotatedPrevious        string
	rotatedNext            string
	rotated                bool
	rotateErr              error
	revokedSessionHash     []byte
	revokedUserID          string
	recoveryUserID         string
	recoveryTokenHash      []byte
	recoveryEncryptedToken string
	recoveryGrant          RecoveryGrant
	recoveryGrantErr       error
}

func (f *fakeProviderStore) CreateProviderUser(_ context.Context, identity Identity, username string) (User, error) {
	f.createdIdentity, f.createdUsername = identity, username
	return f.createUser, f.createUserErr
}
func (f *fakeProviderStore) UserByProviderID(context.Context, string) (User, error) {
	return f.providerUser, f.providerUserErr
}
func (f *fakeProviderStore) CreateProviderSession(_ context.Context, userID string, hash []byte, encrypted string, providerExpiry, _ time.Time, _ time.Time) error {
	f.createdSessionUserID = userID
	f.createdSessionHash = append([]byte(nil), hash...)
	f.createdSessionRefresh = encrypted
	f.createdProviderExpiry = providerExpiry
	return nil
}
func (f *fakeProviderStore) ProviderSessionByToken(context.Context, []byte, time.Time) (ProviderSession, error) {
	return f.providerSession, f.providerSessionErr
}
func (f *fakeProviderStore) RotateProviderSession(_ context.Context, _ []byte, previous, next string, _ time.Time, _ time.Time) (bool, error) {
	f.rotatedPrevious, f.rotatedNext = previous, next
	return f.rotated, f.rotateErr
}
func (f *fakeProviderStore) RevokeProviderSession(_ context.Context, hash []byte, _ time.Time) error {
	f.revokedSessionHash = append([]byte(nil), hash...)
	return nil
}
func (f *fakeProviderStore) RevokeUserSessions(_ context.Context, userID string, _ time.Time) error {
	f.revokedUserID = userID
	return nil
}
func (f *fakeProviderStore) CreateRecoveryGrant(_ context.Context, userID string, hash []byte, encrypted string, _ time.Time) error {
	f.recoveryUserID = userID
	f.recoveryTokenHash = append([]byte(nil), hash...)
	f.recoveryEncryptedToken = encrypted
	return nil
}
func (f *fakeProviderStore) ClaimRecoveryGrant(context.Context, []byte, time.Time) (RecoveryGrant, error) {
	return f.recoveryGrant, f.recoveryGrantErr
}

func testProviderService(t *testing.T, store ProviderSessionStore, provider IdentityProvider) *ProviderService {
	t.Helper()
	cipher, err := NewTokenCipher("v1:" + encodedKey(1))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewProviderService(store, provider, cipher, time.Hour, "https://api.test/confirm", "https://api.test/reset")
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	service.randomToken = func() (string, error) { return "opaque-token", nil }
	return service
}

func TestProviderRegisterCreatesPendingApplicationUser(t *testing.T) {
	store := &fakeProviderStore{createUser: User{ID: "user-1", Username: "alice", Email: "alice@example.com"}}
	provider := &fakeIdentityProvider{signUpIdentity: Identity{ID: "user-1", Email: "alice@example.com"}}
	service := testProviderService(t, store, provider)

	user, token, err := service.Register(context.Background(), RegisterInput{
		Username: " Alice ", Email: " Alice@Example.com ", Password: "long-enough-password",
	})
	if err != nil || user.ID != "user-1" || token != "" {
		t.Fatalf("Register() = user=%+v token=%q err=%v", user, token, err)
	}
	if store.createdUsername != "alice" || store.createdIdentity.ID != "user-1" || store.createdSessionUserID != "" {
		t.Fatalf("unexpected registration state: %+v", store)
	}
}

func TestProviderRegisterCompensatesFailedApplicationInsert(t *testing.T) {
	store := &fakeProviderStore{createUserErr: ErrUsernameTaken}
	provider := &fakeIdentityProvider{signUpIdentity: Identity{ID: "orphan-1", Email: "alice@example.com"}}
	service := testProviderService(t, store, provider)

	_, _, err := service.Register(context.Background(), RegisterInput{
		Username: "alice", Email: "alice@example.com", Password: "long-enough-password",
	})
	if !errors.Is(err, ErrUsernameTaken) || provider.deletedUserID != "orphan-1" {
		t.Fatalf("Register() error=%v deleted=%q", err, provider.deletedUserID)
	}
}

func TestProviderLoginCreatesEncryptedOpaqueSession(t *testing.T) {
	confirmed := time.Date(2026, 9, 20, 11, 0, 0, 0, time.UTC)
	expires := time.Date(2026, 9, 20, 13, 0, 0, 0, time.UTC)
	store := &fakeProviderStore{providerUser: User{ID: "user-1"}}
	provider := &fakeIdentityProvider{
		signInIdentity: Identity{ID: "user-1", EmailConfirmedAt: &confirmed},
		signInTokens:   IdentityTokens{AccessToken: "access", RefreshToken: "refresh-secret", ExpiresAt: expires},
	}
	service := testProviderService(t, store, provider)

	_, token, err := service.Login(context.Background(), "alice@example.com", "long-enough-password")
	if err != nil || token != "opaque-token" {
		t.Fatalf("Login() token=%q err=%v", token, err)
	}
	if string(store.createdSessionHash) == token || store.createdSessionUserID != "user-1" {
		t.Fatal("application session did not hash its opaque token")
	}
	opened, err := service.cipher.Open(store.createdSessionRefresh)
	if err != nil || opened != "refresh-secret" {
		t.Fatalf("stored refresh token = %q, %v", opened, err)
	}
}

func TestProviderCurrentUserRefreshesAndRotatesSession(t *testing.T) {
	cipher, _ := NewTokenCipher("v1:" + encodedKey(1))
	oldEncrypted, _ := cipher.Seal("old-refresh")
	store := &fakeProviderStore{
		providerSession: ProviderSession{
			User: User{ID: "user-1"}, EncryptedRefreshToken: oldEncrypted,
			ProviderAccessExpiresAt: time.Date(2026, 9, 20, 12, 0, 10, 0, time.UTC),
		},
		rotated: true,
	}
	provider := &fakeIdentityProvider{
		refreshIdentity: Identity{ID: "user-1"},
		refreshTokens:   IdentityTokens{RefreshToken: "next-refresh", ExpiresAt: time.Date(2026, 9, 20, 13, 0, 0, 0, time.UTC)},
	}
	service := testProviderService(t, store, provider)

	user, err := service.CurrentUser(context.Background(), "opaque-token")
	if err != nil || user.ID != "user-1" || store.rotatedPrevious != oldEncrypted {
		t.Fatalf("CurrentUser() user=%+v err=%v", user, err)
	}
	opened, err := service.cipher.Open(store.rotatedNext)
	if err != nil || opened != "next-refresh" {
		t.Fatalf("rotated refresh token = %q, %v", opened, err)
	}
}

func TestProviderCurrentUserRevokesInvalidRefresh(t *testing.T) {
	cipher, _ := NewTokenCipher("v1:" + encodedKey(1))
	encrypted, _ := cipher.Seal("expired-refresh")
	store := &fakeProviderStore{providerSession: ProviderSession{
		User: User{ID: "user-1"}, EncryptedRefreshToken: encrypted,
		ProviderAccessExpiresAt: time.Date(2026, 9, 20, 11, 0, 0, 0, time.UTC),
	}}
	provider := &fakeIdentityProvider{refreshErr: ErrInvalidIdentityToken}
	service := testProviderService(t, store, provider)

	_, err := service.CurrentUser(context.Background(), "opaque-token")
	if !errors.Is(err, ErrInvalidSession) || len(store.revokedSessionHash) == 0 {
		t.Fatalf("CurrentUser() error=%v revoked=%x", err, store.revokedSessionHash)
	}
}

func TestProviderPasswordResetUsesOneTimeServerGrant(t *testing.T) {
	store := &fakeProviderStore{providerUser: User{ID: "user-1"}}
	provider := &fakeIdentityProvider{
		recoveryIdentity: Identity{ID: "user-1"},
		recoveryTokens:   IdentityTokens{AccessToken: "recovery-access"},
	}
	service := testProviderService(t, store, provider)

	grantToken, err := service.BeginPasswordReset(context.Background(), "email-token-hash")
	if err != nil || grantToken != "opaque-token" || store.recoveryUserID != "user-1" {
		t.Fatalf("BeginPasswordReset() grant=%q err=%v", grantToken, err)
	}
	store.recoveryGrant = RecoveryGrant{UserID: "user-1", EncryptedAccessToken: store.recoveryEncryptedToken}
	if err := service.ResetPassword(context.Background(), grantToken, "a-new-long-password"); err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}
	if provider.updatedAccess != "recovery-access" || provider.updatedPassword != "a-new-long-password" || store.revokedUserID != "user-1" {
		t.Fatalf("unexpected reset state provider=%+v store=%+v", provider, store)
	}
}
