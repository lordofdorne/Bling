package payout

import (
	"context"

	stripe "github.com/stripe/stripe-go/v85"
)

// StripeGateway talks to the Accounts v2 API.
//
// Stripe rejects v1 account creation (POST /v1/accounts with type=express) for
// new Connect integrations, so connected accounts are created through
// POST /v2/core/accounts. The v2 services are only reachable from a
// stripe.Client, not the deprecated package-level key, so this gateway owns one.
type StripeGateway struct{ client *stripe.Client }

func NewStripeGateway(secretKey string) *StripeGateway {
	return &StripeGateway{client: stripe.NewClient(secretKey)}
}

// accountIncludes asks for the fields the payout projection needs. A v2 account
// response omits configuration and requirements unless they are requested, so
// leaving these out silently yields an account that always looks unverified.
var accountIncludes = []*string{
	stripe.String("configuration.recipient"),
	stripe.String("requirements"),
}

// CreateConnectedAccount creates a recipient account for a creator.
//
// Bling is a marketplace: it runs checkout, is merchant of record, and takes an
// creator share later with separate charges and transfers. That maps to a recipient
// configuration requesting only the transfers capability, no Stripe dashboard,
// and platform responsibility for both fees and losses. Requesting a merchant
// configuration here would be wrong and would lengthen onboarding.
func (g *StripeGateway) CreateConnectedAccount(ctx context.Context, creatorID, email, country string) (StripeAccount, error) {
	params := &stripe.V2CoreAccountCreateParams{
		ContactEmail: stripe.String(email),
		DisplayName:  stripe.String(email),
		Dashboard:    stripe.String("none"),
		Identity: &stripe.V2CoreAccountCreateIdentityParams{
			Country: stripe.String(country),
		},
		Defaults: &stripe.V2CoreAccountCreateDefaultsParams{
			Responsibilities: &stripe.V2CoreAccountCreateDefaultsResponsibilitiesParams{
				FeesCollector:   stripe.String("application"),
				LossesCollector: stripe.String("application"),
			},
		},
		Configuration: &stripe.V2CoreAccountCreateConfigurationParams{
			Recipient: &stripe.V2CoreAccountCreateConfigurationRecipientParams{
				Capabilities: &stripe.V2CoreAccountCreateConfigurationRecipientCapabilitiesParams{
					StripeBalance: &stripe.V2CoreAccountCreateConfigurationRecipientCapabilitiesStripeBalanceParams{
						StripeTransfers: &stripe.V2CoreAccountCreateConfigurationRecipientCapabilitiesStripeBalanceStripeTransfersParams{
							Requested: stripe.Bool(true),
						},
					},
				},
			},
		},
		Include: accountIncludes,
	}
	params.AddMetadata("bling_creator_id", creatorID)
	params.SetIdempotencyKey("bling-connect-account-v2-" + creatorID)

	value, err := g.client.V2CoreAccounts.Create(ctx, params)
	if err != nil {
		return StripeAccount{}, err
	}
	return stripeAccount(value), nil
}

func (g *StripeGateway) CreateAccountSession(ctx context.Context, accountID string) (string, error) {
	value, err := g.client.V1AccountSessions.Create(ctx, &stripe.AccountSessionCreateParams{
		Account: stripe.String(accountID),
		Components: &stripe.AccountSessionCreateComponentsParams{
			AccountOnboarding: &stripe.AccountSessionCreateComponentsAccountOnboardingParams{
				Enabled: stripe.Bool(true),
				Features: &stripe.AccountSessionCreateComponentsAccountOnboardingFeaturesParams{
					ExternalAccountCollection: stripe.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return "", err
	}
	return value.ClientSecret, nil
}

func (g *StripeGateway) RetrieveAccount(ctx context.Context, id string) (StripeAccount, error) {
	value, err := g.client.V2CoreAccounts.Retrieve(ctx, id, &stripe.V2CoreAccountRetrieveParams{Include: accountIncludes})
	if err != nil {
		return StripeAccount{}, err
	}
	return stripeAccount(value), nil
}

// CreateOnboardingLink returns a single-use Stripe-hosted onboarding URL.
func (g *StripeGateway) CreateOnboardingLink(ctx context.Context, accountID, refreshURL, returnURL string) (string, error) {
	value, err := g.client.V2CoreAccountLinks.Create(ctx, &stripe.V2CoreAccountLinkCreateParams{
		Account: stripe.String(accountID),
		UseCase: &stripe.V2CoreAccountLinkCreateUseCaseParams{
			Type: stripe.String("account_onboarding"),
			AccountOnboarding: &stripe.V2CoreAccountLinkCreateUseCaseAccountOnboardingParams{
				Configurations: []*string{stripe.String("recipient")},
				RefreshURL:     stripe.String(refreshURL),
				ReturnURL:      stripe.String(returnURL),
			},
		},
	})
	if err != nil {
		return "", err
	}
	return value.URL, nil
}

// stripeAccount projects a v2 account onto the stored payout model.
func stripeAccount(value *stripe.V2CoreAccount) StripeAccount {
	if value == nil {
		return StripeAccount{}
	}

	account := StripeAccount{ID: value.ID, TransfersStatus: transfersStatus(value), RequirementsDue: []string{}}

	// Requirements Stripe is still working through are not the creator's to act
	// on, so only user-facing entries are surfaced.
	//
	// Only a currently_due or past_due entry actually blocks. Stripe routinely
	// leaves eventually_due entries (date of birth, SSN last 4) outstanding on a
	// freshly onboarded recipient while reporting transfers as active; treating
	// those as incomplete sends a creator who just finished onboarding straight
	// back to the setup screen, forever.
	blocked := false
	if value.Requirements != nil {
		for _, entry := range value.Requirements.Entries {
			if entry == nil || entry.AwaitingActionFrom != stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser {
				continue
			}
			if entry.Description != "" {
				account.RequirementsDue = append(account.RequirementsDue, entry.Description)
			}
			if requirementBlocks(entry) {
				blocked = true
			}
		}
	}

	// A recipient account never accepts charges itself; ChargesEnabled remains
	// as a compatibility field for older clients.
	active := account.TransfersActive()
	account.ChargesEnabled = active
	account.PayoutsEnabled = active
	account.DetailsSubmitted = !blocked

	return account
}

// requirementBlocks reports whether an outstanding requirement restricts the
// account today. An entry with no deadline is treated as blocking: an unknown
// urgency should fail closed rather than silently admit paid callers.
func requirementBlocks(entry *stripe.V2CoreAccountRequirementsEntry) bool {
	if entry.MinimumDeadline == nil {
		return true
	}
	switch entry.MinimumDeadline.Status {
	case stripe.V2CoreAccountRequirementsEntryMinimumDeadlineStatusCurrentlyDue,
		stripe.V2CoreAccountRequirementsEntryMinimumDeadlineStatusPastDue:
		return true
	default:
		return false
	}
}

func transfersStatus(value *stripe.V2CoreAccount) string {
	if value.Configuration == nil || value.Configuration.Recipient == nil {
		return ""
	}
	capabilities := value.Configuration.Recipient.Capabilities
	if capabilities == nil || capabilities.StripeBalance == nil || capabilities.StripeBalance.StripeTransfers == nil {
		return ""
	}
	return string(capabilities.StripeBalance.StripeTransfers.Status)
}

var _ Gateway = (*StripeGateway)(nil)
