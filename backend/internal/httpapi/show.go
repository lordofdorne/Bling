package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	showdomain "github.com/bling-app/bling/backend/internal/show"
	"github.com/go-chi/chi/v5"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
var publicUsernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,30}$`)

type showService interface {
	Create(context.Context, string) (showdomain.Show, error)
	Get(context.Context, string, string) (showdomain.Show, error)
	Start(context.Context, string, string) (showdomain.Show, error)
	End(context.Context, string, string) (showdomain.Show, error)
	LiveByUsername(context.Context, string) (showdomain.Show, error)
	Current(context.Context, string) (showdomain.Show, error)
	Tiers(context.Context, string, string) ([]showdomain.Tier, error)
	ReplaceTiers(context.Context, string, string, []showdomain.TierInput) ([]showdomain.Tier, error)
}

type showHandler struct {
	service showService
	logger  *slog.Logger
}

func (h showHandler) routes() chi.Router {
	router := chi.NewRouter()
	router.Post("/", h.create)
	router.Get("/current", h.current)
	router.Get("/{showID}", h.get)
	router.Post("/{showID}/start", h.start)
	router.Post("/{showID}/end", h.end)
	router.Get("/{showID}/tier-config", h.tiers)
	router.Put("/{showID}/tier-config", h.replaceTiers)
	return router
}

func (h showHandler) current(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	result, err := h.service.Current(r.Context(), creatorFromContext(r.Context()).ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"show": result}})
}

func (h showHandler) tiers(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := h.showID(w, r)
	if !ok {
		return
	}
	tiers, err := h.service.Tiers(r.Context(), showID, creatorFromContext(r.Context()).ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"tiers": tiers}})
}

type replaceTiersRequest struct {
	Tiers []showdomain.TierInput `json:"tiers"`
}

func (h showHandler) replaceTiers(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := h.showID(w, r)
	if !ok {
		return
	}
	var request replaceTiersRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid tier configuration.")
		return
	}
	tiers, err := h.service.ReplaceTiers(r.Context(), showID, creatorFromContext(r.Context()).ID, request.Tiers)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"tiers": tiers}})
}

func (h showHandler) showID(w http.ResponseWriter, r *http.Request) (string, bool) {
	showID := chi.URLParam(r, "showID")
	if !uuidPattern.MatchString(showID) {
		writeError(w, http.StatusBadRequest, "INVALID_SHOW_ID", "Show ID is invalid.")
		return "", false
	}
	return showID, true
}

func (h showHandler) create(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	creator := creatorFromContext(r.Context())
	result, err := h.service.Create(r.Context(), creator.ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"show": result}})
}

func (h showHandler) get(w http.ResponseWriter, r *http.Request) {
	h.withShowID(w, r, h.service.Get)
}

func (h showHandler) start(w http.ResponseWriter, r *http.Request) {
	h.withShowID(w, r, h.service.Start)
}

func (h showHandler) end(w http.ResponseWriter, r *http.Request) {
	h.withShowID(w, r, h.service.End)
}

func (h showHandler) withShowID(w http.ResponseWriter, r *http.Request, operation func(context.Context, string, string) (showdomain.Show, error)) {
	preventCaching(w)
	showID, ok := h.showID(w, r)
	if !ok {
		return
	}
	creator := creatorFromContext(r.Context())
	result, err := operation(r.Context(), showID, creator.ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"show": result}})
}

func (h showHandler) liveByUsername(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	username := strings.ToLower(chi.URLParam(r, "username"))
	if !publicUsernamePattern.MatchString(username) {
		writeError(w, http.StatusNotFound, "NO_LIVE_SHOW", "This creator does not have a live show.")
		return
	}
	result, err := h.service.LiveByUsername(r.Context(), username)
	if errors.Is(err, showdomain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NO_LIVE_SHOW", "This creator does not have a live show.")
		return
	}
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"show": result}})
}

func (h showHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, showdomain.ErrNotFound):
		writeError(w, http.StatusNotFound, "SHOW_NOT_FOUND", "Show not found.")
	case errors.Is(err, showdomain.ErrActiveShowExists):
		writeError(w, http.StatusConflict, "ACTIVE_SHOW_EXISTS", "You already have a live show.")
	case errors.Is(err, showdomain.ErrInvalidTransition):
		writeError(w, http.StatusConflict, "INVALID_SHOW_STATE", "This show cannot make that transition.")
	case errors.Is(err, showdomain.ErrShowNotConfigurable):
		writeError(w, http.StatusConflict, "SHOW_NOT_CONFIGURABLE", "Tiers can only be changed before the Hotline starts.")
	case errors.Is(err, showdomain.ErrTierConfiguration):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_TIER_CONFIGURATION", "Use 1-5 uniquely named tiers, keep one enabled, and check price and duration values.")
	case errors.Is(err, showdomain.ErrPayoutsNotReady):
		writeError(w, http.StatusConflict, "PAYOUTS_NOT_READY", "Finish Stripe payout setup before starting a Hotline with paid tiers.")
	default:
		h.logger.Error("show request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to update the show.")
	}
}
