package finance

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

type fakeRepository struct {
	requests  []RefundRequest
	result    RefundResult
	retryCode string
}

func (r *fakeRepository) ClaimEvent(context.Context, string, string, string, time.Time) (EventClaim, error) {
	return EventClaimed, nil
}
func (r *fakeRepository) CompleteEvent(context.Context, string, time.Time) error     { return nil }
func (r *fakeRepository) FailEvent(context.Context, string, string, time.Time) error { return nil }
func (r *fakeRepository) ClaimRefunds(context.Context, time.Time, int) ([]RefundRequest, error) {
	return r.requests, nil
}
func (r *fakeRepository) MarkRefundResult(_ context.Context, _ RefundRequest, result RefundResult, _ time.Time) error {
	r.result = result
	return nil
}
func (r *fakeRepository) MarkRefundRetry(_ context.Context, _ RefundRequest, code string, _ time.Time) error {
	r.retryCode = code
	return nil
}
func (r *fakeRepository) ReconcileRefund(context.Context, string, string, RefundStatus, string, time.Time) error {
	return nil
}
func (r *fakeRepository) UpsertDispute(context.Context, Dispute, time.Time) error { return nil }
func (r *fakeRepository) UpsertPayout(context.Context, Payout, time.Time) error   { return nil }
func (r *fakeRepository) ActivityForCreator(context.Context, string, int) ([]Activity, error) {
	return nil, nil
}
func (r *fakeRepository) LatestPayoutFailure(context.Context, string) (*PayoutFailure, error) {
	return nil, nil
}

type fakeGateway struct {
	result RefundResult
	err    error
	seen   RefundRequest
}

func (g *fakeGateway) Refund(_ context.Context, request RefundRequest) (RefundResult, error) {
	g.seen = request
	return g.result, g.err
}

func TestProcessRefundCompletesWithGatewayResult(t *testing.T) {
	request := RefundRequest{ID: "refund-request", PaymentAttemptID: "attempt", CallID: "call", StripePaymentIntentID: "pi_1"}
	repository := &fakeRepository{requests: []RefundRequest{request}}
	gateway := &fakeGateway{result: RefundResult{ID: "re_1", Status: RefundSucceeded}}
	service := NewService(repository, gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := service.processRefunds(context.Background(), 25); err != nil {
		t.Fatal(err)
	}
	if gateway.seen.ID != request.ID || repository.result.ID != "re_1" || repository.result.Status != RefundSucceeded {
		t.Fatalf("seen=%+v result=%+v", gateway.seen, repository.result)
	}
}

func TestProcessRefundSchedulesProviderErrorsForRetry(t *testing.T) {
	repository := &fakeRepository{requests: []RefundRequest{{ID: "refund-request"}}}
	gateway := &fakeGateway{err: errors.New("temporary provider failure")}
	service := NewService(repository, gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := service.processRefunds(context.Background(), 25); err != nil {
		t.Fatal(err)
	}
	if repository.retryCode != "provider_error" {
		t.Fatalf("retry code=%q", repository.retryCode)
	}
}

func TestRefundStatusFromStripe(t *testing.T) {
	if RefundStatusFromStripe("succeeded") != RefundSucceeded || RefundStatusFromStripe("failed") != RefundFailed || RefundStatusFromStripe("pending") != RefundPending {
		t.Fatal("unexpected Stripe refund status mapping")
	}
}
