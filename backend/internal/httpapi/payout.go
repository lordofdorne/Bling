package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
	stripe "github.com/stripe/stripe-go/v85"
)

type payoutHandler struct {
	service *payoutdomain.Service
	logger  *slog.Logger
}

func (h payoutHandler) status(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	value, err := h.service.Status(r.Context(), creatorFromContext(r.Context()).ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"payouts": value}})
}

func (h payoutHandler) onboardingLink(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	creator := creatorFromContext(r.Context())
	url, err := h.service.OnboardingLink(r.Context(), creator.ID, creator.Email)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"url": url}})
}

// writeError translates a payout failure into a response the creator can act
// on. Stripe's own message is never forwarded: it is written for the platform
// operator, can name internal parameters, and for credential failures it echoes
// a masked key. The operator detail goes to the log instead, keyed by Stripe's
// request ID so it can be found in the Stripe dashboard request log.
func (h payoutHandler) writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, payoutdomain.ErrDisabled) {
		writeError(w, http.StatusServiceUnavailable, "PAYOUTS_UNAVAILABLE", "Creator payouts are not configured right now.")
		return
	}

	var stripeErr *stripe.Error
	if !errors.As(err, &stripeErr) {
		h.logger.Error("creator payout request failed", "error", err)
		writeError(w, http.StatusBadGateway, "PAYOUT_PROVIDER_ERROR", "Stripe could not update your payout account. Try again.")
		return
	}

	h.logger.Error("creator payout request failed at Stripe",
		"error", err,
		"stripe_type", string(stripeErr.Type),
		"stripe_code", string(stripeErr.Code),
		"stripe_status", stripeErr.HTTPStatusCode,
		"stripe_param", stripeErr.Param,
		"stripe_request_id", stripeErr.RequestID,
		"stripe_request_log", stripeErr.RequestLogURL,
	)

	status, code, message := payoutErrorResponse(stripeErr)
	if status == http.StatusServiceUnavailable && code == "PAYOUT_PROVIDER_BUSY" {
		w.Header().Set("Retry-After", "10")
	}
	writeError(w, status, code, message)
}

// payoutErrorResponse separates failures the creator can resolve from failures
// only the platform operator can resolve, so the dashboard stops telling a
// creator to "try again" when retrying cannot possibly help.
func payoutErrorResponse(err *stripe.Error) (int, string, string) {
	switch err.Code {
	case stripe.ErrorCodeAPIKeyExpired,
		stripe.ErrorCodePlatformAPIKeyExpired,
		stripe.ErrorCodeSecretKeyRequired,
		stripe.ErrorCodeAccountInvalid,
		stripe.ErrorCodePlatformAccountRequired:
		return http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED", "Payouts are misconfigured on our side, so this cannot be completed right now. Nothing is wrong with your account and retrying will not help. Please contact support."
	case stripe.ErrorCodeRateLimit:
		return http.StatusServiceUnavailable, "PAYOUT_PROVIDER_BUSY", "Stripe is rate limiting us right now. Wait a few seconds and try again."
	}

	switch err.HTTPStatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return http.StatusServiceUnavailable, "PAYOUTS_MISCONFIGURED", "Payouts are misconfigured on our side, so this cannot be completed right now. Nothing is wrong with your account and retrying will not help. Please contact support."
	case http.StatusTooManyRequests:
		return http.StatusServiceUnavailable, "PAYOUT_PROVIDER_BUSY", "Stripe is rate limiting us right now. Wait a few seconds and try again."
	}

	if err.Type == stripe.ErrorTypeAPI || err.HTTPStatusCode >= 500 {
		return http.StatusBadGateway, "PAYOUT_PROVIDER_UNAVAILABLE", "Stripe is having trouble right now. Try again in a moment."
	}

	return http.StatusBadGateway, "PAYOUT_PROVIDER_ERROR", "Stripe could not update your payout account. Try again."
}
