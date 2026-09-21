package auth

import (
	"context"
	"errors"
	"time"
)

var (
	ErrEmailUnconfirmed     = errors.New("email address is not confirmed")
	ErrInvalidIdentityToken = errors.New("identity token is invalid or expired")
	ErrProviderRateLimited  = errors.New("identity provider rate limit exceeded")
	ErrIdentityProvider     = errors.New("identity provider unavailable")
)

type Identity struct {
	ID               string
	Email            string
	EmailConfirmedAt *time.Time
}

type IdentityTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

func (t IdentityTokens) Empty() bool {
	return t.AccessToken == "" && t.RefreshToken == ""
}

// IdentityProvider isolates Bling's application auth from any provider-specific
// request and response formats. Provider credentials and tokens must remain in Go.
type IdentityProvider interface {
	SignUp(context.Context, string, string, string) (Identity, IdentityTokens, error)
	SignInWithPassword(context.Context, string, string) (Identity, IdentityTokens, error)
	Refresh(context.Context, string) (Identity, IdentityTokens, error)
	VerifyEmailOTP(context.Context, string) (Identity, IdentityTokens, error)
	VerifyRecoveryOTP(context.Context, string) (Identity, IdentityTokens, error)
	ResendEmailConfirmation(context.Context, string, string) error
	SendPasswordReset(context.Context, string, string) error
	UpdatePassword(context.Context, string, string) error
	SignOut(context.Context, string) error
	DeleteUser(context.Context, string) error
}
