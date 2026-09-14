package payment

import (
	"context"

	stripe "github.com/stripe/stripe-go/v85"
	"github.com/stripe/stripe-go/v85/customer"
	"github.com/stripe/stripe-go/v85/customersession"
	"github.com/stripe/stripe-go/v85/paymentintent"
	"github.com/stripe/stripe-go/v85/paymentmethod"
	"github.com/stripe/stripe-go/v85/setupintent"
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
		PaymentMethodTypes: stripe.StringSlice([]string{"card", "link"}),
		Description:        stripe.String("Bling Hotline call"),
	}
	if attempt.StripeCustomerID != "" {
		params.Customer = stripe.String(attempt.StripeCustomerID)
	}
	if attempt.Flow != FlowPlatform {
		params.ApplicationFeeAmount = stripe.Int64(attempt.PlatformFeeCents)
		params.TransferData = &stripe.PaymentIntentTransferDataParams{Destination: stripe.String(attempt.DestinationAccountID)}
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

func (g *StripeGateway) CreateCustomer(ctx context.Context, userID, email string) (string, error) {
	params := &stripe.CustomerParams{Email: stripe.String(email), Description: stripe.String("Bling caller")}
	params.Context = ctx
	params.AddMetadata("bling_user_id", userID)
	params.SetIdempotencyKey("bling-customer-" + userID)
	value, err := customer.New(params)
	if err != nil {
		return "", err
	}
	return value.ID, nil
}

func (g *StripeGateway) CreateCustomerSession(ctx context.Context, customerID string, allowSave bool) (string, error) {
	features := &stripe.CustomerSessionComponentsPaymentElementFeaturesParams{
		PaymentMethodRedisplay:      stripe.String("enabled"),
		PaymentMethodRedisplayLimit: stripe.Int64(5),
		PaymentMethodRemove:         stripe.String("enabled"),
	}
	if allowSave {
		features.PaymentMethodSave = stripe.String("enabled")
		features.PaymentMethodSaveUsage = stripe.String("on_session")
	}
	params := &stripe.CustomerSessionParams{
		Customer: stripe.String(customerID),
		Components: &stripe.CustomerSessionComponentsParams{
			PaymentElement: &stripe.CustomerSessionComponentsPaymentElementParams{
				Enabled:  stripe.Bool(true),
				Features: features,
			},
		},
	}
	params.Context = ctx
	value, err := customersession.New(params)
	if err != nil {
		return "", err
	}
	return value.ClientSecret, nil
}

func (g *StripeGateway) CreateSetupIntent(ctx context.Context, customerID, idempotencyKey string) (string, error) {
	params := &stripe.SetupIntentParams{
		Customer:           stripe.String(customerID),
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		Usage:              stripe.String("on_session"),
		Description:        stripe.String("Save a payment method for future Bling calls"),
	}
	params.Context = ctx
	params.SetIdempotencyKey(idempotencyKey)
	value, err := setupintent.New(params)
	if err != nil {
		return "", err
	}
	return value.ClientSecret, nil
}

func (g *StripeGateway) ListPaymentMethods(ctx context.Context, customerID string, limit int64) ([]SavedPaymentMethod, error) {
	params := &stripe.PaymentMethodListParams{Customer: stripe.String(customerID), Type: stripe.String("card")}
	params.Context = ctx
	params.Limit = stripe.Int64(limit)
	iterator := paymentmethod.List(params)
	methods := make([]SavedPaymentMethod, 0)
	for iterator.Next() {
		value := iterator.PaymentMethod()
		if value.Card == nil || value.AllowRedisplay != stripe.PaymentMethodAllowRedisplayAlways {
			continue
		}
		methods = append(methods, SavedPaymentMethod{
			ID: value.ID, Type: "card", Brand: string(value.Card.Brand), Last4: value.Card.Last4,
			ExpMonth: value.Card.ExpMonth, ExpYear: value.Card.ExpYear,
		})
	}
	if err := iterator.Err(); err != nil {
		return nil, err
	}
	return methods, nil
}

func (g *StripeGateway) DetachPaymentMethod(ctx context.Context, paymentMethodID string) error {
	params := &stripe.PaymentMethodDetachParams{}
	params.Context = ctx
	_, err := paymentmethod.Detach(paymentMethodID, params)
	return err
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
	destinationID := ""
	if value.TransferData != nil && value.TransferData.Destination != nil {
		destinationID = value.TransferData.Destination.ID
	}
	return Intent{ID: value.ID, ClientSecret: value.ClientSecret, AmountCents: value.Amount, Currency: string(value.Currency), Status: string(value.Status), DestinationAccountID: destinationID, ApplicationFeeAmount: value.ApplicationFeeAmount}
}

var _ Gateway = (*StripeGateway)(nil)
var _ CustomerGateway = (*StripeGateway)(nil)
