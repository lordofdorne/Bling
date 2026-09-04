package payout

import (
	"context"

	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/account"
	"github.com/stripe/stripe-go/v82/accountlink"
)

type StripeGateway struct{}

func NewStripeGateway(secretKey string) *StripeGateway {
	stripe.Key = secretKey
	return &StripeGateway{}
}

func (g *StripeGateway) CreateExpressAccount(ctx context.Context, creatorID, email, country string) (StripeAccount, error) {
	params := &stripe.AccountParams{Type: stripe.String(string(stripe.AccountTypeExpress)), Email: stripe.String(email), Country: stripe.String(country)}
	params.Context = ctx
	params.AddMetadata("bling_creator_id", creatorID)
	params.SetIdempotencyKey("bling-connect-account-" + creatorID)
	value, err := account.New(params)
	if err != nil {
		return StripeAccount{}, err
	}
	return stripeAccount(value), nil
}

func (g *StripeGateway) RetrieveAccount(ctx context.Context, id string) (StripeAccount, error) {
	params := &stripe.AccountParams{}
	params.Context = ctx
	value, err := account.GetByID(id, params)
	if err != nil {
		return StripeAccount{}, err
	}
	return stripeAccount(value), nil
}

func (g *StripeGateway) CreateOnboardingLink(ctx context.Context, accountID, refreshURL, returnURL string) (string, error) {
	params := &stripe.AccountLinkParams{Account: stripe.String(accountID), RefreshURL: stripe.String(refreshURL), ReturnURL: stripe.String(returnURL), Type: stripe.String(string(stripe.AccountLinkTypeAccountOnboarding))}
	params.Context = ctx
	value, err := accountlink.New(params)
	if err != nil {
		return "", err
	}
	return value.URL, nil
}

func stripeAccount(value *stripe.Account) StripeAccount {
	if value == nil {
		return StripeAccount{}
	}
	due := []string{}
	if value.Requirements != nil {
		due = append(due, value.Requirements.CurrentlyDue...)
	}
	return StripeAccount{ID: value.ID, ChargesEnabled: value.ChargesEnabled, PayoutsEnabled: value.PayoutsEnabled, DetailsSubmitted: value.DetailsSubmitted, RequirementsDue: due}
}

var _ Gateway = (*StripeGateway)(nil)
