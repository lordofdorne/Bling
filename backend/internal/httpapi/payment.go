package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	financedomain "github.com/bling-app/bling/backend/internal/finance"
	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/go-chi/chi/v5"
	stripe "github.com/stripe/stripe-go/v85"
	"github.com/stripe/stripe-go/v85/webhook"
)

type paymentHandler struct {
	service        *paymentdomain.Service
	authentication authService
	logger         *slog.Logger
	setCookie      func(http.ResponseWriter, string)
	webhookSecret  string
	payouts        *payoutdomain.Service
	finances       *financedomain.Service
}

var paymentMethodIDPattern = regexp.MustCompile(`^pm_[A-Za-z0-9]+$`)

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
	if !supportedStripeEvent(event.Type) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if h.finances != nil {
		claim, claimErr := h.finances.ClaimEvent(r.Context(), event.ID, string(event.Type), event.Account)
		if claimErr != nil {
			h.logger.Error("Stripe webhook claim failed", "error", claimErr, "event_id", event.ID)
			writeError(w, http.StatusInternalServerError, "WEBHOOK_RETRY", "Payment event could not be claimed.")
			return
		}
		if claim == financedomain.EventProcessed {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if claim == financedomain.EventBusy {
			writeError(w, http.StatusConflict, "WEBHOOK_IN_PROGRESS", "Stripe event processing is already in progress.")
			return
		}
	}
	if err := h.processEvent(r, event); err != nil {
		if h.finances != nil {
			_ = h.finances.FailEvent(r.Context(), event.ID, "processing_failed")
		}
		h.logger.Error("Stripe webhook reconciliation failed", "error", err, "event_id", event.ID, "event_type", event.Type)
		writeError(w, http.StatusInternalServerError, "WEBHOOK_RETRY", "Stripe event could not be reconciled.")
		return
	}
	if h.finances != nil {
		if err := h.finances.CompleteEvent(r.Context(), event.ID); err != nil {
			h.logger.Error("Stripe webhook completion failed", "error", err, "event_id", event.ID)
			writeError(w, http.StatusInternalServerError, "WEBHOOK_RETRY", "Stripe event could not be completed.")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func supportedStripeEvent(eventType stripe.EventType) bool {
	switch eventType {
	case "account.updated",
		"payment_intent.succeeded", "payment_intent.canceled", "payment_intent.payment_failed",
		"setup_intent.succeeded", "payment_method.attached", "payment_method.detached",
		"refund.created", "refund.updated", "refund.failed",
		"charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
		"payout.created", "payout.updated", "payout.paid", "payout.failed":
		return true
	default:
		return false
	}
}

func (h paymentHandler) processEvent(r *http.Request, event stripe.Event) error {
	switch event.Type {
	case "account.updated":
		// Only the account ID is taken from the event. Bling's connected
		// accounts are Accounts v2 recipients, and this event carries the v1
		// account shape, so the payout service re-reads authoritative state
		// through the v2 API rather than trusting the payload's fields.
		var account stripe.Account
		if err := json.Unmarshal(event.Data.Raw, &account); err != nil {
			return err
		}
		if h.payouts == nil {
			return nil
		}
		return h.payouts.Reconcile(r.Context(), account.ID)
	case "payment_intent.succeeded":
		return h.reconcilePaymentIntent(r, event, paymentdomain.StatusCaptured)
	case "payment_intent.canceled":
		return h.reconcilePaymentIntent(r, event, paymentdomain.StatusCanceled)
	case "payment_intent.payment_failed":
		return h.reconcilePaymentIntent(r, event, paymentdomain.StatusFailed)
	case "setup_intent.succeeded", "payment_method.attached", "payment_method.detached":
		// Settings reads the authoritative method list from Stripe. Claiming these
		// events still makes delivery observable and leaves room for projections.
		return nil
	case "refund.created", "refund.updated", "refund.failed":
		if h.finances == nil {
			return nil
		}
		var value stripe.Refund
		if err := json.Unmarshal(event.Data.Raw, &value); err != nil {
			return err
		}
		intentID := ""
		if value.PaymentIntent != nil {
			intentID = value.PaymentIntent.ID
		}
		return h.finances.ReconcileRefund(r.Context(), value.ID, intentID, financedomain.RefundStatusFromStripe(string(value.Status)), string(value.FailureReason))
	case "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed":
		if h.finances == nil {
			return nil
		}
		var value stripe.Dispute
		if err := json.Unmarshal(event.Data.Raw, &value); err != nil {
			return err
		}
		intentID := ""
		if value.PaymentIntent != nil {
			intentID = value.PaymentIntent.ID
		}
		var dueAt *time.Time
		if value.EvidenceDetails != nil && value.EvidenceDetails.DueBy > 0 {
			due := time.Unix(value.EvidenceDetails.DueBy, 0).UTC()
			dueAt = &due
		}
		return h.finances.ReconcileDispute(r.Context(), financedomain.Dispute{ID: value.ID, StripePaymentIntentID: intentID, AmountCents: value.Amount, Currency: string(value.Currency), Reason: string(value.Reason), Status: string(value.Status), EvidenceDueAt: dueAt})
	case "payout.created", "payout.updated", "payout.paid", "payout.failed":
		if h.finances == nil || event.Account == "" {
			return nil
		}
		var value stripe.Payout
		if err := json.Unmarshal(event.Data.Raw, &value); err != nil {
			return err
		}
		var arrivalAt *time.Time
		if value.ArrivalDate > 0 {
			arrival := time.Unix(value.ArrivalDate, 0).UTC()
			arrivalAt = &arrival
		}
		return h.finances.ReconcilePayout(r.Context(), financedomain.Payout{ID: value.ID, StripeAccountID: event.Account, AmountCents: value.Amount, Currency: string(value.Currency), Status: string(value.Status), FailureCode: string(value.FailureCode), FailureMessage: value.FailureMessage, ArrivalAt: arrivalAt})
	default:
		return nil
	}
}

func (h paymentHandler) reconcilePaymentIntent(r *http.Request, event stripe.Event, status paymentdomain.Status) error {
	var intent stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &intent); err != nil {
		return err
	}
	failureCode := ""
	if status == paymentdomain.StatusFailed && intent.LastPaymentError != nil {
		failureCode = string(intent.LastPaymentError.Code)
	}
	err := h.service.Reconcile(r.Context(), intent.ID, status, failureCode)
	if errors.Is(err, paymentdomain.ErrAttemptNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if status == paymentdomain.StatusCaptured && intent.SetupFutureUsage != "" && intent.Customer != nil && intent.PaymentMethod != nil {
		return h.service.ReconcileSavedPaymentMethod(r.Context(), intent.ID, intent.Customer.ID, intent.PaymentMethod.ID)
	}
	return nil
}

func (h paymentHandler) activity(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	creatorID := creatorFromContext(r.Context()).ID
	values, err := h.finances.Activity(r.Context(), creatorID)
	if err != nil {
		h.logger.Error("payment activity lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load payment activity.")
		return
	}
	payoutFailure, err := h.finances.LatestPayoutFailure(r.Context(), creatorID)
	if err != nil {
		h.logger.Error("payout failure lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load payout activity.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"activity": values, "payoutFailure": payoutFailure}})
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
	input := paymentdomain.PrepareInput{ShowID: showID, TierID: request.TierID, ViewerTokenHash: queuedomain.Hash(token), IdempotencyKeyHash: queuedomain.Hash(idempotencyKey)}
	if h.authentication != nil {
		user, authErr := h.authentication.CurrentUser(r.Context(), sessionToken(r))
		if authErr == nil {
			input.PayerUserID = user.ID
			input.PayerEmail = user.Email
		} else if !errors.Is(authErr, auth.ErrInvalidSession) {
			h.logger.Error("optional payment session lookup failed", "error", authErr)
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to verify your payment account.")
			return
		}
	}
	value, err := h.service.Authorize(r.Context(), input)
	if err != nil {
		writePaymentError(w, h.logger, err)
		return
	}
	h.setCookie(w, token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": value})
}

func (h paymentHandler) paymentMethods(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	methods, err := h.service.PaymentMethods(r.Context(), creatorFromContext(r.Context()).ID)
	if err != nil {
		h.writeCustomerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"paymentMethods": methods}})
}

func (h paymentHandler) paymentMethodSetup(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	user := creatorFromContext(r.Context())
	setup, err := h.service.SetupPaymentMethod(r.Context(), user.ID, user.Email)
	if err != nil {
		h.writeCustomerError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"setup": setup}})
}

func (h paymentHandler) removePaymentMethod(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	id := chi.URLParam(r, "paymentMethodID")
	if !paymentMethodIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "INVALID_PAYMENT_METHOD", "Choose a valid payment method.")
		return
	}
	if err := h.service.RemovePaymentMethod(r.Context(), creatorFromContext(r.Context()).ID, id); err != nil {
		h.writeCustomerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h paymentHandler) writeCustomerError(w http.ResponseWriter, err error) {
	if errors.Is(err, paymentdomain.ErrDisabled) {
		writeError(w, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Saved payments are not configured right now.")
		return
	}
	if errors.Is(err, paymentdomain.ErrPaymentMethodNotFound) {
		writeError(w, http.StatusNotFound, "PAYMENT_METHOD_NOT_FOUND", "That payment method is no longer available.")
		return
	}
	h.logger.Error("saved payment request failed", "error", err)
	writeError(w, http.StatusBadGateway, "PAYMENT_PROVIDER_ERROR", "Stripe could not update your saved payments. Try again.")
}

func writePaymentError(w http.ResponseWriter, logger *slog.Logger, err error) {
	switch {
	case errors.Is(err, paymentdomain.ErrDisabled):
		writeError(w, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Payments are not configured right now.")
	case errors.Is(err, paymentdomain.ErrShowNotLive):
		writeError(w, http.StatusConflict, "SHOW_NOT_LIVE", "This Hotline is not accepting callers.")
	case errors.Is(err, paymentdomain.ErrTierNotFound), errors.Is(err, paymentdomain.ErrFreeTier):
		writeError(w, http.StatusUnprocessableEntity, "TIER_NOT_PAYABLE", "That paid tier is unavailable.")
	case errors.Is(err, paymentdomain.ErrAttemptNotFound), errors.Is(err, paymentdomain.ErrAuthorization), errors.Is(err, paymentdomain.ErrAuthorizationUsed):
		writeError(w, http.StatusPaymentRequired, "PAYMENT_NOT_AUTHORIZED", "Payment was not authorized. Try again.")
	case errors.Is(err, paymentdomain.ErrCaptureFailed):
		writeError(w, http.StatusPaymentRequired, "PAYMENT_CAPTURE_FAILED", "Payment could not be captured. The call was not opened.")
	default:
		logger.Error("payment request failed", "error", err)
		writeError(w, http.StatusBadGateway, "PAYMENT_PROVIDER_ERROR", "Stripe could not process the payment. Try again.")
	}
}
