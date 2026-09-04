package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	stripe "github.com/stripe/stripe-go/v82"
)

func TestStripeWebhookRejectsInvalidSignature(t *testing.T) {
	handler := paymentHandler{logger: slog.New(slog.NewTextHandler(io.Discard, nil)), webhookSecret: "whsec_test"}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader(`{"id":"evt_test"}`))
	request.Header.Set("Stripe-Signature", "invalid")
	response := httptest.NewRecorder()
	handler.webhook(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestSupportedStripeEventsExcludeUnrelatedTraffic(t *testing.T) {
	if !supportedStripeEvent(stripe.EventType("refund.updated")) || !supportedStripeEvent(stripe.EventType("payout.failed")) {
		t.Fatal("financial recovery events must be processed")
	}
	if supportedStripeEvent(stripe.EventType("customer.created")) {
		t.Fatal("unrelated Stripe events must not enter the idempotency ledger")
	}
}
