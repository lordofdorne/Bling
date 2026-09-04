package payment

import (
	"context"

	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/paymentintent"
)

type StripeGateway struct{}

func NewStripeGateway(secretKey string) *StripeGateway {
	stripe.Key = secretKey
	return &StripeGateway{}
}

func (g *StripeGateway) CreateAuthorization(ctx context.Context, attempt Attempt) (Intent, error) {
	params := &stripe.PaymentIntentParams{
		Amount: stripe.Int64(attempt.AmountCents), Currency: stripe.String(attempt.Currency),
		CaptureMethod:      stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		Description:        stripe.String("Bling Hotline call"),
	}
	params.Context = ctx
	params.AddMetadata("bling_payment_attempt_id", attempt.ID)
	params.AddMetadata("bling_show_id", attempt.ShowID)
	params.AddMetadata("bling_tier_id", attempt.TierID)
	params.SetIdempotencyKey("bling-payment-create-" + attempt.ID)
	value, err := paymentintent.New(params)
	if err != nil {
		return Intent{}, err
	}
	return stripeIntent(value), nil
}

func (g *StripeGateway) Retrieve(ctx context.Context, id string) (Intent, error) {
	params := &stripe.PaymentIntentParams{}
	params.Context = ctx
	value, err := paymentintent.Get(id, params)
	if err != nil {
		return Intent{}, err
	}
	return stripeIntent(value), nil
}

func (g *StripeGateway) Capture(ctx context.Context, id, idempotencyKey string) (Intent, error) {
	params := &stripe.PaymentIntentCaptureParams{}
	params.Context = ctx
	params.SetIdempotencyKey(idempotencyKey)
	value, err := paymentintent.Capture(id, params)
	if err != nil {
		return Intent{}, err
	}
	return stripeIntent(value), nil
}

func (g *StripeGateway) Cancel(ctx context.Context, id, reason string) error {
	params := &stripe.PaymentIntentCancelParams{}
	params.Context = ctx
	params.SetIdempotencyKey("bling-payment-cancel-" + id + "-" + reason)
	_, err := paymentintent.Cancel(id, params)
	return err
}

func stripeIntent(value *stripe.PaymentIntent) Intent {
	if value == nil {
		return Intent{}
	}
	return Intent{ID: value.ID, ClientSecret: value.ClientSecret, AmountCents: value.Amount, Currency: string(value.Currency), Status: string(value.Status)}
}

var _ Gateway = (*StripeGateway)(nil)
