package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	stripe "github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"
)

type paymentHandler struct {
	service       *paymentdomain.Service
	logger        *slog.Logger
	setCookie     func(http.ResponseWriter, string)
	webhookSecret string
	payouts       *payoutdomain.Service
}

func (h paymentHandler) webhook(w http.ResponseWriter, r *http.Request) {
	if h.webhookSecret == "" {
		writeError(w, http.StatusServiceUnavailable, "WEBHOOK_DISABLED", "Stripe webhooks are not configured.")
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK", "Invalid webhook payload.")
		return
	}
	event, err := webhook.ConstructEvent(payload, r.Header.Get("Stripe-Signature"), h.webhookSecret)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature.")
		return
	}
	if event.Type == "account.updated" {
		var account stripe.Account
		if err := json.Unmarshal(event.Data.Raw, &account); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK", "Invalid account event.")
			return
		}
		if h.payouts != nil {
			due := []string{}
			if account.Requirements != nil {
				due = append(due, account.Requirements.CurrentlyDue...)
			}
			if err := h.payouts.Reconcile(r.Context(), payoutdomain.StripeAccount{ID: account.ID, ChargesEnabled: account.ChargesEnabled, PayoutsEnabled: account.PayoutsEnabled, DetailsSubmitted: account.DetailsSubmitted, RequirementsDue: due}); err != nil {
				h.logger.Error("Stripe account webhook reconciliation failed", "error", err, "event_id", event.ID)
				writeError(w, http.StatusInternalServerError, "WEBHOOK_RETRY", "Account event could not be reconciled.")
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var intent stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &intent); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_WEBHOOK", "Invalid payment event.")
		return
	}
	var status paymentdomain.Status
	var failureCode string
	switch event.Type {
	case "payment_intent.succeeded":
		status = paymentdomain.StatusCaptured
	case "payment_intent.canceled":
		status = paymentdomain.StatusCanceled
	case "payment_intent.payment_failed":
		status = paymentdomain.StatusFailed
		if intent.LastPaymentError != nil {
			failureCode = string(intent.LastPaymentError.Code)
		}
	default:
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := h.service.Reconcile(r.Context(), intent.ID, status, failureCode); err != nil {
		if errors.Is(err, paymentdomain.ErrAttemptNotFound) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.logger.Error("Stripe webhook reconciliation failed", "error", err, "event_id", event.ID)
		writeError(w, http.StatusInternalServerError, "WEBHOOK_RETRY", "Payment event could not be reconciled.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type authorizePaymentRequest struct {
	TierID string `json:"tierId"`
}

func (h paymentHandler) authorize(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	var request authorizePaymentRequest
	if decodeJSON(r, &request) != nil || !uuidPattern.MatchString(request.TierID) {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Choose a valid paid tier.")
		return
	}
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		writeError(w, http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED", "A payment idempotency key is required.")
		return
	}
	token := viewerToken(r)
	if token == "" {
		var err error
		token, err = queuedomain.NewToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to start payment.")
			return
		}
	}
	value, err := h.service.Authorize(r.Context(), paymentdomain.PrepareInput{ShowID: showID, TierID: request.TierID, ViewerTokenHash: queuedomain.Hash(token), IdempotencyKeyHash: queuedomain.Hash(idempotencyKey)})
	if err != nil {
		writePaymentError(w, h.logger, err)
		return
	}
	h.setCookie(w, token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": value})
}

func writePaymentError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, paymentdomain.ErrDisabled):
		writeError(w, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Payments are not configured right now.")
	case errors.Is(err, paymentdomain.ErrShowNotLive):
		writeError(w, http.StatusConflict, "SHOW_NOT_LIVE", "This Hotline is not accepting callers.")
	case errors.Is(err, paymentdomain.ErrTierNotFound), errors.Is(err, paymentdomain.ErrFreeTier):
		writeError(w, http.StatusUnprocessableEntity, "TIER_NOT_PAYABLE", "That paid tier is unavailable.")
	case errors.Is(err, paymentdomain.ErrPayoutsNotReady):
		writeError(w, http.StatusConflict, "CREATOR_PAYOUTS_NOT_READY", "This creator cannot accept paid calls right now.")
	case errors.Is(err, paymentdomain.ErrAttemptNotFound), errors.Is(err, paymentdomain.ErrAuthorization), errors.Is(err, paymentdomain.ErrAuthorizationUsed):
		writeError(w, http.StatusPaymentRequired, "PAYMENT_NOT_AUTHORIZED", "Payment was not authorized. Try again.")
	case errors.Is(err, paymentdomain.ErrCaptureFailed):
		writeError(w, http.StatusPaymentRequired, "PAYMENT_CAPTURE_FAILED", "Payment could not be captured. The call was not opened.")
	default:
		logger.Error("payment request failed", "error", err)
		writeError(w, http.StatusBadGateway, "PAYMENT_PROVIDER_ERROR", "Stripe could not process the payment. Try again.")
	}
}
