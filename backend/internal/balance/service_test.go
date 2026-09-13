package balance

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

type fakeRepository struct {
	created int
	claimed int
	paid    string
	retried string
}

func (r *fakeRepository) Summary(context.Context, string, string, time.Time) (Summary, error) {
	return Summary{TotalCents: 700, PendingCents: 700}, nil
}
func (r *fakeRepository) Entries(context.Context, string, string, int) ([]Entry, error) {
	return []Entry{}, nil
}
func (r *fakeRepository) CreateMonthlyRun(context.Context, time.Time, time.Time, string, int64, time.Time) error {
	r.created++
	return nil
}
func (r *fakeRepository) ClaimTransfers(context.Context, time.Time, int) ([]TransferRequest, error) {
	if r.claimed > 0 {
		return nil, nil
	}
	r.claimed++
	return []TransferRequest{{ItemID: "item-1", IdempotencyKey: "key-1"}}, nil
}
func (r *fakeRepository) MarkPaid(_ context.Context, _ string, id string, _ time.Time) error {
	r.paid = id
	return nil
}
func (r *fakeRepository) MarkRetry(_ context.Context, _ TransferRequest, code string, _ time.Time) error {
	r.retried = code
	return nil
}
func (r *fakeRepository) FinishRuns(context.Context, time.Time) error { return nil }

type fakeGateway struct{ calls int }

func (g *fakeGateway) Transfer(context.Context, TransferRequest) (TransferResult, error) {
	g.calls++
	return TransferResult{ID: "tr_1"}, nil
}

func TestRunDueCreatesAndPaysOneIdempotentItem(t *testing.T) {
	repository := &fakeRepository{}
	gateway := &fakeGateway{}
	service := NewService(repository, gateway, "usd", 2500, 1, true, slog.New(slog.NewTextHandler(io.Discard, nil)))
	service.now = func() time.Time { return time.Date(2026, 9, 1, 2, 0, 0, 0, time.UTC) }
	service.runDue(context.Background())
	if repository.created != 1 || gateway.calls != 1 || repository.paid != "tr_1" {
		t.Fatalf("repository=%+v calls=%d", repository, gateway.calls)
	}
}

func TestNextPayoutMovesPastThisMonthsRun(t *testing.T) {
	now := time.Date(2026, 9, 1, 2, 0, 0, 0, time.UTC)
	got := nextPayout(now, 1)
	if !got.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("next payout=%v", got)
	}
}
