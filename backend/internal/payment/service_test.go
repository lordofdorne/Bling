package payment

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	attempt    Attempt
	attached   string
	authorized bool
	reconciled Status
}

func (r *fakeRepository) Prepare(context.Context, PrepareInput, time.Time) (Attempt, error) {
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

type fakeGateway struct {
	intent   Intent
	captures int
	cancels  int
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

func TestPlatformFeeIsThirtyPercentInWholeCents(t *testing.T) {
	for _, test := range []struct {
		amount int64
		fee    int64
	}{{50, 15}, {99, 29}, {2500, 750}} {
		if got := platformFeeCents(test.amount); got != test.fee {
			t.Fatalf("platformFeeCents(%d)=%d want %d", test.amount, got, test.fee)
		}
	}
}

func TestDisabledPaymentsFailClosed(t *testing.T) {
	service := NewService(&fakeRepository{}, nil, "")
	if _, err := service.Authorize(context.Background(), PrepareInput{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("error=%v", err)
	}
}
