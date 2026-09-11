package payout

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	account Account
	err     error
}

func (r *fakeRepository) ByCreator(context.Context, string) (Account, error) {
	return r.account, r.err
}
func (r *fakeRepository) ByStripeAccountID(context.Context, string) (Account, error) {
	return r.account, r.err
}
func (r *fakeRepository) Upsert(_ context.Context, creatorID string, stripeAccount StripeAccount, now time.Time) (Account, error) {
	r.err = nil
	r.account = Account{CreatorID: creatorID, StripeAccountID: stripeAccount.ID, TransfersStatus: stripeAccount.TransfersStatus, ChargesEnabled: stripeAccount.ChargesEnabled, PayoutsEnabled: stripeAccount.PayoutsEnabled, DetailsSubmitted: stripeAccount.DetailsSubmitted, RequirementsDue: stripeAccount.RequirementsDue, CreatedAt: now, UpdatedAt: now}
	return r.account, nil
}

type fakeGateway struct {
	account    StripeAccount
	created    int
	linked     int
	retrieved  int
	country    string
	refreshURL string
	returnURL  string
}

func (g *fakeGateway) CreateConnectedAccount(_ context.Context, _, _, country string) (StripeAccount, error) {
	g.created++
	g.country = country
	return g.account, nil
}
func (g *fakeGateway) RetrieveAccount(context.Context, string) (StripeAccount, error) {
	g.retrieved++
	return g.account, nil
}
func (g *fakeGateway) CreateOnboardingLink(_ context.Context, _ string, refreshURL, returnURL string) (string, error) {
	g.linked++
	g.refreshURL, g.returnURL = refreshURL, returnURL
	return "https://connect.stripe.test/onboard", nil
}

func TestStatusBeforeConnectingExplainsFee(t *testing.T) {
	service := NewService(&fakeRepository{err: ErrAccountNotFound}, nil, "US", "https://bling.test")
	status, err := service.Status(context.Background(), "creator-1")
	if err != nil {
		t.Fatal(err)
	}
	if status.Connected || status.Ready || status.PlatformFeePercent != 30 || status.RequirementsDue == nil {
		t.Fatalf("status=%+v", status)
	}
}

func TestOnboardingCreatesConnectedAccountAndSingleUseLink(t *testing.T) {
	repository := &fakeRepository{err: ErrAccountNotFound}
	gateway := &fakeGateway{account: StripeAccount{ID: "acct_creator", RequirementsDue: []string{"external_account"}}}
	service := NewService(repository, gateway, "US", "https://bling.test/")
	url, err := service.OnboardingLink(context.Background(), "creator-1", "creator@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if url == "" || gateway.created != 1 || gateway.linked != 1 {
		t.Fatalf("url=%q created=%d linked=%d", url, gateway.created, gateway.linked)
	}
	if gateway.refreshURL != "https://bling.test/dashboard?stripe=refresh" || gateway.returnURL != "https://bling.test/dashboard?stripe=return" {
		t.Fatalf("refresh=%q return=%q", gateway.refreshURL, gateway.returnURL)
	}
}

func TestReadyAccountDoesNotCreateAnotherOnboardingLink(t *testing.T) {
	ready := StripeAccount{ID: "acct_creator", TransfersStatus: TransfersStatusActive, ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}
	repository := &fakeRepository{account: Account{CreatorID: "creator-1", StripeAccountID: ready.ID}}
	gateway := &fakeGateway{account: ready}
	service := NewService(repository, gateway, "US", "https://bling.test")
	url, err := service.OnboardingLink(context.Background(), "creator-1", "creator@example.com")
	if err != nil || url != "" || gateway.linked != 0 {
		t.Fatalf("url=%q linked=%d err=%v", url, gateway.linked, err)
	}
}

func TestOnboardingFailsClosedWithoutStripe(t *testing.T) {
	service := NewService(&fakeRepository{}, nil, "US", "https://bling.test")
	if _, err := service.OnboardingLink(context.Background(), "creator-1", "creator@example.com"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("error=%v", err)
	}
}

// A creator is only payable when Stripe reports the transfers capability active.
func TestReadinessFollowsTransfersCapability(t *testing.T) {
	for _, testCase := range []struct {
		status string
		ready  bool
	}{
		{TransfersStatusActive, true},
		{TransfersStatusPending, false},
		{TransfersStatusRestricted, false},
		{TransfersStatusUnsupported, false},
		{"", false},
	} {
		t.Run(testCase.status, func(t *testing.T) {
			active := testCase.status == TransfersStatusActive
			account := Account{
				StripeAccountID:  "acct_creator",
				TransfersStatus:  testCase.status,
				ChargesEnabled:   active,
				PayoutsEnabled:   active,
				DetailsSubmitted: true,
			}
			if account.Ready() != testCase.ready {
				t.Fatalf("status=%q ready=%v, want %v", testCase.status, account.Ready(), testCase.ready)
			}
		})
	}
}

// The account country must reach Stripe; a US-only platform silently creating
// accounts in the wrong country would be a costly, hard-to-reverse mistake.
func TestOnboardingPassesConfiguredCountry(t *testing.T) {
	gateway := &fakeGateway{account: StripeAccount{ID: "acct_creator"}}
	service := NewService(&fakeRepository{err: ErrAccountNotFound}, gateway, "US", "https://bling.test")
	if _, err := service.OnboardingLink(context.Background(), "creator-1", "creator@example.com"); err != nil {
		t.Fatal(err)
	}
	if gateway.country != "US" {
		t.Fatalf("country=%q", gateway.country)
	}
}

// Webhooks must not write account state from their payload: the event carries
// the v1 shape, so the service re-reads the account through the v2 API.
func TestReconcileRefreshesFromStripeRatherThanTrustingTheEvent(t *testing.T) {
	repository := &fakeRepository{account: Account{CreatorID: "creator-1", StripeAccountID: "acct_creator"}}
	gateway := &fakeGateway{account: StripeAccount{ID: "acct_creator", TransfersStatus: TransfersStatusActive, ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}}
	service := NewService(repository, gateway, "US", "https://bling.test")

	if err := service.Reconcile(context.Background(), "acct_creator"); err != nil {
		t.Fatal(err)
	}
	if gateway.retrieved != 1 {
		t.Fatalf("retrieved=%d, want a refresh from Stripe", gateway.retrieved)
	}
	if repository.account.TransfersStatus != TransfersStatusActive || !repository.account.Ready() {
		t.Fatalf("account=%+v", repository.account)
	}
}

// An event for an account Bling does not know about is ignored, not an error.
func TestReconcileIgnoresUnknownAccount(t *testing.T) {
	service := NewService(&fakeRepository{err: ErrAccountNotFound}, &fakeGateway{}, "US", "https://bling.test")
	if err := service.Reconcile(context.Background(), "acct_stranger"); err != nil {
		t.Fatalf("error=%v", err)
	}
}
