package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	providerRefreshLeeway = time.Minute
	recoveryGrantTTL      = 15 * time.Minute
)

type ProviderService struct {
	store            ProviderSessionStore
	provider         IdentityProvider
	cipher           *TokenCipher
	sessionTTL       time.Duration
	confirmURL       string
	passwordResetURL string
	now              func() time.Time
	randomToken      func() (string, error)
}

func NewProviderService(store ProviderSessionStore, provider IdentityProvider, cipher *TokenCipher, sessionTTL time.Duration, confirmURL, passwordResetURL string) (*ProviderService, error) {
	if store == nil || provider == nil || cipher == nil {
		return nil, errors.New("provider auth dependencies are required")
	}
	if sessionTTL <= 0 {
		return nil, errors.New("provider session TTL must be positive")
	}
	if strings.TrimSpace(confirmURL) == "" || strings.TrimSpace(passwordResetURL) == "" {
		return nil, errors.New("provider auth callback URLs are required")
	}
	return &ProviderService{
		store: store, provider: provider, cipher: cipher, sessionTTL: sessionTTL,
		confirmURL: confirmURL, passwordResetURL: passwordResetURL,
		now: time.Now, randomToken: secureToken,
	}, nil
}

func (s *ProviderService) Register(ctx context.Context, input RegisterInput) (User, string, error) {
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if err := validate(input); err != nil {
		return User{}, "", err
	}

	identity, tokens, err := s.provider.SignUp(ctx, input.Email, input.Password, s.confirmURL)
	if err != nil {
		return User{}, "", err
	}
	user, err := s.store.CreateProviderUser(ctx, identity, input.Username)
	if err != nil {
		if cleanupErr := s.provider.DeleteUser(ctx, identity.ID); cleanupErr != nil {
			return User{}, "", errors.Join(err, fmt.Errorf("compensating identity deletion failed: %w", cleanupErr))
		}
		return User{}, "", err
	}
	if tokens.Empty() {
		return user, "", nil
	}
	token, err := s.createSession(ctx, user.ID, tokens)
	if err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

func (s *ProviderService) Login(ctx context.Context, email, password string) (User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if err := validateEmail(email); err != nil {
		return User{}, "", ErrInvalidCredentials
	}
	identity, tokens, err := s.provider.SignInWithPassword(ctx, email, password)
	if err != nil {
		return User{}, "", err
	}
	if identity.EmailConfirmedAt == nil {
		return User{}, "", ErrEmailUnconfirmed
	}
	user, err := s.store.UserByProviderID(ctx, identity.ID)
	if err != nil {
		return User{}, "", err
	}
	token, err := s.createSession(ctx, user.ID, tokens)
	if err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

func (s *ProviderService) CurrentUser(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrInvalidSession
	}
	tokenHash := HashToken(token)
	now := s.now().UTC()
	session, err := s.store.ProviderSessionByToken(ctx, tokenHash, now)
	if err != nil {
		return User{}, err
	}
	if session.ProviderAccessExpiresAt.After(now.Add(providerRefreshLeeway)) {
		return session.User, nil
	}

	refreshToken, err := s.cipher.Open(session.EncryptedRefreshToken)
	if err != nil {
		_ = s.store.RevokeProviderSession(ctx, tokenHash, now)
		return User{}, ErrInvalidSession
	}
	identity, tokens, err := s.provider.Refresh(ctx, refreshToken)
	if err != nil {
		if errors.Is(err, ErrInvalidIdentityToken) || errors.Is(err, ErrInvalidCredentials) {
			_ = s.store.RevokeProviderSession(ctx, tokenHash, now)
			return User{}, ErrInvalidSession
		}
		return User{}, err
	}
	if identity.ID != session.User.ID {
		_ = s.store.RevokeProviderSession(ctx, tokenHash, now)
		return User{}, ErrInvalidSession
	}
	nextEncrypted, err := s.encryptRefreshToken(tokens)
	if err != nil {
		return User{}, err
	}
	rotated, err := s.store.RotateProviderSession(
		ctx, tokenHash, session.EncryptedRefreshToken, nextEncrypted, tokens.ExpiresAt, now,
	)
	if err != nil {
		return User{}, err
	}
	if !rotated {
		current, err := s.store.ProviderSessionByToken(ctx, tokenHash, now)
		if err != nil {
			return User{}, err
		}
		return current.User, nil
	}
	return session.User, nil
}

func (s *ProviderService) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	tokenHash := HashToken(token)
	now := s.now().UTC()
	session, lookupErr := s.store.ProviderSessionByToken(ctx, tokenHash, now)
	if lookupErr == nil {
		if refreshToken, err := s.cipher.Open(session.EncryptedRefreshToken); err == nil {
			_, tokens, err := s.provider.Refresh(ctx, refreshToken)
			if err == nil && tokens.AccessToken != "" {
				_ = s.provider.SignOut(ctx, tokens.AccessToken)
			}
		}
	} else if !errors.Is(lookupErr, ErrInvalidSession) {
		return lookupErr
	}
	return s.store.RevokeProviderSession(ctx, tokenHash, now)
}

func (s *ProviderService) ConfirmEmail(ctx context.Context, tokenHash string) (User, string, error) {
	if strings.TrimSpace(tokenHash) == "" {
		return User{}, "", ErrInvalidIdentityToken
	}
	identity, tokens, err := s.provider.VerifyEmailOTP(ctx, tokenHash)
	if err != nil {
		return User{}, "", err
	}
	user, err := s.store.UserByProviderID(ctx, identity.ID)
	if err != nil {
		return User{}, "", err
	}
	token, err := s.createSession(ctx, user.ID, tokens)
	if err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

func (s *ProviderService) ResendConfirmation(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if err := validateEmail(email); err != nil {
		return err
	}
	return s.provider.ResendEmailConfirmation(ctx, email, s.confirmURL)
}

func (s *ProviderService) ForgotPassword(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if err := validateEmail(email); err != nil {
		return err
	}
	return s.provider.SendPasswordReset(ctx, email, s.passwordResetURL)
}

func (s *ProviderService) BeginPasswordReset(ctx context.Context, tokenHash string) (string, error) {
	if strings.TrimSpace(tokenHash) == "" {
		return "", ErrInvalidIdentityToken
	}
	identity, tokens, err := s.provider.VerifyRecoveryOTP(ctx, tokenHash)
	if err != nil {
		return "", err
	}
	if tokens.AccessToken == "" {
		return "", ErrInvalidIdentityToken
	}
	user, err := s.store.UserByProviderID(ctx, identity.ID)
	if err != nil {
		return "", err
	}
	encryptedAccess, err := s.cipher.Seal(tokens.AccessToken)
	if err != nil {
		return "", fmt.Errorf("encrypt recovery access token: %w", err)
	}
	grantToken, err := s.randomToken()
	if err != nil {
		return "", fmt.Errorf("generate recovery grant: %w", err)
	}
	now := s.now().UTC()
	if err := s.store.CreateRecoveryGrant(ctx, user.ID, HashToken(grantToken), encryptedAccess, now.Add(recoveryGrantTTL)); err != nil {
		return "", err
	}
	return grantToken, nil
}

func (s *ProviderService) ResetPassword(ctx context.Context, grantToken, password string) error {
	if grantToken == "" {
		return ErrInvalidIdentityToken
	}
	if err := validatePassword(password); err != nil {
		return err
	}
	now := s.now().UTC()
	grant, err := s.store.ClaimRecoveryGrant(ctx, HashToken(grantToken), now)
	if err != nil {
		return err
	}
	accessToken, err := s.cipher.Open(grant.EncryptedAccessToken)
	if err != nil {
		return ErrInvalidIdentityToken
	}
	if err := s.provider.UpdatePassword(ctx, accessToken, password); err != nil {
		return err
	}
	if err := s.store.RevokeUserSessions(ctx, grant.UserID, now); err != nil {
		return err
	}
	_ = s.provider.SignOut(ctx, accessToken)
	return nil
}

func (s *ProviderService) createSession(ctx context.Context, userID string, tokens IdentityTokens) (string, error) {
	encryptedRefresh, err := s.encryptRefreshToken(tokens)
	if err != nil {
		return "", err
	}
	token, err := s.randomToken()
	if err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	now := s.now().UTC()
	if err := s.store.CreateProviderSession(
		ctx, userID, HashToken(token), encryptedRefresh, tokens.ExpiresAt, now, now.Add(s.sessionTTL),
	); err != nil {
		return "", err
	}
	return token, nil
}

func (s *ProviderService) encryptRefreshToken(tokens IdentityTokens) (string, error) {
	if tokens.RefreshToken == "" || tokens.ExpiresAt.IsZero() {
		return "", ErrIdentityProvider
	}
	encrypted, err := s.cipher.Seal(tokens.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("encrypt refresh token: %w", err)
	}
	return encrypted, nil
}
