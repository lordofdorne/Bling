package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxIdentityResponseBytes = 1 << 20

type SupabaseIdentityProvider struct {
	baseURL        string
	publishableKey string
	secretKey      string
	client         *http.Client
	now            func() time.Time
}

type supabaseUser struct {
	ID               string     `json:"id"`
	Email            string     `json:"email"`
	EmailConfirmedAt *time.Time `json:"email_confirmed_at"`
	Identities       []any      `json:"identities"`
}

type supabaseSessionResponse struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresIn    int64         `json:"expires_in"`
	ExpiresAt    int64         `json:"expires_at"`
	User         *supabaseUser `json:"user"`
	// With email confirmation enabled, GoTrue returns the newly created user
	// directly instead of wrapping it in an access-token response.
	ID               string     `json:"id"`
	Email            string     `json:"email"`
	EmailConfirmedAt *time.Time `json:"email_confirmed_at"`
	Identities       []any      `json:"identities"`
}

type supabaseErrorResponse struct {
	Code      string `json:"code"`
	ErrorCode string `json:"error_code"`
}

func NewSupabaseIdentityProvider(baseURL, publishableKey, secretKey string, timeout time.Duration) (*SupabaseIdentityProvider, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.ParseRequestURI(baseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("supabase URL must be an absolute HTTP URL")
	}
	if strings.TrimSpace(publishableKey) == "" {
		return nil, errors.New("supabase publishable key is required")
	}
	if timeout <= 0 {
		return nil, errors.New("supabase HTTP timeout must be positive")
	}
	return &SupabaseIdentityProvider{
		baseURL:        baseURL,
		publishableKey: strings.TrimSpace(publishableKey),
		secretKey:      strings.TrimSpace(secretKey),
		client:         &http.Client{Timeout: timeout},
		now:            time.Now,
	}, nil
}

func (p *SupabaseIdentityProvider) SignUp(ctx context.Context, email, password, redirectURL string) (Identity, IdentityTokens, error) {
	path := "/auth/v1/signup"
	if redirectURL != "" {
		path += "?redirect_to=" + url.QueryEscape(redirectURL)
	}
	var response supabaseSessionResponse
	err := p.request(ctx, http.MethodPost, path, p.publishableKey, "", map[string]string{
		"email": email, "password": password,
	}, &response)
	identity, tokens, err := p.identityResponse(response, err)
	user := response.identityUser()
	if err == nil && user != nil && user.Identities != nil && len(user.Identities) == 0 {
		return Identity{}, IdentityTokens{}, ErrEmailTaken
	}
	return identity, tokens, err
}

func (p *SupabaseIdentityProvider) SignInWithPassword(ctx context.Context, email, password string) (Identity, IdentityTokens, error) {
	var response supabaseSessionResponse
	err := p.request(ctx, http.MethodPost, "/auth/v1/token?grant_type=password", p.publishableKey, "", map[string]string{
		"email": email, "password": password,
	}, &response)
	return p.identityResponse(response, err)
}

func (p *SupabaseIdentityProvider) Refresh(ctx context.Context, refreshToken string) (Identity, IdentityTokens, error) {
	var response supabaseSessionResponse
	err := p.request(ctx, http.MethodPost, "/auth/v1/token?grant_type=refresh_token", p.publishableKey, "", map[string]string{
		"refresh_token": refreshToken,
	}, &response)
	return p.identityResponse(response, err)
}

func (p *SupabaseIdentityProvider) VerifyEmailOTP(ctx context.Context, tokenHash string) (Identity, IdentityTokens, error) {
	return p.verifyOTP(ctx, tokenHash, "email")
}

func (p *SupabaseIdentityProvider) VerifyRecoveryOTP(ctx context.Context, tokenHash string) (Identity, IdentityTokens, error) {
	return p.verifyOTP(ctx, tokenHash, "recovery")
}

func (p *SupabaseIdentityProvider) verifyOTP(ctx context.Context, tokenHash, tokenType string) (Identity, IdentityTokens, error) {
	var response supabaseSessionResponse
	err := p.request(ctx, http.MethodPost, "/auth/v1/verify", p.publishableKey, "", map[string]string{
		"token_hash": tokenHash, "type": tokenType,
	}, &response)
	return p.identityResponse(response, err)
}

func (p *SupabaseIdentityProvider) ResendEmailConfirmation(ctx context.Context, email, redirectURL string) error {
	payload := map[string]any{"type": "signup", "email": email}
	if redirectURL != "" {
		payload["options"] = map[string]string{"email_redirect_to": redirectURL}
	}
	return p.request(ctx, http.MethodPost, "/auth/v1/resend", p.publishableKey, "", payload, nil)
}

func (p *SupabaseIdentityProvider) SendPasswordReset(ctx context.Context, email, redirectURL string) error {
	path := "/auth/v1/recover"
	if redirectURL != "" {
		path += "?redirect_to=" + url.QueryEscape(redirectURL)
	}
	return p.request(ctx, http.MethodPost, path, p.publishableKey, "", map[string]string{"email": email}, nil)
}

func (p *SupabaseIdentityProvider) UpdatePassword(ctx context.Context, accessToken, password string) error {
	return p.request(ctx, http.MethodPut, "/auth/v1/user", p.publishableKey, accessToken, map[string]string{"password": password}, nil)
}

func (p *SupabaseIdentityProvider) SignOut(ctx context.Context, accessToken string) error {
	return p.request(ctx, http.MethodPost, "/auth/v1/logout", p.publishableKey, accessToken, nil, nil)
}

func (p *SupabaseIdentityProvider) DeleteUser(ctx context.Context, userID string) error {
	if p.secretKey == "" {
		return errors.New("supabase secret key is required for user deletion")
	}
	// Current sb_secret keys belong only in the apikey header. Legacy JWT-based
	// service_role keys also need to be supplied as the bearer credential.
	bearer := ""
	if strings.Count(p.secretKey, ".") == 2 {
		bearer = p.secretKey
	}
	return p.request(ctx, http.MethodDelete, "/auth/v1/admin/users/"+url.PathEscape(userID), p.secretKey, bearer, nil, nil)
}

func (p *SupabaseIdentityProvider) identityResponse(response supabaseSessionResponse, err error) (Identity, IdentityTokens, error) {
	if err != nil {
		return Identity{}, IdentityTokens{}, err
	}
	user := response.identityUser()
	if user == nil || user.ID == "" {
		return Identity{}, IdentityTokens{}, ErrIdentityProvider
	}
	expiresAt := time.Time{}
	if response.ExpiresAt > 0 {
		expiresAt = time.Unix(response.ExpiresAt, 0).UTC()
	} else if response.ExpiresIn > 0 {
		expiresAt = p.now().Add(time.Duration(response.ExpiresIn) * time.Second).UTC()
	}
	return Identity{
			ID: user.ID, Email: user.Email, EmailConfirmedAt: user.EmailConfirmedAt,
		}, IdentityTokens{
			AccessToken: response.AccessToken, RefreshToken: response.RefreshToken, ExpiresAt: expiresAt,
		}, nil
}

func (r supabaseSessionResponse) identityUser() *supabaseUser {
	if r.User != nil {
		return r.User
	}
	if r.ID == "" {
		return nil
	}
	return &supabaseUser{
		ID: r.ID, Email: r.Email, EmailConfirmedAt: r.EmailConfirmedAt, Identities: r.Identities,
	}
}

func (p *SupabaseIdentityProvider) request(ctx context.Context, method, path, apiKey, bearer string, payload any, destination any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode identity request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, p.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("create identity request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("apikey", apiKey)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}

	response, err := p.client.Do(request)
	if err != nil {
		return fmt.Errorf("identity provider request failed: %w", err)
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, maxIdentityResponseBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return fmt.Errorf("read identity provider response: %w", err)
	}
	if len(data) > maxIdentityResponseBytes {
		return errors.New("identity provider response exceeded limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return mapSupabaseError(response.StatusCode, data)
	}
	if destination == nil || len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, destination); err != nil {
		return errors.New("identity provider returned an invalid response")
	}
	return nil
}

func mapSupabaseError(status int, data []byte) error {
	var response supabaseErrorResponse
	_ = json.Unmarshal(data, &response)
	code := response.ErrorCode
	if code == "" {
		code = response.Code
	}
	switch code {
	case "invalid_credentials":
		return ErrInvalidCredentials
	case "email_exists", "user_already_exists":
		return ErrEmailTaken
	case "email_not_confirmed":
		return ErrEmailUnconfirmed
	case "otp_expired", "otp_disabled", "bad_jwt", "invalid_token", "refresh_token_not_found":
		return ErrInvalidIdentityToken
	case "over_email_send_rate_limit", "over_request_rate_limit":
		return ErrProviderRateLimited
	}
	if status == http.StatusTooManyRequests {
		return ErrProviderRateLimited
	}
	if status == http.StatusUnauthorized {
		return ErrInvalidIdentityToken
	}
	return ErrIdentityProvider
}
