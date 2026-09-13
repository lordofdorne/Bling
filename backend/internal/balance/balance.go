package balance

import (
	"context"
	"time"
)

type Summary struct {
	Currency       string     `json:"currency"`
	TotalCents     int64      `json:"totalCents"`
	PendingCents   int64      `json:"pendingCents"`
	AvailableCents int64      `json:"availableCents"`
	NextPayoutAt   *time.Time `json:"nextPayoutAt,omitempty"`
}

type Entry struct {
	ID          int64     `json:"id"`
	Kind        string    `json:"kind"`
	AmountCents int64     `json:"amountCents"`
	Currency    string    `json:"currency"`
	EffectiveAt time.Time `json:"effectiveAt"`
	CreatedAt   time.Time `json:"createdAt"`
}

type TransferRequest struct {
	ItemID               string
	CreatorID            string
	DestinationAccountID string
	AmountCents          int64
	Currency             string
	IdempotencyKey       string
	Attempts             int
}

type TransferResult struct{ ID string }

type Repository interface {
	Summary(context.Context, string, string, time.Time) (Summary, error)
	Entries(context.Context, string, string, int) ([]Entry, error)
	CreateMonthlyRun(context.Context, time.Time, time.Time, string, int64, time.Time) error
	ClaimTransfers(context.Context, time.Time, int) ([]TransferRequest, error)
	MarkPaid(context.Context, string, string, time.Time) error
	MarkRetry(context.Context, TransferRequest, string, time.Time) error
	FinishRuns(context.Context, time.Time) error
}

type Gateway interface {
	Transfer(context.Context, TransferRequest) (TransferResult, error)
}
