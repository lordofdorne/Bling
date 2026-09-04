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
	r.account = Account{CreatorID: creatorID, StripeAccountID: stripeAccount.ID, ChargesEnabled: stripeAccount.ChargesEnabled, PayoutsEnabled: stripeAccount.PayoutsEnabled, DetailsSubmitted: stripeAccount.DetailsSubmitted, RequirementsDue: stripeAccount.RequirementsDue, CreatedAt: now, UpdatedAt: now}
	return r.account, nil
}

type fakeGateway struct {
	account    StripeAccount
	created    int
	linked     int
	refreshURL string
	returnURL  string
}

func (g *fakeGateway) CreateExpressAccount(context.Context, string, string, string) (StripeAccount, error) {
	g.created++
	return g.account, nil
}
func (g *fakeGateway) RetrieveAccount(context.Context, string) (StripeAccount, error) {
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

func TestOnboardingCreatesExpressAccountAndSingleUseLink(t *testing.T) {
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
	ready := StripeAccount{ID: "acct_creator", ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}
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
