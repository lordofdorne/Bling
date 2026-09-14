package payment

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Service struct {
	repository      Repository
	gateway         Gateway
	customers       CustomerRepository
	customerGateway CustomerGateway
	publishableKey  string
	now             func() time.Time
}

func NewService(repository Repository, gateway Gateway, publishableKey string) *Service {
	service := &Service{repository: repository, gateway: gateway, publishableKey: publishableKey, now: time.Now}
	service.customers, _ = repository.(CustomerRepository)
	service.customerGateway, _ = gateway.(CustomerGateway)
	return service
}

func (s *Service) Enabled() bool { return s != nil && s.gateway != nil && s.publishableKey != "" }

func (s *Service) Authorize(ctx context.Context, input PrepareInput) (Authorization, error) {
	if !s.Enabled() {
		return Authorization{}, ErrDisabled
	}
	if input.PayerUserID != "" {
		profile, err := s.ensureCustomer(ctx, input.PayerUserID, input.PayerEmail)
		if err != nil {
			return Authorization{}, err
		}
		input.StripeCustomerID = profile.StripeCustomerID
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
	authorization := Authorization{AttemptID: attempt.ID, ClientSecret: intent.ClientSecret, PublishableKey: s.publishableKey, AmountCents: attempt.AmountCents, Currency: attempt.Currency}
	if attempt.StripeCustomerID != "" {
		if s.customerGateway == nil {
			return Authorization{}, ErrDisabled
		}
		authorization.CustomerSessionClientSecret, err = s.customerGateway.CreateCustomerSession(ctx, attempt.StripeCustomerID, true)
		if err != nil {
			return Authorization{}, fmt.Errorf("create Stripe customer session: %w", err)
		}
	}
	return authorization, nil
}

func (s *Service) ensureCustomer(ctx context.Context, userID, email string) (PaymentProfile, error) {
	if s.customers == nil || s.customerGateway == nil {
		return PaymentProfile{}, ErrDisabled
	}
	profile, err := s.customers.PaymentProfileByUser(ctx, userID)
	if err == nil {
		return profile, nil
	}
	if !errors.Is(err, ErrPaymentProfileNotFound) {
		return PaymentProfile{}, err
	}
	customerID, err := s.customerGateway.CreateCustomer(ctx, userID, email)
	if err != nil {
		return PaymentProfile{}, fmt.Errorf("create Stripe customer: %w", err)
	}
	return s.customers.SavePaymentProfile(ctx, userID, customerID, s.now().UTC())
}

func (s *Service) SetupPaymentMethod(ctx context.Context, userID, email string) (PaymentMethodSetup, error) {
	if !s.Enabled() || s.publishableKey == "" {
		return PaymentMethodSetup{}, ErrDisabled
	}
	profile, err := s.ensureCustomer(ctx, userID, email)
	if err != nil {
		return PaymentMethodSetup{}, err
	}
	key := fmt.Sprintf("bling-payment-method-setup-%s-%d", userID, s.now().UTC().UnixNano())
	clientSecret, err := s.customerGateway.CreateSetupIntent(ctx, profile.StripeCustomerID, key)
	if err != nil {
		return PaymentMethodSetup{}, fmt.Errorf("create Stripe setup intent: %w", err)
	}
	customerSecret, err := s.customerGateway.CreateCustomerSession(ctx, profile.StripeCustomerID, false)
	if err != nil {
		return PaymentMethodSetup{}, fmt.Errorf("create Stripe customer session: %w", err)
	}
	return PaymentMethodSetup{ClientSecret: clientSecret, CustomerSessionClientSecret: customerSecret, PublishableKey: s.publishableKey}, nil
}

func (s *Service) PaymentMethods(ctx context.Context, userID string) ([]SavedPaymentMethod, error) {
	if !s.Enabled() || s.customers == nil || s.customerGateway == nil {
		return nil, ErrDisabled
	}
	profile, err := s.customers.PaymentProfileByUser(ctx, userID)
	if errors.Is(err, ErrPaymentProfileNotFound) {
		return []SavedPaymentMethod{}, nil
	}
	if err != nil {
		return nil, err
	}
	return s.customerGateway.ListPaymentMethods(ctx, profile.StripeCustomerID, 25)
}

func (s *Service) RemovePaymentMethod(ctx context.Context, userID, paymentMethodID string) error {
	methods, err := s.PaymentMethods(ctx, userID)
	if err != nil {
		return err
	}
	for _, method := range methods {
		if method.ID == paymentMethodID {
			return s.customerGateway.DetachPaymentMethod(ctx, paymentMethodID)
		}
	}
	return ErrPaymentMethodNotFound
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
	providerFieldsMatch := intent.DestinationAccountID == "" && intent.ApplicationFeeAmount == 0
	if attempt.Flow != FlowPlatform {
		providerFieldsMatch = intent.DestinationAccountID == attempt.DestinationAccountID && intent.ApplicationFeeAmount == attempt.PlatformFeeCents
	}
	if intent.Status != "requires_capture" || intent.AmountCents != attempt.AmountCents || intent.Currency != attempt.Currency || !providerFieldsMatch {
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

func (s *Service) ReconcileSavedPaymentMethod(ctx context.Context, intentID, customerID, paymentMethodID string) error {
	if intentID == "" || customerID == "" || paymentMethodID == "" {
		return nil
	}
	audit, ok := s.repository.(SavedMethodAuditRepository)
	if !ok {
		return nil
	}
	return audit.RecordSavedPaymentMethod(ctx, intentID, customerID, paymentMethodID, s.now().UTC())
}
