package payout

import (
	"database/sql"
	"testing"
)

type rowFunc func(...any) error

func (f rowFunc) Scan(dest ...any) error { return f(dest...) }

func TestScanAccountAcceptsMissingBankDetails(t *testing.T) {
	account, err := scanAccount(rowFunc(func(dest ...any) error {
		for _, index := range []int{5, 6, 7} {
			*(dest[index].(*sql.NullString)) = sql.NullString{}
		}
		return nil
	}))
	if err != nil {
		t.Fatalf("scan account: %v", err)
	}
	if account.ExternalAccountBankName != "" || account.ExternalAccountLast4 != "" || account.ExternalAccountCurrency != "" {
		t.Fatalf("expected empty bank summary, got %#v", account)
	}
}
