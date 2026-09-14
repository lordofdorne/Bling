package payment

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	attempt    Attempt
	prepared   PrepareInput
	profile    PaymentProfile
	profileErr error
	attached   string
	authorized bool
	reconciled Status
}

func (r *fakeRepository) Prepare(_ context.Context, input PrepareInput, _ time.Time) (Attempt, error) {
	r.prepared = input
	r.attempt.PayerUserID = input.PayerUserID
	r.attempt.StripeCustomerID = input.StripeCustomerID
	return r.attempt, nil
}
func (r *fakeRepository) AttachIntent(_ context.Context, _, intent string, _ time.Time) error {
	r.attached = intent
	return nil
}
func (r *fakeRepository) FindForViewer(context.Context, string, string, []byte) (Attempt, error) {
	return r.attempt, nil
}
func (r *fakeRepository) MarkAuthorized(context.Context, string, time.Time) error {
	r.authorized = true
	return nil
}
func (r *fakeRepository) MarkFailed(context.Context, string, string, time.Time) error { return nil }
func (r *fakeRepository) MarkCanceled(context.Context, string, time.Time) error       { return nil }
func (r *fakeRepository) Reconcile(_ context.Context, _ string, status Status, _ string, _ time.Time) error {
	r.reconciled = status
	return nil
}
func (r *fakeRepository) PaymentProfileByUser(context.Context, string) (PaymentProfile, error) {
	return r.profile, r.profileErr
}
func (r *fakeRepository) SavePaymentProfile(_ context.Context, userID, customerID string, _ time.Time) (PaymentProfile, error) {
	r.profile = PaymentProfile{UserID: userID, StripeCustomerID: customerID}
	r.profileErr = nil
	return r.profile, nil
}

type fakeGateway struct {
	intent           Intent
	captures         int
	cancels          int
	customerID       string
	customerSessions int
	setupSecret      string
	methods          []SavedPaymentMethod
	detached         string
}

func (g *fakeGateway) CreateAuthorization(context.Context, Attempt) (Intent, error) {
	return g.intent, nil
}
func (g *fakeGateway) Retrieve(context.Context, string) (Intent, error) { return g.intent, nil }
func (g *fakeGateway) Capture(context.Context, string, string) (Intent, error) {
	g.captures++
	return g.intent, nil
}
func (g *fakeGateway) Cancel(context.Context, string, string) error { g.cancels++; return nil }
func (g *fakeGateway) CreateCustomer(context.Context, string, string) (string, error) {
	if g.customerID == "" {
		g.customerID = "cus_1"
	}
	return g.customerID, nil
}
func (g *fakeGateway) CreateCustomerSession(context.Context, string, bool) (string, error) {
	g.customerSessions++
	return "cuss_secret", nil
}
func (g *fakeGateway) CreateSetupIntent(context.Context, string, string) (string, error) {
	if g.setupSecret == "" {
		g.setupSecret = "seti_secret"
	}
	return g.setupSecret, nil
}
func (g *fakeGateway) ListPaymentMethods(context.Context, string, int64) ([]SavedPaymentMethod, error) {
	return g.methods, nil
}
func (g *fakeGateway) DetachPaymentMethod(_ context.Context, id string) error {
	g.detached = id
	return nil
}

func TestAuthorizeCreatesManualCaptureIntent(t *testing.T) {
	repository := &fakeRepository{attempt: Attempt{ID: "attempt-1", ShowID: "show-1", TierID: "tier-1", AmountCents: 2500, Currency: "usd"}}
	gateway := &fakeGateway{intent: Intent{ID: "pi_1", ClientSecret: "secret", AmountCents: 2500, Currency: "usd", Status: "requires_payment_method"}}
	service := NewService(repository, gateway, "pk_test_example")
	value, err := service.Authorize(context.Background(), PrepareInput{})
	if err != nil {
		t.Fatal(err)
	}
	if value.AttemptID != "attempt-1" || value.ClientSecret != "secret" || repository.attached != "pi_1" {
		t.Fatalf("authorization=%+v attached=%q", value, repository.attached)
	}
}

func TestVerifyRequiresStripeCapturableStateAndExactAmount(t *testing.T) {
	repository := &fakeRepository{attempt: Attempt{ID: "attempt-1", StripePaymentIntentID: "pi_1", DestinationAccountID: "acct_creator", AmountCents: 2500, PlatformFeeCents: 750, Currency: "usd", Status: StatusCreated}}
	gateway := &fakeGateway{intent: Intent{ID: "pi_1", DestinationAccountID: "acct_creator", ApplicationFeeAmount: 750, AmountCents: 2500, Currency: "usd", Status: "requires_capture"}}
	service := NewService(repository, gateway, "pk_test_example")
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); err != nil {
		t.Fatal(err)
	}
	if !repository.authorized {
		t.Fatal("authorization was not persisted")
	}
	gateway.intent.AmountCents = 2600
	repository.authorized = false
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); !errors.Is(err, ErrAuthorization) {
		t.Fatalf("amount mismatch error=%v", err)
	}
	gateway.intent.AmountCents = 2500
	gateway.intent.DestinationAccountID = "acct_attacker"
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); !errors.Is(err, ErrAuthorization) {
		t.Fatalf("destination mismatch error=%v", err)
	}
	gateway.intent.DestinationAccountID = "acct_creator"
	gateway.intent.ApplicationFeeAmount = 749
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); !errors.Is(err, ErrAuthorization) {
		t.Fatalf("fee mismatch error=%v", err)
	}
}

func TestVerifyPlatformAuthorizationRejectsDestinationOrApplicationFee(t *testing.T) {
	repository := &fakeRepository{attempt: Attempt{ID: "attempt-1", StripePaymentIntentID: "pi_1", Flow: FlowPlatform, AmountCents: 2500, PlatformFeeCents: 750, Currency: "usd", Status: StatusCreated}}
	gateway := &fakeGateway{intent: Intent{ID: "pi_1", AmountCents: 2500, Currency: "usd", Status: "requires_capture"}}
	service := NewService(repository, gateway, "pk_test_example")
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); err != nil {
		t.Fatal(err)
	}
	gateway.intent.DestinationAccountID = "acct_attacker"
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); !errors.Is(err, ErrAuthorization) {
		t.Fatalf("destination mismatch error=%v", err)
	}
	gateway.intent.DestinationAccountID = ""
	gateway.intent.ApplicationFeeAmount = 750
	if err := service.VerifyForQueue(context.Background(), "show-1", "attempt-1", []byte("viewer")); !errors.Is(err, ErrAuthorization) {
		t.Fatalf("fee mismatch error=%v", err)
	}
}

func TestCreatorGetsEightyPercentLessHalfBasicCardFee(t *testing.T) {
	for _, test := range []struct {
		amount               int64
		basicFee             int64
		creatorProcessingFee int64
		totalDeduction       int64
	}{{50, 31, 15, 25}, {99, 33, 16, 36}, {2500, 103, 51, 551}} {
		basicFee := basicCardFeeCents(test.amount)
		if basicFee != test.basicFee {
			t.Fatalf("basicCardFeeCents(%d)=%d want %d", test.amount, basicFee, test.basicFee)
		}
		creatorFee := creatorProcessingFeeCents(basicFee)
		if creatorFee != test.creatorProcessingFee {
			t.Fatalf("creatorProcessingFeeCents(%d)=%d want %d", basicFee, creatorFee, test.creatorProcessingFee)
		}
		if got := platformFeeCents(test.amount, creatorFee); got != test.totalDeduction {
			t.Fatalf("platformFeeCents(%d,%d)=%d want %d", test.amount, creatorFee, got, test.totalDeduction)
		}
	}
}

func TestDisabledPaymentsFailClosed(t *testing.T) {
	service := NewService(&fakeRepository{}, nil, "")
	if _, err := service.Authorize(context.Background(), PrepareInput{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("error=%v", err)
	}
}

func TestSignedInAuthorizationCreatesCustomerSession(t *testing.T) {
	repository := &fakeRepository{attempt: Attempt{ID: "attempt-1", AmountCents: 500, Currency: "usd"}, profileErr: ErrPaymentProfileNotFound}
	gateway := &fakeGateway{intent: Intent{ID: "pi_1", ClientSecret: "pi_secret"}}
	service := NewService(repository, gateway, "pk_test_example")

	value, err := service.Authorize(context.Background(), PrepareInput{PayerUserID: "user-1", PayerEmail: "user@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if repository.profile.StripeCustomerID != "cus_1" || repository.prepared.StripeCustomerID != "cus_1" {
		t.Fatalf("profile=%+v prepared=%+v", repository.profile, repository.prepared)
	}
	if value.CustomerSessionClientSecret != "cuss_secret" || gateway.customerSessions != 1 {
		t.Fatalf("authorization=%+v sessions=%d", value, gateway.customerSessions)
	}
}

func TestPaymentMethodSettingsVerifyOwnershipBeforeDetach(t *testing.T) {
	repository := &fakeRepository{profile: PaymentProfile{UserID: "user-1", StripeCustomerID: "cus_1"}}
	gateway := &fakeGateway{methods: []SavedPaymentMethod{{ID: "pm_owned", Brand: "visa", Last4: "4242"}}}
	service := NewService(repository, gateway, "pk_test_example")

	if err := service.RemovePaymentMethod(context.Background(), "user-1", "pm_other"); !errors.Is(err, ErrPaymentMethodNotFound) {
		t.Fatalf("error=%v", err)
	}
	if gateway.detached != "" {
		t.Fatalf("detached unowned method %q", gateway.detached)
	}
	if err := service.RemovePaymentMethod(context.Background(), "user-1", "pm_owned"); err != nil {
		t.Fatal(err)
	}
	if gateway.detached != "pm_owned" {
		t.Fatalf("detached=%q", gateway.detached)
	}
}

func TestSetupPaymentMethodReturnsBothShortLivedSecrets(t *testing.T) {
	repository := &fakeRepository{profile: PaymentProfile{UserID: "user-1", StripeCustomerID: "cus_1"}}
	gateway := &fakeGateway{}
	service := NewService(repository, gateway, "pk_test_example")
	setup, err := service.SetupPaymentMethod(context.Background(), "user-1", "user@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if setup.ClientSecret != "seti_secret" || setup.CustomerSessionClientSecret != "cuss_secret" || setup.PublishableKey != "pk_test_example" {
		t.Fatalf("setup=%+v", setup)
	}
}
