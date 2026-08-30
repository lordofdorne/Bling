package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	calldomain "github.com/bling-app/bling/backend/internal/call"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/go-chi/chi/v5"
)

type callService interface {
	SelectManual(context.Context, string, string, string) (calldomain.Call, error)
	SelectRandom(context.Context, string, string) (calldomain.Call, error)
	CreatorActive(context.Context, string, string) (calldomain.Call, error)
	ViewerLatest(context.Context, string, []byte) (calldomain.Call, error)
	Transition(context.Context, string, string, string, calldomain.Status) (calldomain.Call, error)
	TransitionViewer(context.Context, string, string, []byte, calldomain.Status) (calldomain.Call, error)
}

type callHandler struct {
	service callService
	logger  *slog.Logger
}

type selectCallerRequest struct {
	QueueEntryID string `json:"queueEntryId"`
}
type transitionCallRequest struct {
	Status calldomain.Status `json:"status"`
}

func (h callHandler) selectManual(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	var request selectCallerRequest
	if decodeJSON(r, &request) != nil || !uuidPattern.MatchString(request.QueueEntryID) {
		writeError(w, http.StatusBadRequest, "INVALID_QUEUE_ENTRY_ID", "Choose a valid caller.")
		return
	}
	creator := creatorFromContext(r.Context())
	value, err := h.service.SelectManual(r.Context(), showID, creator.ID, request.QueueEntryID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": value})
}

func (h callHandler) selectRandom(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	creator := creatorFromContext(r.Context())
	value, err := h.service.SelectRandom(r.Context(), showID, creator.ID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": value})
}

func (h callHandler) creatorActive(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	value, err := h.service.CreatorActive(r.Context(), showID, creatorFromContext(r.Context()).ID)
	if errors.Is(err, calldomain.ErrCallNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func (h callHandler) viewerLatest(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	token := viewerToken(r)
	if token == "" {
		writeJSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	value, err := h.service.ViewerLatest(r.Context(), showID, queuedomain.Hash(token))
	if errors.Is(err, calldomain.ErrCallNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"data": nil})
		return
	}
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func (h callHandler) transition(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	callID := chi.URLParam(r, "callID")
	if !uuidPattern.MatchString(callID) {
		writeError(w, http.StatusBadRequest, "INVALID_CALL_ID", "Call ID is invalid.")
		return
	}
	var request transitionCallRequest
	if decodeJSON(r, &request) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid call status.")
		return
	}
	value, err := h.service.Transition(r.Context(), showID, callID, creatorFromContext(r.Context()).ID, request.Status)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func (h callHandler) viewerTransition(w http.ResponseWriter, r *http.Request) {
	showID, callID, tokenHash, ok := viewerCallIdentity(w, r)
	if !ok {
		return
	}
	var request transitionCallRequest
	if decodeJSON(r, &request) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid call status.")
		return
	}
	value, err := h.service.TransitionViewer(r.Context(), showID, callID, tokenHash, request.Status)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func (h callHandler) viewerEnd(w http.ResponseWriter, r *http.Request) {
	showID, callID, tokenHash, ok := viewerCallIdentity(w, r)
	if !ok {
		return
	}
	value, err := h.service.TransitionViewer(r.Context(), showID, callID, tokenHash, calldomain.StatusEnded)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func (h callHandler) creatorEnd(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	callID := chi.URLParam(r, "callID")
	if !uuidPattern.MatchString(callID) {
		writeError(w, http.StatusBadRequest, "INVALID_CALL_ID", "Call ID is invalid.")
		return
	}
	value, err := h.service.Transition(r.Context(), showID, callID, creatorFromContext(r.Context()).ID, calldomain.StatusEnded)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": value})
}

func viewerCallIdentity(w http.ResponseWriter, r *http.Request) (string, string, []byte, bool) {
	showID, ok := validShowID(w, r)
	if !ok {
		return "", "", nil, false
	}
	callID := chi.URLParam(r, "callID")
	if !uuidPattern.MatchString(callID) {
		writeError(w, http.StatusBadRequest, "INVALID_CALL_ID", "Call ID is invalid.")
		return "", "", nil, false
	}
	token := viewerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "CALL_IDENTITY_REQUIRED", "This call belongs to its selected caller.")
		return "", "", nil, false
	}
	return showID, callID, queuedomain.Hash(token), true
}

func (h callHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, calldomain.ErrShowNotFound), errors.Is(err, calldomain.ErrCallNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Show or call not found.")
	case errors.Is(err, calldomain.ErrShowNotLive):
		writeError(w, http.StatusConflict, "SHOW_NOT_LIVE", "This Hotline is not live.")
	case errors.Is(err, calldomain.ErrCallerNotWaiting):
		writeError(w, http.StatusConflict, "CALLER_NOT_WAITING", "That caller is no longer waiting.")
	case errors.Is(err, calldomain.ErrQueueEmpty):
		writeError(w, http.StatusConflict, "QUEUE_EMPTY", "There are no callers waiting.")
	case errors.Is(err, calldomain.ErrActiveCall):
		writeError(w, http.StatusConflict, "ACTIVE_CALL_EXISTS", "End the active call before choosing another caller.")
	case errors.Is(err, calldomain.ErrInvalidTransition):
		writeError(w, http.StatusConflict, "INVALID_CALL_STATE", "That call status change is not allowed.")
	default:
		h.logger.Error("call request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to update the call.")
	}
}
