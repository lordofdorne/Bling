package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
