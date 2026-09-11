package payout

import (
	"testing"

	stripe "github.com/stripe/stripe-go/v85"
)

func entry(from stripe.V2CoreAccountRequirementsEntryAwaitingActionFrom, deadline, description string) *stripe.V2CoreAccountRequirementsEntry {
	e := &stripe.V2CoreAccountRequirementsEntry{AwaitingActionFrom: from, Description: description}
	if deadline != "" {
		e.MinimumDeadline = &stripe.V2CoreAccountRequirementsEntryMinimumDeadline{
			Status: stripe.V2CoreAccountRequirementsEntryMinimumDeadlineStatus(deadline),
		}
	}
	return e
}

func v2Account(id, status string, entries ...*stripe.V2CoreAccountRequirementsEntry) *stripe.V2CoreAccount {
	return &stripe.V2CoreAccount{
		ID: id,
		Configuration: &stripe.V2CoreAccountConfiguration{
			Recipient: &stripe.V2CoreAccountConfigurationRecipient{
				Capabilities: &stripe.V2CoreAccountConfigurationRecipientCapabilities{
					StripeBalance: &stripe.V2CoreAccountConfigurationRecipientCapabilitiesStripeBalance{
						StripeTransfers: &stripe.V2CoreAccountConfigurationRecipientCapabilitiesStripeBalanceStripeTransfers{
							Status: stripe.V2CoreAccountConfigurationRecipientCapabilitiesStripeBalanceStripeTransfersStatus(status),
						},
					},
				},
			},
		},
		Requirements: &stripe.V2CoreAccountRequirements{Entries: entries},
	}
}

func TestStripeAccountReadsTransfersCapability(t *testing.T) {
	for _, status := range []string{TransfersStatusActive, TransfersStatusPending, TransfersStatusRestricted, TransfersStatusUnsupported} {
		t.Run(status, func(t *testing.T) {
			account := stripeAccount(v2Account("acct_1", status))
			if account.TransfersStatus != status {
				t.Fatalf("transfersStatus=%q, want %q", account.TransfersStatus, status)
			}
			active := status == TransfersStatusActive
			if account.PayoutsEnabled != active || account.ChargesEnabled != active {
				t.Fatalf("status=%q payouts=%v charges=%v", status, account.PayoutsEnabled, account.ChargesEnabled)
			}
		})
	}
}

// A response without the requested includes must not read as a ready account.
// Forgetting the include parameter is the easiest way to get this wrong.
func TestStripeAccountWithoutConfigurationIsNotReady(t *testing.T) {
	account := stripeAccount(&stripe.V2CoreAccount{ID: "acct_1"})
	if account.TransfersStatus != "" || account.PayoutsEnabled || account.ChargesEnabled {
		t.Fatalf("account=%+v", account)
	}
	if account.RequirementsDue == nil {
		t.Fatal("requirementsDue must be an empty slice, not nil")
	}
}

// Requirements Stripe is still processing are not the creator's to act on, so
// they must not be shown as outstanding or block onboarding completion.
func TestStripeAccountOnlySurfacesUserFacingRequirements(t *testing.T) {
	account := stripeAccount(v2Account("acct_1", TransfersStatusActive,
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromStripe, "currently_due", "stripe_is_verifying"),
	))
	if len(account.RequirementsDue) != 0 {
		t.Fatalf("requirementsDue=%v", account.RequirementsDue)
	}
	if !account.DetailsSubmitted {
		t.Fatal("a Stripe-side requirement must not mark details outstanding")
	}
}

func TestStripeAccountSurfacesCreatorRequirements(t *testing.T) {
	account := stripeAccount(v2Account("acct_1", TransfersStatusRestricted,
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser, "currently_due", "external_account"),
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromStripe, "currently_due", "stripe_is_verifying"),
	))
	if len(account.RequirementsDue) != 1 || account.RequirementsDue[0] != "external_account" {
		t.Fatalf("requirementsDue=%v", account.RequirementsDue)
	}
	if account.DetailsSubmitted {
		t.Fatal("an outstanding creator requirement must clear detailsSubmitted")
	}
}

func TestStripeAccountHandlesNil(t *testing.T) {
	if account := stripeAccount(nil); account.ID != "" || account.PayoutsEnabled {
		t.Fatalf("account=%+v", account)
	}
}

// Stripe leaves eventually_due identity fields outstanding on freshly onboarded
// recipients while transfers are already active. Treating those as incomplete
// bounced a creator who had just finished onboarding back to the setup screen.
func TestEventuallyDueRequirementsDoNotBlockAFreshlyOnboardedCreator(t *testing.T) {
	account := stripeAccount(v2Account("acct_1", TransfersStatusActive,
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser, "eventually_due", "identity.individual.date_of_birth.day"),
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser, "eventually_due", "identity.individual.id_numbers.us_ssn_last_4"),
	))
	if !account.DetailsSubmitted {
		t.Fatal("eventually_due requirements must not mark onboarding incomplete")
	}
	stored := Account{StripeAccountID: account.ID, ChargesEnabled: account.ChargesEnabled, PayoutsEnabled: account.PayoutsEnabled, DetailsSubmitted: account.DetailsSubmitted}
	if !stored.Ready() {
		t.Fatal("an account with active transfers and only eventually_due items must be ready")
	}
	// They are still surfaced so the dashboard can nudge before the deadline.
	if len(account.RequirementsDue) != 2 {
		t.Fatalf("requirementsDue=%v", account.RequirementsDue)
	}
}

func TestCurrentlyDueAndPastDueRequirementsBlock(t *testing.T) {
	for _, deadline := range []string{"currently_due", "past_due"} {
		t.Run(deadline, func(t *testing.T) {
			account := stripeAccount(v2Account("acct_1", TransfersStatusActive,
				entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser, deadline, "external_account"),
			))
			if account.DetailsSubmitted {
				t.Fatalf("%s requirement must block readiness", deadline)
			}
		})
	}
}

// An entry with no deadline has unknown urgency and must fail closed.
func TestRequirementWithoutDeadlineBlocks(t *testing.T) {
	account := stripeAccount(v2Account("acct_1", TransfersStatusActive,
		entry(stripe.V2CoreAccountRequirementsEntryAwaitingActionFromUser, "", "unknown_requirement"),
	))
	if account.DetailsSubmitted {
		t.Fatal("a requirement with no deadline must fail closed")
	}
}
