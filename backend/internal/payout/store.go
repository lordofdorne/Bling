package payout

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const accountColumns = `creator_id,stripe_account_id,transfers_status,bank_payouts_status,external_account_present,external_account_bank_name,external_account_last4,external_account_currency,charges_enabled,payouts_enabled,details_submitted,requirements_due,created_at,updated_at`

func scanAccount(row pgx.Row) (Account, error) {
	var value Account
	var bankName, bankLast4, bankCurrency sql.NullString
	err := row.Scan(&value.CreatorID, &value.StripeAccountID, &value.TransfersStatus, &value.BankPayoutsStatus, &value.ExternalAccountPresent, &bankName, &bankLast4, &bankCurrency, &value.ChargesEnabled, &value.PayoutsEnabled, &value.DetailsSubmitted, &value.RequirementsDue, &value.CreatedAt, &value.UpdatedAt)
	value.ExternalAccountBankName = bankName.String
	value.ExternalAccountLast4 = bankLast4.String
	value.ExternalAccountCurrency = bankCurrency.String
	return value, err
}

func (r *PostgresRepository) ByCreator(ctx context.Context, creatorID string) (Account, error) {
	value, err := scanAccount(r.pool.QueryRow(ctx, `SELECT `+accountColumns+` FROM creator_payout_accounts WHERE creator_id=$1`, creatorID))
	return value, mapAccountError("find creator payout account", err)
}

func (r *PostgresRepository) ByStripeAccountID(ctx context.Context, accountID string) (Account, error) {
	value, err := scanAccount(r.pool.QueryRow(ctx, `SELECT `+accountColumns+` FROM creator_payout_accounts WHERE stripe_account_id=$1`, accountID))
	return value, mapAccountError("find Stripe payout account", err)
}

func (r *PostgresRepository) Upsert(ctx context.Context, creatorID string, stripeAccount StripeAccount, now time.Time) (Account, error) {
	value, err := scanAccount(r.pool.QueryRow(ctx, `
		INSERT INTO creator_payout_accounts
			(creator_id,stripe_account_id,transfers_status,bank_payouts_status,external_account_present,external_account_bank_name,external_account_last4,external_account_currency,charges_enabled,payouts_enabled,details_submitted,requirements_due,created_at,updated_at)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10,$11,$12,$13,$13)
		ON CONFLICT (creator_id) DO UPDATE SET
			stripe_account_id=creator_payout_accounts.stripe_account_id,
			transfers_status=EXCLUDED.transfers_status,
			bank_payouts_status=EXCLUDED.bank_payouts_status,
			external_account_present=EXCLUDED.external_account_present,
			external_account_bank_name=EXCLUDED.external_account_bank_name,
			external_account_last4=EXCLUDED.external_account_last4,
			external_account_currency=EXCLUDED.external_account_currency,
			charges_enabled=EXCLUDED.charges_enabled,
			payouts_enabled=EXCLUDED.payouts_enabled,
			details_submitted=EXCLUDED.details_submitted,
			requirements_due=EXCLUDED.requirements_due,
			updated_at=EXCLUDED.updated_at
		RETURNING `+accountColumns, creatorID, stripeAccount.ID, stripeAccount.TransfersStatus, stripeAccount.BankPayoutsStatus, stripeAccount.ExternalAccountPresent, stripeAccount.ExternalAccountBankName, stripeAccount.ExternalAccountLast4, stripeAccount.ExternalAccountCurrency, stripeAccount.ChargesEnabled, stripeAccount.PayoutsEnabled, stripeAccount.DetailsSubmitted, stripeAccount.RequirementsDue, now))
	if err != nil {
		return Account{}, fmt.Errorf("save creator payout account: %w", err)
	}
	return value, nil
}

func mapAccountError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAccountNotFound
	}
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}
