package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	payoutdomain "github.com/bling-app/bling/backend/internal/payout"
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

func (h payoutHandler) writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, payoutdomain.ErrDisabled) {
		writeError(w, http.StatusServiceUnavailable, "PAYOUTS_UNAVAILABLE", "Creator payouts are not configured right now.")
		return
	}
	h.logger.Error("creator payout request failed", "error", err)
	writeError(w, http.StatusBadGateway, "PAYOUT_PROVIDER_ERROR", "Stripe could not update your payout account. Try again.")
}
