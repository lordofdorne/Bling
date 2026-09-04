package finance

import (
	"context"
	"strings"
	"time"
)

func RefundStatusFromStripe(status string) RefundStatus {
	switch strings.ToLower(status) {
	case "succeeded":
		return RefundSucceeded
	case "failed", "canceled":
		return RefundFailed
	default:
		return RefundPending
	}
}

type RefundStatus string

type EventClaim string

const (
	EventClaimed   EventClaim = "CLAIMED"
	EventProcessed EventClaim = "PROCESSED"
	EventBusy      EventClaim = "BUSY"
)

const (
	RefundRequested  RefundStatus = "REQUESTED"
	RefundProcessing RefundStatus = "PROCESSING"
	RefundRetry      RefundStatus = "RETRY"
	RefundPending    RefundStatus = "PENDING"
	RefundSucceeded  RefundStatus = "SUCCEEDED"
	RefundFailed     RefundStatus = "FAILED"
)

type RefundRequest struct {
	ID                    string
	PaymentAttemptID      string
	CallID                string
	StripePaymentIntentID string
	StripeRefundID        string
	AmountCents           int64
	Currency              string
	Reason                string
	Status                RefundStatus
	Attempts              int
}

type RefundResult struct {
	ID          string
	Status      RefundStatus
	FailureCode string
}

type Dispute struct {
	ID                    string
	StripePaymentIntentID string
	AmountCents           int64
	Currency              string
	Reason                string
	Status                string
	EvidenceDueAt         *time.Time
}

type Payout struct {
	ID              string
	StripeAccountID string
	AmountCents     int64
	Currency        string
	Status          string
	FailureCode     string
	FailureMessage  string
	ArrivalAt       *time.Time
}

type Activity struct {
	PaymentAttemptID string       `json:"paymentAttemptId"`
	AmountCents      int64        `json:"amountCents"`
	PlatformFeeCents int64        `json:"platformFeeCents"`
	Currency         string       `json:"currency"`
	PaymentStatus    string       `json:"paymentStatus"`
	RefundStatus     RefundStatus `json:"refundStatus,omitempty"`
	RefundReason     string       `json:"refundReason,omitempty"`
	DisputeStatus    string       `json:"disputeStatus,omitempty"`
	DisputeReason    string       `json:"disputeReason,omitempty"`
	CreatedAt        time.Time    `json:"createdAt"`
}

type PayoutFailure struct {
	PayoutID       string    `json:"payoutId"`
	AmountCents    int64     `json:"amountCents"`
	Currency       string    `json:"currency"`
	FailureCode    string    `json:"failureCode"`
	FailureMessage string    `json:"failureMessage"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type Gateway interface {
	Refund(context.Context, RefundRequest) (RefundResult, error)
}

type Repository interface {
	ClaimEvent(context.Context, string, string, string, time.Time) (EventClaim, error)
	CompleteEvent(context.Context, string, time.Time) error
	FailEvent(context.Context, string, string, time.Time) error
	ClaimRefunds(context.Context, time.Time, int) ([]RefundRequest, error)
	MarkRefundResult(context.Context, RefundRequest, RefundResult, time.Time) error
	MarkRefundRetry(context.Context, RefundRequest, string, time.Time) error
	ReconcileRefund(context.Context, string, string, RefundStatus, string, time.Time) error
	UpsertDispute(context.Context, Dispute, time.Time) error
	UpsertPayout(context.Context, Payout, time.Time) error
	ActivityForCreator(context.Context, string, int) ([]Activity, error)
	LatestPayoutFailure(context.Context, string) (*PayoutFailure, error)
}
