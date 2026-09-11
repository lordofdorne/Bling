package payout

import (
	"context"
	"errors"
	"time"
)

var (
	ErrDisabled        = errors.New("creator payouts are not configured")
	ErrAccountNotFound = errors.New("creator payout account not found")
)

// Account is the stored projection of a Stripe connected account.
//
// Bling creates Accounts v2 recipient accounts: Bling stays merchant of record
// for every call, and the creator only ever receives transfers. The v2 API
// reports one capability that matters here, stripe_balance.stripe_transfers,
// which TransfersStatus records verbatim.
//
// ChargesEnabled, PayoutsEnabled and DetailsSubmitted are kept because the
// paid-call readiness predicate is inlined in payment, queue and show SQL. They
// are now derived from the v2 capability rather than read from v1 fields:
// a recipient account never accepts charges itself, so ChargesEnabled mirrors
// the transfers capability instead of describing a capability of its own.
type Account struct {
	CreatorID        string    `json:"-"`
	StripeAccountID  string    `json:"-"`
	TransfersStatus  string    `json:"transfersStatus"`
	ChargesEnabled   bool      `json:"chargesEnabled"`
	PayoutsEnabled   bool      `json:"payoutsEnabled"`
	DetailsSubmitted bool      `json:"detailsSubmitted"`
	RequirementsDue  []string  `json:"requirementsDue"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func (a Account) Ready() bool {
	return a.StripeAccountID != "" && a.ChargesEnabled && a.PayoutsEnabled && a.DetailsSubmitted
}

type Status struct {
	Connected          bool     `json:"connected"`
	TransfersStatus    string   `json:"transfersStatus"`
	ChargesEnabled     bool     `json:"chargesEnabled"`
	PayoutsEnabled     bool     `json:"payoutsEnabled"`
	DetailsSubmitted   bool     `json:"detailsSubmitted"`
	Ready              bool     `json:"ready"`
	RequirementsDue    []string `json:"requirementsDue"`
	PlatformFeePercent int      `json:"platformFeePercent"`
}

// StripeAccount is the gateway-facing view of a connected account.
type StripeAccount struct {
	ID string
	// TransfersStatus is the raw v2 capability status: active, pending,
	// restricted or unsupported. Only "active" permits paid calls.
	TransfersStatus  string
	ChargesEnabled   bool
	PayoutsEnabled   bool
	DetailsSubmitted bool
	RequirementsDue  []string
}

// TransfersActive reports whether Stripe will accept transfers to this account.
func (s StripeAccount) TransfersActive() bool { return s.TransfersStatus == TransfersStatusActive }

// Stripe v2 stripe_balance.stripe_transfers capability statuses.
const (
	TransfersStatusActive      = "active"
	TransfersStatusPending     = "pending"
	TransfersStatusRestricted  = "restricted"
	TransfersStatusUnsupported = "unsupported"
)

type Gateway interface {
	CreateConnectedAccount(context.Context, string, string, string) (StripeAccount, error)
	RetrieveAccount(context.Context, string) (StripeAccount, error)
	CreateOnboardingLink(context.Context, string, string, string) (string, error)
}

type Repository interface {
	ByCreator(context.Context, string) (Account, error)
	ByStripeAccountID(context.Context, string) (Account, error)
	Upsert(context.Context, string, StripeAccount, time.Time) (Account, error)
}
