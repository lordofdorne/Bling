package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
	stripe "github.com/stripe/stripe-go/v85"
)

func TestPayoutErrorResponseSeparatesOperatorFailuresFromRetryableOnes(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		err    *stripe.Error
		status int
		code   string
	}{
		{"expired key", &stripe.Error{Code: stripe.ErrorCodeAPIKeyExpired, HTTPStatusCode: http.StatusUnauthorized}, http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED"},
		{"platform key expired", &stripe.Error{Code: stripe.ErrorCodePlatformAPIKeyExpired, HTTPStatusCode: http.StatusUnauthorized}, http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED"},
		{"connect not enabled", &stripe.Error{Code: stripe.ErrorCodePlatformAccountRequired, HTTPStatusCode: http.StatusBadRequest}, http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED"},
		{"unauthorized without a code", &stripe.Error{Type: stripe.ErrorTypeInvalidRequest, HTTPStatusCode: http.StatusUnauthorized}, http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED"},
		{"forbidden without a code", &stripe.Error{Type: stripe.ErrorTypeInvalidRequest, HTTPStatusCode: http.StatusForbidden}, http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED"},
		{"rate limited by code", &stripe.Error{Code: stripe.ErrorCodeRateLimit, HTTPStatusCode: http.StatusTooManyRequests}, http.StatusServiceUnavailable, "PAYOUT_PROVIDER_BUSY"},
		{"rate limited by status", &stripe.Error{Type: stripe.ErrorTypeInvalidRequest, HTTPStatusCode: http.StatusTooManyRequests}, http.StatusServiceUnavailable, "PAYOUT_PROVIDER_BUSY"},
		{"stripe outage", &stripe.Error{Type: stripe.ErrorTypeAPI, HTTPStatusCode: http.StatusBadGateway}, http.StatusBadGateway, "PAYOUT_PROVIDER_UNAVAILABLE"},
		{"ordinary rejection", &stripe.Error{Type: stripe.ErrorTypeInvalidRequest, HTTPStatusCode: http.StatusBadRequest}, http.StatusBadGateway, "PAYOUT_PROVIDER_ERROR"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			status, code, message := payoutErrorResponse(testCase.err)
			if status != testCase.status || code != testCase.code {
				t.Fatalf("status=%d code=%s, want status=%d code=%s", status, code, testCase.status, testCase.code)
			}
			if message == "" {
				t.Fatal("message must not be empty")
			}
		})
	}
}

// A creator must never be told to retry a failure that only an operator can fix.
func TestPayoutMisconfigurationDoesNotAskTheCreatorToRetry(t *testing.T) {
	_, _, message := payoutErrorResponse(&stripe.Error{Code: stripe.ErrorCodeAPIKeyExpired, HTTPStatusCode: http.StatusUnauthorized})
	if strings.Contains(strings.ToLower(message), "try again") {
		t.Fatalf("misconfiguration message tells the creator to retry: %q", message)
	}
}

// Stripe echoes a masked key in credential errors, so its text must not reach the response body.
func TestPayoutResponseNeverForwardsStripeMessage(t *testing.T) {
	secret := "sk_test_51Hxxxxxxxxxxxxxxxx"
	stripeErr := &stripe.Error{
		Code:           stripe.ErrorCodeAPIKeyExpired,
		HTTPStatusCode: http.StatusUnauthorized,
		Msg:            fmt.Sprintf("Invalid API Key provided: %s", secret),
		RequestID:      "req_secret123",
	}
	handler := payoutHandler{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	response := httptest.NewRecorder()
	handler.writeError(response, fmt.Errorf("create Stripe connected account: %w", stripeErr))

	body := response.Body.String()
	for _, leaked := range []string{secret, "sk_test", "Invalid API Key", "req_secret123"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("response leaked %q: %s", leaked, body)
		}
	}
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, body)
	}
}

func TestPayoutDisabledIsReportedAsUnavailable(t *testing.T) {
	handler := payoutHandler{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	response := httptest.NewRecorder()
	handler.writeError(response, payoutdomain.ErrDisabled)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "PAYOUTS_UNAVAILABLE") {
		t.Fatalf("body=%s", response.Body.String())
	}
}

func TestPayoutNonStripeErrorKeepsGenericResponse(t *testing.T) {
	handler := payoutHandler{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	response := httptest.NewRecorder()
	handler.writeError(response, errors.New("database unreachable"))
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status=%d", response.Code)
	}
	if strings.Contains(response.Body.String(), "database unreachable") {
		t.Fatalf("internal detail leaked: %s", response.Body.String())
	}
}

func TestPayoutRateLimitSetsRetryAfter(t *testing.T) {
	handler := payoutHandler{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	response := httptest.NewRecorder()
	handler.writeError(response, &stripe.Error{Code: stripe.ErrorCodeRateLimit, HTTPStatusCode: http.StatusTooManyRequests})
	if got := response.Header().Get("Retry-After"); got == "" {
		t.Fatal("rate limited payout response must carry Retry-After")
	}
}
