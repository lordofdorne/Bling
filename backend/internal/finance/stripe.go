package finance

import (
	"context"
	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/refund"
)

type StripeGateway struct{}

func NewStripeGateway(secretKey string) *StripeGateway {
	stripe.Key = secretKey
	return &StripeGateway{}
}

func (g *StripeGateway) Refund(ctx context.Context, request RefundRequest) (RefundResult, error) {
	params := &stripe.RefundParams{
		PaymentIntent:        stripe.String(request.StripePaymentIntentID),
		ReverseTransfer:      stripe.Bool(true),
		RefundApplicationFee: stripe.Bool(true),
	}
	params.Context = ctx
	params.SetIdempotencyKey("bling-refund-" + request.ID)
	params.AddMetadata("bling_refund_request_id", request.ID)
	params.AddMetadata("bling_payment_attempt_id", request.PaymentAttemptID)
	params.AddMetadata("bling_call_id", request.CallID)
	value, err := refund.New(params)
	if err != nil {
		return RefundResult{}, err
	}
	return RefundResult{ID: value.ID, Status: RefundStatusFromStripe(string(value.Status)), FailureCode: string(value.FailureReason)}, nil
}

var _ Gateway = (*StripeGateway)(nil)
