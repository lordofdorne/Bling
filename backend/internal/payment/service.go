package payment

import (
	"context"
	"fmt"
	"time"
)

type Service struct {
	repository     Repository
	gateway        Gateway
	publishableKey string
	now            func() time.Time
}

func NewService(repository Repository, gateway Gateway, publishableKey string) *Service {
	return &Service{repository: repository, gateway: gateway, publishableKey: publishableKey, now: time.Now}
}

func (s *Service) Enabled() bool { return s != nil && s.gateway != nil && s.publishableKey != "" }

func (s *Service) Authorize(ctx context.Context, input PrepareInput) (Authorization, error) {
	if !s.Enabled() {
		return Authorization{}, ErrDisabled
	}
	attempt, err := s.repository.Prepare(ctx, input, s.now().UTC())
	if err != nil {
		return Authorization{}, err
	}
	var intent Intent
	if attempt.StripePaymentIntentID == "" {
		intent, err = s.gateway.CreateAuthorization(ctx, attempt)
		if err != nil {
			return Authorization{}, fmt.Errorf("create Stripe authorization: %w", err)
		}
		if err := s.repository.AttachIntent(ctx, attempt.ID, intent.ID, s.now().UTC()); err != nil {
			return Authorization{}, err
		}
	} else {
		intent, err = s.gateway.Retrieve(ctx, attempt.StripePaymentIntentID)
		if err != nil {
			return Authorization{}, fmt.Errorf("retrieve Stripe authorization: %w", err)
		}
	}
	return Authorization{AttemptID: attempt.ID, ClientSecret: intent.ClientSecret, PublishableKey: s.publishableKey, AmountCents: attempt.AmountCents, Currency: attempt.Currency}, nil
}

func (s *Service) VerifyForQueue(ctx context.Context, showID, attemptID string, viewerHash []byte) error {
	if attemptID == "" {
		return ErrAuthorization
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	attempt, err := s.repository.FindForViewer(ctx, showID, attemptID, viewerHash)
	if err != nil {
		return err
	}
	if attempt.Status == StatusAuthorized {
		return nil
	}
	if attempt.Status != StatusCreated || attempt.StripePaymentIntentID == "" {
		return ErrAuthorization
	}
	intent, err := s.gateway.Retrieve(ctx, attempt.StripePaymentIntentID)
	if err != nil {
		return fmt.Errorf("verify Stripe authorization: %w", err)
	}
	if intent.Status != "requires_capture" || intent.AmountCents != attempt.AmountCents || intent.Currency != attempt.Currency || intent.DestinationAccountID != attempt.DestinationAccountID || intent.ApplicationFeeAmount != attempt.PlatformFeeCents {
		return ErrAuthorization
	}
	return s.repository.MarkAuthorized(ctx, attempt.ID, s.now().UTC())
}

func (s *Service) Cancel(ctx context.Context, attempt Attempt, reason string) error {
	if attempt.StripePaymentIntentID == "" || attempt.Status == StatusCanceled || attempt.Status == StatusCaptured {
		return nil
	}
	if err := s.gateway.Cancel(ctx, attempt.StripePaymentIntentID, reason); err != nil {
		return err
	}
	return s.repository.MarkCanceled(ctx, attempt.ID, s.now().UTC())
}

func (s *Service) CancelForViewer(ctx context.Context, showID, attemptID string, viewerHash []byte) error {
	if attemptID == "" || !s.Enabled() {
		return nil
	}
	attempt, err := s.repository.FindForViewer(ctx, showID, attemptID, viewerHash)
	if err != nil {
		return err
	}
	return s.Cancel(ctx, attempt, "caller_left")
}

func (s *Service) Reconcile(ctx context.Context, intentID string, status Status, failureCode string) error {
	if intentID == "" {
		return ErrAttemptNotFound
	}
	return s.repository.Reconcile(ctx, intentID, status, failureCode, s.now().UTC())
}
