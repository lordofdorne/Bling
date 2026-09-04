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

type Account struct {
	CreatorID        string    `json:"-"`
	StripeAccountID  string    `json:"-"`
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
	ChargesEnabled     bool     `json:"chargesEnabled"`
	PayoutsEnabled     bool     `json:"payoutsEnabled"`
	DetailsSubmitted   bool     `json:"detailsSubmitted"`
	Ready              bool     `json:"ready"`
	RequirementsDue    []string `json:"requirementsDue"`
	PlatformFeePercent int      `json:"platformFeePercent"`
}

type StripeAccount struct {
	ID               string
	ChargesEnabled   bool
	PayoutsEnabled   bool
	DetailsSubmitted bool
	RequirementsDue  []string
}

type Gateway interface {
	CreateExpressAccount(context.Context, string, string, string) (StripeAccount, error)
	RetrieveAccount(context.Context, string) (StripeAccount, error)
	CreateOnboardingLink(context.Context, string, string, string) (string, error)
}

type Repository interface {
	ByCreator(context.Context, string) (Account, error)
	ByStripeAccountID(context.Context, string) (Account, error)
	Upsert(context.Context, string, StripeAccount, time.Time) (Account, error)
}
