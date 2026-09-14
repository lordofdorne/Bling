package payout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
)

const PlatformFeePercent = int(paymentdomain.PlatformFeeBPS / 100)

type Service struct {
	repository     Repository
	gateway        Gateway
	country        string
	frontendURL    string
	publishableKey string
	now            func() time.Time
}

func NewService(repository Repository, gateway Gateway, country, frontendURL string, publishableKey ...string) *Service {
	value := &Service{repository: repository, gateway: gateway, country: country, frontendURL: strings.TrimRight(frontendURL, "/"), now: time.Now}
	if len(publishableKey) > 0 {
		value.publishableKey = publishableKey[0]
	}
	return value
}

func (s *Service) Enabled() bool { return s != nil && s.gateway != nil }

func (s *Service) Status(ctx context.Context, creatorID string) (Status, error) {
	account, err := s.repository.ByCreator(ctx, creatorID)
	if errors.Is(err, ErrAccountNotFound) {
		return Status{RequirementsDue: []string{}, PlatformFeePercent: PlatformFeePercent}, nil
	}
	if err != nil {
		return Status{}, err
	}
	if s.Enabled() {
		refreshed, refreshErr := s.gateway.RetrieveAccount(ctx, account.StripeAccountID)
		if refreshErr != nil {
			return Status{}, fmt.Errorf("refresh Stripe connected account: %w", refreshErr)
		}
		if refreshed.ID != account.StripeAccountID {
			return Status{}, fmt.Errorf("refresh Stripe connected account: account identity changed")
		}
		account, err = s.repository.Upsert(ctx, creatorID, refreshed, s.now().UTC())
		if err != nil {
			return Status{}, err
		}
	}
	return statusFor(account), nil
}

func (s *Service) OnboardingLink(ctx context.Context, creatorID, email string) (string, error) {
	if !s.Enabled() {
		return "", ErrDisabled
	}
	account, err := s.repository.ByCreator(ctx, creatorID)
	if errors.Is(err, ErrAccountNotFound) {
		created, createErr := s.gateway.CreateConnectedAccount(ctx, creatorID, email, s.country)
		if createErr != nil {
			return "", fmt.Errorf("create Stripe connected account: %w", createErr)
		}
		account, err = s.repository.Upsert(ctx, creatorID, created, s.now().UTC())
	}
	if err != nil {
		return "", err
	}
	refreshed, err := s.gateway.RetrieveAccount(ctx, account.StripeAccountID)
	if err != nil {
		return "", fmt.Errorf("refresh Stripe connected account: %w", err)
	}
	if refreshed.ID != account.StripeAccountID {
		return "", fmt.Errorf("refresh Stripe connected account: account identity changed")
	}
	account, err = s.repository.Upsert(ctx, creatorID, refreshed, s.now().UTC())
	if err != nil {
		return "", err
	}
	if account.Ready() {
		return "", nil
	}
	url, err := s.gateway.CreateOnboardingLink(ctx, account.StripeAccountID, s.frontendURL+"/dashboard?stripe=refresh", s.frontendURL+"/dashboard?stripe=return")
	if err != nil {
		return "", fmt.Errorf("create Stripe onboarding link: %w", err)
	}
	return url, nil
}

func (s *Service) AccountSession(ctx context.Context, creatorID, email string) (AccountSession, error) {
	if !s.Enabled() {
		return AccountSession{}, ErrDisabled
	}
	embedded, ok := s.gateway.(EmbeddedGateway)
	if !ok || s.publishableKey == "" {
		return AccountSession{}, ErrDisabled
	}
	account, err := s.ensureAccount(ctx, creatorID, email)
	if err != nil {
		return AccountSession{}, err
	}
	secret, err := embedded.CreateAccountSession(ctx, account.StripeAccountID)
	if err != nil {
		return AccountSession{}, fmt.Errorf("create Stripe account session: %w", err)
	}
	return AccountSession{ClientSecret: secret, PublishableKey: s.publishableKey}, nil
}

func (s *Service) ensureAccount(ctx context.Context, creatorID, email string) (Account, error) {
	account, err := s.repository.ByCreator(ctx, creatorID)
	if errors.Is(err, ErrAccountNotFound) {
		created, createErr := s.gateway.CreateConnectedAccount(ctx, creatorID, email, s.country)
		if createErr != nil {
			return Account{}, fmt.Errorf("create Stripe connected account: %w", createErr)
		}
		return s.repository.Upsert(ctx, creatorID, created, s.now().UTC())
	}
	return account, err
}

// Reconcile refreshes a connected account from Stripe after a webhook.
//
// The webhook payload itself is deliberately not trusted for account state. An
// account.updated event carries the v1 account shape, whose charges_enabled and
// payouts_enabled fields do not describe the v2 recipient capability Bling
// depends on; writing them straight through would corrupt readiness. Only the
// account ID is taken from the event, and the authoritative state is re-read
// through the v2 API.
func (s *Service) Reconcile(ctx context.Context, accountID string) error {
	if accountID == "" {
		return ErrAccountNotFound
	}
	account, err := s.repository.ByStripeAccountID(ctx, accountID)
	if errors.Is(err, ErrAccountNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if !s.Enabled() {
		return nil
	}
	refreshed, err := s.gateway.RetrieveAccount(ctx, accountID)
	if err != nil {
		return fmt.Errorf("refresh Stripe connected account: %w", err)
	}
	if refreshed.ID != accountID {
		return fmt.Errorf("refresh Stripe connected account: account identity changed")
	}
	_, err = s.repository.Upsert(ctx, account.CreatorID, refreshed, s.now().UTC())
	return err
}

func statusFor(account Account) Status {
	requirements := account.RequirementsDue
	if requirements == nil {
		requirements = []string{}
	}
	return Status{Connected: true, TransfersStatus: account.TransfersStatus, BankPayoutsStatus: account.BankPayoutsStatus, ExternalAccountPresent: account.ExternalAccountPresent, ExternalAccountBankName: account.ExternalAccountBankName, ExternalAccountLast4: account.ExternalAccountLast4, ExternalAccountCurrency: account.ExternalAccountCurrency, ChargesEnabled: account.ChargesEnabled, PayoutsEnabled: account.PayoutsEnabled, DetailsSubmitted: account.DetailsSubmitted, Ready: account.Ready(), RequirementsDue: requirements, PlatformFeePercent: PlatformFeePercent}
}
