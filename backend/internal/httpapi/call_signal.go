package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	calldomain "github.com/bling-app/bling/backend/internal/call"
	"github.com/bling-app/bling/backend/internal/config"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/bling-app/bling/backend/internal/realtime"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
)

type signalCallService interface {
	AuthorizeCreator(context.Context, string, string, string) error
	AuthorizeViewer(context.Context, string, string, []byte) error
	ParticipantConnected(context.Context, string, string) error
	ParticipantDisconnected(context.Context, string, string) error
}

type callSignalHandler struct {
	service           signalCallService
	hub               *realtime.SignalHub
	logger            *slog.Logger
	allowedOrigins    []string
	heartbeat         time.Duration
	writeTimeout      time.Duration
	guard             *realtimeHandler
	iceServers        []config.ICEServer
	turnURL           string
	turnSharedSecret  string
	turnCredentialTTL time.Duration
	presence          *realtime.PresenceStore
}

func (h callSignalHandler) creator(w http.ResponseWriter, r *http.Request) {
	creatorID := creatorFromContext(r.Context()).ID
	h.authorizeAndServe(w, r, realtime.RoleCreator, creatorID, creatorID, nil)
}

func (h callSignalHandler) viewer(w http.ResponseWriter, r *http.Request) {
	token := viewerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "CALL_IDENTITY_REQUIRED", "This call belongs to its selected caller.")
		return
	}
	tokenHash := queuedomain.Hash(token)
	h.authorizeAndServe(w, r, realtime.RoleViewer, hex.EncodeToString(tokenHash[:8]), "", tokenHash)
}

func (h callSignalHandler) creatorRTCConfig(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	callID := chi.URLParam(r, "callID")
	if !uuidPattern.MatchString(callID) {
		writeError(w, http.StatusBadRequest, "INVALID_CALL_ID", "Call ID is invalid.")
		return
	}
	if err := h.service.AuthorizeCreator(r.Context(), showID, callID, creatorFromContext(r.Context()).ID); err != nil {
		h.writeAuthorizationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"iceServers": h.iceServersFor(creatorFromContext(r.Context()).ID)}})
}

func (h callSignalHandler) viewerRTCConfig(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	showID, callID, tokenHash, ok := viewerCallIdentity(w, r)
	if !ok {
		return
	}
	if err := h.service.AuthorizeViewer(r.Context(), showID, callID, tokenHash); err != nil {
		h.writeAuthorizationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"iceServers": h.iceServersFor(hex.EncodeToString(tokenHash[:8]))}})
}

func (h callSignalHandler) iceServersFor(subject string) []config.ICEServer {
	servers := append([]config.ICEServer(nil), h.iceServers...)
	if h.turnURL == "" || h.turnSharedSecret == "" {
		return servers
	}
	username := fmt.Sprintf("%d:%s", time.Now().UTC().Add(h.turnCredentialTTL).Unix(), subject)
	digest := hmac.New(sha1.New, []byte(h.turnSharedSecret))
	_, _ = digest.Write([]byte(username))
	servers = append(servers, config.ICEServer{URLs: []string{h.turnURL}, Username: username, Credential: base64.StdEncoding.EncodeToString(digest.Sum(nil))})
	return servers
}

func (h callSignalHandler) writeAuthorizationError(w http.ResponseWriter, err error) {
	if errors.Is(err, calldomain.ErrCallNotFound) {
		writeError(w, http.StatusNotFound, "CALL_NOT_FOUND", "Active call not found.")
		return
	}
	h.logger.Error("RTC configuration authorization failed", "error", err)
	writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Call configuration is unavailable.")
}

func (h callSignalHandler) authorizeAndServe(w http.ResponseWriter, r *http.Request, role, subject, creatorID string, tokenHash []byte) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	callID := chi.URLParam(r, "callID")
	if !uuidPattern.MatchString(callID) {
		writeError(w, http.StatusBadRequest, "INVALID_CALL_ID", "Call ID is invalid.")
		return
	}
	if h.guard != nil && !h.guard.allow(w, r, showID, "call-"+role, subject) {
		return
	}
	var err error
	if role == realtime.RoleCreator {
		err = h.service.AuthorizeCreator(r.Context(), showID, callID, creatorID)
	} else {
		err = h.service.AuthorizeViewer(r.Context(), showID, callID, tokenHash)
	}
	if errors.Is(err, calldomain.ErrCallNotFound) {
		writeError(w, http.StatusNotFound, "CALL_NOT_FOUND", "Call not found.")
		return
	}
	if err != nil {
		h.logger.Error("private signal authorization failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Call signaling is unavailable.")
		return
	}
	h.serve(w, r, showID, callID, role, creatorID, tokenHash)
}

func (h callSignalHandler) serve(w http.ResponseWriter, r *http.Request, showID, callID, role, creatorID string, tokenHash []byte) {
	client, err := h.hub.Subscribe(r.Context(), callID, role)
	if errors.Is(err, realtime.ErrRoomFull) {
		writeError(w, http.StatusServiceUnavailable, "CALL_AT_CAPACITY", "This call already has its allowed participant connections.")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Call signaling is unavailable.")
		return
	}
	defer h.hub.Unsubscribe(callID, client)
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.allowedOrigins})
	if err != nil {
		return
	}
	connection.SetReadLimit(64 << 10)
	defer connection.CloseNow()
	connectionID, err := randomConnectionID()
	if err != nil || h.presence == nil {
		_ = connection.Close(websocket.StatusInternalError, "presence unavailable")
		return
	}
	if err := h.presence.Touch(r.Context(), callID, role, connectionID, time.Now().UTC()); err != nil {
		h.logger.Error("call presence registration failed", "error", err, "call_id", callID, "role", role)
		_ = connection.Close(websocket.StatusTryAgainLater, "presence unavailable")
		return
	}
	if err := h.service.ParticipantConnected(r.Context(), callID, role); err != nil {
		_, _ = h.presence.Disconnect(r.Context(), callID, role, connectionID, time.Now().UTC())
		_ = connection.Close(websocket.StatusInternalError, "call state unavailable")
		return
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		disconnected, presenceErr := h.presence.Disconnect(cleanupCtx, callID, role, connectionID, time.Now().UTC())
		if presenceErr != nil {
			h.logger.Error("call presence removal failed", "error", presenceErr, "call_id", callID, "role", role)
			return
		}
		if disconnected {
			if stateErr := h.service.ParticipantDisconnected(cleanupCtx, callID, role); stateErr != nil {
				h.logger.Error("participant disconnect persistence failed", "error", stateErr, "call_id", callID, "role", role)
			}
		}
	}()
	ctx, cancel := context.WithCancel(r.Context())
	completed := make(chan error, 2)
	go func() { completed <- h.read(ctx, connection, showID, callID, role, creatorID, tokenHash) }()
	go func() { completed <- h.write(ctx, connection, client, callID, role, connectionID) }()
	err = <-completed
	cancel()
	<-completed
	if err != nil && !isExpectedWebsocketClose(err) && !errors.Is(err, context.Canceled) {
		h.logger.Debug("private signal socket closed", "error", err, "call_id", callID, "role", role)
	}
}

type incomingSignal struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func (h callSignalHandler) read(ctx context.Context, connection *websocket.Conn, showID, callID, role, creatorID string, tokenHash []byte) error {
	for {
		messageType, payload, err := connection.Read(ctx)
		if err != nil {
			return err
		}
		if messageType != websocket.MessageText {
			return errors.New("signal must be text JSON")
		}
		var incoming incomingSignal
		if json.Unmarshal(payload, &incoming) != nil || len(incoming.Payload) == 0 || !json.Valid(incoming.Payload) {
			return errors.New("invalid signal")
		}
		allowed := incoming.Type == realtime.SignalICE || (role == realtime.RoleCreator && incoming.Type == realtime.SignalOffer) || (role == realtime.RoleViewer && (incoming.Type == realtime.SignalAnswer || incoming.Type == realtime.SignalReady))
		if !allowed {
			return errors.New("signal type is not allowed for role")
		}
		var authorizationErr error
		if role == realtime.RoleCreator {
			authorizationErr = h.service.AuthorizeCreator(ctx, showID, callID, creatorID)
		} else {
			authorizationErr = h.service.AuthorizeViewer(ctx, showID, callID, tokenHash)
		}
		if authorizationErr != nil {
			return fmt.Errorf("call is no longer active: %w", authorizationErr)
		}
		target := realtime.RoleCreator
		if role == realtime.RoleCreator {
			target = realtime.RoleViewer
		}
		if err := h.hub.Publish(ctx, realtime.Signal{Type: incoming.Type, CallID: callID, From: role, Target: target, Payload: incoming.Payload}); err != nil {
			return err
		}
	}
}

func (h callSignalHandler) write(ctx context.Context, connection *websocket.Conn, client *realtime.SignalClient, callID, role, connectionID string) error {
	heartbeat := time.NewTicker(h.heartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-client.Done():
			return connection.Close(websocket.StatusGoingAway, "resubscribe")
		case payload := <-client.Messages:
			writeCtx, cancel := context.WithTimeout(ctx, h.writeTimeout)
			err := connection.Write(writeCtx, websocket.MessageText, payload)
			cancel()
			if err != nil {
				return err
			}
		case <-heartbeat.C:
			if err := h.presence.Touch(ctx, callID, role, connectionID, time.Now().UTC()); err != nil {
				return err
			}
			pingCtx, cancel := context.WithTimeout(ctx, h.writeTimeout)
			err := connection.Ping(pingCtx)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func randomConnectionID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
