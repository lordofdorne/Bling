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
	ErrDisabled               = errors.New("payments are not configured")
	ErrShowNotLive            = errors.New("show is not live")
	ErrTierNotFound           = errors.New("payment tier not found")
	ErrFreeTier               = errors.New("free tier does not require payment")
	ErrAttemptNotFound        = errors.New("payment attempt not found")
	ErrAuthorization          = errors.New("payment is not authorized")
	ErrAuthorizationUsed      = errors.New("payment authorization is already in use")
	ErrCaptureFailed          = errors.New("payment capture failed")
	ErrPaymentProfileNotFound = errors.New("payment profile not found")
	ErrPaymentMethodNotFound  = errors.New("payment method not found")
)

const PlatformFeeBPS int64 = 3000

type Flow string

const (
	FlowDestination Flow = "DESTINATION"
	FlowPlatform    Flow = "PLATFORM"
)

type Attempt struct {
	ID                    string     `json:"id"`
	ShowID                string     `json:"showId"`
	TierID                string     `json:"tierId"`
	QueueEntryID          *string    `json:"queueEntryId,omitempty"`
	StripePaymentIntentID string     `json:"-"`
	PayerUserID           string     `json:"-"`
	StripeCustomerID      string     `json:"-"`
	DestinationAccountID  string     `json:"-"`
	Flow                  Flow       `json:"-"`
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
	AttemptID                   string `json:"attemptId"`
	ClientSecret                string `json:"clientSecret"`
	PublishableKey              string `json:"publishableKey"`
	AmountCents                 int64  `json:"amountCents"`
	Currency                    string `json:"currency"`
	CustomerSessionClientSecret string `json:"customerSessionClientSecret,omitempty"`
}

type PrepareInput struct {
	ShowID             string
	TierID             string
	ViewerTokenHash    []byte
	IdempotencyKeyHash []byte
	PayerUserID        string
	PayerEmail         string
	StripeCustomerID   string
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

type PaymentProfile struct {
	UserID           string
	StripeCustomerID string
}

type SavedPaymentMethod struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Brand    string `json:"brand"`
	Last4    string `json:"last4"`
	ExpMonth int64  `json:"expMonth"`
	ExpYear  int64  `json:"expYear"`
}

type PaymentMethodSetup struct {
	ClientSecret                string `json:"clientSecret"`
	CustomerSessionClientSecret string `json:"customerSessionClientSecret"`
	PublishableKey              string `json:"publishableKey"`
}

type CustomerGateway interface {
	CreateCustomer(context.Context, string, string) (string, error)
	CreateCustomerSession(context.Context, string, bool) (string, error)
	CreateSetupIntent(context.Context, string, string) (string, error)
	ListPaymentMethods(context.Context, string, int64) ([]SavedPaymentMethod, error)
	DetachPaymentMethod(context.Context, string) error
}

type CustomerRepository interface {
	PaymentProfileByUser(context.Context, string) (PaymentProfile, error)
	SavePaymentProfile(context.Context, string, string, time.Time) (PaymentProfile, error)
}

type SavedMethodAuditRepository interface {
	RecordSavedPaymentMethod(context.Context, string, string, string, time.Time) error
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
