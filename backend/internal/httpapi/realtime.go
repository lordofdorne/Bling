package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	queuedomain "github.com/bling-app/bling/backend/internal/queue"
	"github.com/bling-app/bling/backend/internal/realtime"
	"github.com/coder/websocket"
)

type realtimeQueueService interface {
	AuthorizeViewer(context.Context, string, []byte) error
	AuthorizeCreator(context.Context, string, string) error
}

type realtimeHandler struct {
	service        realtimeQueueService
	hub            *realtime.Hub
	limiter        auth.RateLimiter
	logger         *slog.Logger
	allowedOrigins []string
	rateLimit      int
	rateWindow     time.Duration
	heartbeat      time.Duration
	writeTimeout   time.Duration
}

func (h realtimeHandler) viewer(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	token := viewerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "QUEUE_IDENTITY_REQUIRED", "Join this caller queue before connecting to live updates.")
		return
	}
	tokenIdentity := queuedomain.Hash(token)
	if !h.allow(w, r, showID, "viewer", hex.EncodeToString(tokenIdentity[:8])) {
		return
	}
	err := h.service.AuthorizeViewer(r.Context(), showID, tokenIdentity)
	if errors.Is(err, queuedomain.ErrEntryNotFound) {
		writeError(w, http.StatusUnauthorized, "QUEUE_IDENTITY_REQUIRED", "Join this caller queue before connecting to live updates.")
		return
	}
	if err != nil {
		h.logger.Error("realtime viewer authorization failed", "error", err, "show_id", showID)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Live updates are temporarily unavailable.")
		return
	}
	h.serve(w, r, showID)
}

func (h realtimeHandler) creator(w http.ResponseWriter, r *http.Request) {
	showID, ok := validShowID(w, r)
	if !ok {
		return
	}
	creator := creatorFromContext(r.Context())
	if !h.allow(w, r, showID, "creator", creator.ID) {
		return
	}
	if err := h.service.AuthorizeCreator(r.Context(), showID, creator.ID); err != nil {
		if errors.Is(err, queuedomain.ErrShowNotFound) {
			writeError(w, http.StatusNotFound, "SHOW_NOT_FOUND", "Show not found.")
			return
		}
		h.logger.Error("realtime creator authorization failed", "error", err, "show_id", showID)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Live updates are temporarily unavailable.")
		return
	}
	h.serve(w, r, showID)
}

func (h realtimeHandler) serve(w http.ResponseWriter, r *http.Request, showID string) {
	client, err := h.hub.Subscribe(r.Context(), showID)
	if errors.Is(err, realtime.ErrRoomFull) {
		writeError(w, http.StatusServiceUnavailable, "ROOM_AT_CAPACITY", "Live updates are at capacity; the page will continue to refresh.")
		return
	}
	if err != nil {
		h.logger.Error("realtime room subscription failed", "error", err, "show_id", showID)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Live updates are temporarily unavailable.")
		return
	}
	defer h.hub.Unsubscribe(showID, client)

	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.allowedOrigins})
	if err != nil {
		h.logger.Debug("websocket handshake rejected", "error", err, "show_id", showID)
		return
	}
	connection.SetReadLimit(1024)
	defer connection.CloseNow()

	connectionCtx, cancel := context.WithCancel(r.Context())
	completed := make(chan error, 2)
	go func() { completed <- h.readLoop(connectionCtx, connection) }()
	go func() { completed <- h.writeLoop(connectionCtx, connection, client) }()
	firstErr := <-completed
	cancel()
	<-completed
	if firstErr != nil && !isExpectedWebsocketClose(firstErr) && !errors.Is(firstErr, context.Canceled) {
		h.logger.Debug("websocket connection closed", "error", firstErr, "show_id", showID)
	}
}

func (h realtimeHandler) readLoop(ctx context.Context, connection *websocket.Conn) error {
	for {
		_, _, err := connection.Read(ctx)
		if err != nil {
			return err
		}
		return errors.New("client messages are not accepted")
	}
}

func (h realtimeHandler) writeLoop(ctx context.Context, connection *websocket.Conn, client *realtime.Client) error {
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
			pingCtx, cancel := context.WithTimeout(ctx, h.writeTimeout)
			err := connection.Ping(pingCtx)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (h realtimeHandler) allow(w http.ResponseWriter, r *http.Request, showID, role, subject string) bool {
	if h.limiter == nil {
		return true
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	identity := sha256.Sum256([]byte(ip))
	ipKey := fmt.Sprintf("realtime:%s:show:%s:ip:%s", role, showID, hex.EncodeToString(identity[:8]))
	allowed, err := h.limiter.Allow(r.Context(), ipKey, h.rateLimit*20, h.rateWindow)
	if err == nil && allowed {
		subjectKey := fmt.Sprintf("realtime:%s:show:%s:subject:%s", role, showID, subject)
		allowed, err = h.limiter.Allow(r.Context(), subjectKey, h.rateLimit, h.rateWindow)
	}
	if err != nil {
		h.logger.Error("realtime rate limiter failed", "error", err, "show_id", showID)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Live updates are temporarily unavailable.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(h.rateWindow.Seconds())))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many live-update connections. Please try again shortly.")
		return false
	}
	return true
}

func isExpectedWebsocketClose(err error) bool {
	status := websocket.CloseStatus(err)
	return status == websocket.StatusNormalClosure || status == websocket.StatusGoingAway
}
