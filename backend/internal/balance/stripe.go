package balance

import (
	"context"

	stripe "github.com/stripe/stripe-go/v85"
	"github.com/stripe/stripe-go/v85/transfer"
)

type StripeGateway struct{}

func NewStripeGateway(secretKey string) *StripeGateway {
	stripe.Key = secretKey
	return &StripeGateway{}
}
func (g *StripeGateway) Transfer(ctx context.Context, request TransferRequest) (TransferResult, error) {
	params := &stripe.TransferParams{Amount: stripe.Int64(request.AmountCents), Currency: stripe.String(request.Currency), Destination: stripe.String(request.DestinationAccountID)}
	params.Context = ctx
	params.SetIdempotencyKey(request.IdempotencyKey)
	params.AddMetadata("bling_payout_item_id", request.ItemID)
	value, err := transfer.New(params)
	if err != nil {
		return TransferResult{}, err
	}
	return TransferResult{ID: value.ID}, nil
}

var _ Gateway = (*StripeGateway)(nil)
