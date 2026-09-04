package payment

import (
	"context"
	"errors"
	"time"
)

type Status string

const (
	StatusCreated    Status = "CREATED"
	StatusAuthorized Status = "AUTHORIZED"
	StatusCapturing  Status = "CAPTURING"
	StatusCaptured   Status = "CAPTURED"
	StatusCanceled   Status = "CANCELED"
	StatusFailed     Status = "FAILED"
)

var (
	ErrDisabled          = errors.New("payments are not configured")
	ErrShowNotLive       = errors.New("show is not live")
	ErrTierNotFound      = errors.New("payment tier not found")
	ErrFreeTier          = errors.New("free tier does not require payment")
	ErrAttemptNotFound   = errors.New("payment attempt not found")
	ErrAuthorization     = errors.New("payment is not authorized")
	ErrAuthorizationUsed = errors.New("payment authorization is already in use")
	ErrCaptureFailed     = errors.New("payment capture failed")
	ErrPayoutsNotReady   = errors.New("creator payouts are not ready")
)

const PlatformFeeBPS int64 = 3000

type Attempt struct {
	ID                    string     `json:"id"`
	ShowID                string     `json:"showId"`
	TierID                string     `json:"tierId"`
	QueueEntryID          *string    `json:"queueEntryId,omitempty"`
	StripePaymentIntentID string     `json:"-"`
	DestinationAccountID  string     `json:"-"`
	AmountCents           int64      `json:"amountCents"`
	PlatformFeeBPS        int64      `json:"platformFeeBps"`
	PlatformFeeCents      int64      `json:"platformFeeCents"`
	Currency              string     `json:"currency"`
	Status                Status     `json:"status"`
	AuthorizedAt          *time.Time `json:"authorizedAt,omitempty"`
	CapturedAt            *time.Time `json:"capturedAt,omitempty"`
	CanceledAt            *time.Time `json:"canceledAt,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

type Authorization struct {
	AttemptID      string `json:"attemptId"`
	ClientSecret   string `json:"clientSecret"`
	PublishableKey string `json:"publishableKey"`
	AmountCents    int64  `json:"amountCents"`
	Currency       string `json:"currency"`
}

type PrepareInput struct {
	ShowID             string
	TierID             string
	ViewerTokenHash    []byte
	IdempotencyKeyHash []byte
}

type Intent struct {
	ID                   string
	ClientSecret         string
	AmountCents          int64
	Currency             string
	Status               string
	DestinationAccountID string
	ApplicationFeeAmount int64
}

type Gateway interface {
	CreateAuthorization(context.Context, Attempt) (Intent, error)
	Retrieve(context.Context, string) (Intent, error)
	Capture(context.Context, string, string) (Intent, error)
	Cancel(context.Context, string, string) error
}

type Repository interface {
	Prepare(context.Context, PrepareInput, time.Time) (Attempt, error)
	AttachIntent(context.Context, string, string, time.Time) error
	FindForViewer(context.Context, string, string, []byte) (Attempt, error)
	MarkAuthorized(context.Context, string, time.Time) error
	MarkFailed(context.Context, string, string, time.Time) error
	MarkCanceled(context.Context, string, time.Time) error
	Reconcile(context.Context, string, Status, string, time.Time) error
}
