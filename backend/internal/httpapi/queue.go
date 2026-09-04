package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	paymentdomain "github.com/bling-app/bling/backend/internal/payment"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/go-chi/chi/v5"
)

const viewerCookieName = "bling_viewer"

type queueService interface {
	Join(context.Context, queuedomain.JoinInput) (queuedomain.ViewerState, error)
	Me(context.Context, string, []byte) (queuedomain.ViewerState, error)
	Leave(context.Context, string, []byte) (queuedomain.Entry, error)
	List(context.Context, string, string, int, int) ([]queuedomain.Entry, error)
	Tiers(context.Context, string) ([]queuedomain.Tier, error)
}

type queueHandler struct {
	service      queueService
	payments     *paymentdomain.Service
	logger       *slog.Logger
	cookieSecure bool
	cookieTTL    time.Duration
}

type joinQueueRequest struct {
	DisplayName      string `json:"displayName"`
	Topic            string `json:"topic"`
	TierID           string `json:"tierId"`
	PaymentAttemptID string `json:"paymentAttemptId"`
}

func (h queueHandler) join(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	var request joinQueueRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid display name and topic.")
		return
	}

	token := viewerToken(r)
	if token == "" {
		var err error
		token, err = queuedomain.NewToken()
		if err != nil {
			h.logger.Error("viewer token generation failed", "error", err)
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to join the queue.")
			return
		}
	}
	joinKey := r.Header.Get("Idempotency-Key")
	if joinKey == "" {
		var err error
		joinKey, err = queuedomain.NewToken()
		if err != nil {
			h.logger.Error("join key generation failed", "error", err)
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to join the queue.")
			return
		}
	}
	if request.PaymentAttemptID != "" && h.payments != nil {
		if err := h.payments.VerifyForQueue(r.Context(), showID, request.PaymentAttemptID, queuedomain.Hash(token)); err != nil {
			writePaymentError(w, h.logger, err)
			return
		}
	}

	state, err := h.service.Join(r.Context(), queuedomain.JoinInput{
		ShowID: showID, TierID: request.TierID, DisplayName: request.DisplayName, Topic: request.Topic,
		SessionTokenHash: queuedomain.Hash(token), JoinKeyHash: queuedomain.Hash(joinKey), PaymentAttemptID: request.PaymentAttemptID,
	})
	if err != nil {
		h.writeError(w, err)
		return
	}
	h.setViewerCookie(w, token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": state})
}

func (h queueHandler) me(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	token := viewerToken(r)
	if token == "" {
		writeError(w, http.StatusNotFound, "NOT_IN_QUEUE", "You are not in this queue.")
		return
	}
	state, err := h.service.Me(r.Context(), showID, queuedomain.Hash(token))
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": state})
}

func (h queueHandler) leave(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	token := viewerToken(r)
	if token == "" {
		writeError(w, http.StatusNotFound, "NOT_IN_QUEUE", "You are not in this queue.")
		return
	}
	entry, err := h.service.Leave(r.Context(), showID, queuedomain.Hash(token))
	if err != nil {
		h.writeError(w, err)
		return
	}
	if entry.PaymentAttemptID != nil && h.payments != nil {
		if err := h.payments.CancelForViewer(r.Context(), showID, *entry.PaymentAttemptID, queuedomain.Hash(token)); err != nil {
			h.logger.Error("release payment authorization after queue leave failed", "error", err, "show_id", showID, "queue_entry_id", entry.ID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"entry": entry}})
}

func (h queueHandler) list(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	limit := boundedQueryInt(r, "limit", 50, 1, 100)
	offset := boundedQueryInt(r, "offset", 0, 0, 1_000_000)
	creator := creatorFromContext(r.Context())
	entries, err := h.service.List(r.Context(), showID, creator.ID, limit, offset)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"entries": entries, "limit": limit, "offset": offset}})
}

func (h queueHandler) tiers(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	tiers, err := h.service.Tiers(r.Context(), showID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"tiers": tiers}})
}

func (h queueHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, queuedomain.ErrShowNotLive):
		writeError(w, http.StatusConflict, "SHOW_NOT_LIVE", "This Hotline is not accepting callers.")
	case errors.Is(err, queuedomain.ErrTierNotFound):
		writeError(w, http.StatusUnprocessableEntity, "TIER_NOT_FOUND", "That call tier is unavailable.")
	case errors.Is(err, queuedomain.ErrEntryNotFound):
		writeError(w, http.StatusNotFound, "NOT_IN_QUEUE", "You are not in this queue.")
	case errors.Is(err, queuedomain.ErrShowNotFound):
		writeError(w, http.StatusNotFound, "SHOW_NOT_FOUND", "Show not found.")
	case errors.Is(err, queuedomain.ErrInvalidName), errors.Is(err, queuedomain.ErrInvalidTopic):
		writeError(w, http.StatusUnprocessableEntity, "VALIDATION_FAILED", err.Error())
	case errors.Is(err, queuedomain.ErrCannotLeave):
		writeError(w, http.StatusConflict, "INVALID_QUEUE_STATE", "This queue entry can no longer leave.")
	case errors.Is(err, queuedomain.ErrPaymentRequired):
		writeError(w, http.StatusPaymentRequired, "PAYMENT_REQUIRED", "Authorize payment for this tier before joining.")
	default:
		h.logger.Error("queue request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to update the queue.")
	}
}

func validShowID(w http.ResponseWriter, r *http.Request) (string, bool) {
	showID := chi.URLParam(r, "showID")
	if !uuidPattern.MatchString(showID) {
		writeError(w, http.StatusBadRequest, "INVALID_SHOW_ID", "Show ID is invalid.")
		return "", false
	}
	return showID, true
}

func viewerToken(r *http.Request) string {
	cookie, err := r.Cookie(viewerCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (h queueHandler) setViewerCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: viewerCookieName, Value: token, Path: "/", HttpOnly: true, Secure: h.cookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(h.cookieTTL.Seconds()), Expires: time.Now().Add(h.cookieTTL),
	})
}

func boundedQueryInt(r *http.Request, name string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || value < minimum {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}
