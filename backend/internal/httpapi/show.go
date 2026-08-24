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
}

type showHandler struct {
	service showService
	logger  *slog.Logger
}

func (h showHandler) routes() chi.Router {
	router := chi.NewRouter()
	router.Post("/", h.create)
	router.Get("/{showID}", h.get)
	router.Post("/{showID}/start", h.start)
	router.Post("/{showID}/end", h.end)
	return router
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
	showID := chi.URLParam(r, "showID")
	if !uuidPattern.MatchString(showID) {
		writeError(w, http.StatusBadRequest, "INVALID_SHOW_ID", "Show ID is invalid.")
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
	default:
		h.logger.Error("show request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to update the show.")
	}
}
