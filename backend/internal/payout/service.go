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
	repository  Repository
	gateway     Gateway
	country     string
	frontendURL string
	now         func() time.Time
}

func NewService(repository Repository, gateway Gateway, country, frontendURL string) *Service {
	return &Service{repository: repository, gateway: gateway, country: country, frontendURL: strings.TrimRight(frontendURL, "/"), now: time.Now}
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
		created, createErr := s.gateway.CreateExpressAccount(ctx, creatorID, email, s.country)
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

func (s *Service) Reconcile(ctx context.Context, value StripeAccount) error {
	if value.ID == "" {
		return ErrAccountNotFound
	}
	account, err := s.repository.ByStripeAccountID(ctx, value.ID)
	if errors.Is(err, ErrAccountNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.repository.Upsert(ctx, account.CreatorID, value, s.now().UTC())
	return err
}

func statusFor(account Account) Status {
	requirements := account.RequirementsDue
	if requirements == nil {
		requirements = []string{}
	}
	return Status{Connected: true, ChargesEnabled: account.ChargesEnabled, PayoutsEnabled: account.PayoutsEnabled, DetailsSubmitted: account.DetailsSubmitted, Ready: account.Ready(), RequirementsDue: requirements, PlatformFeePercent: PlatformFeePercent}
}
