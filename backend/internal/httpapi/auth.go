package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	"github.com/go-chi/chi/v5"
)

const sessionCookieName = "bling_session"

type authService interface {
	Register(context.Context, auth.RegisterInput) (auth.User, string, error)
	Login(context.Context, string, string) (auth.User, string, error)
	CurrentUser(context.Context, string) (auth.User, error)
	Logout(context.Context, string) error
}

type authHandler struct {
	service      authService
	limiter      auth.RateLimiter
	logger       *slog.Logger
	cookieSecure bool
	sessionTTL   time.Duration
	rateWindow   time.Duration
}

type authRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h authHandler) routes() chi.Router {
	router := chi.NewRouter()
	router.Post("/register", h.register)
	router.Post("/login", h.login)
	router.Post("/logout", h.logout)
	return router
}

func (h authHandler) register(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	var request authRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid username, email, and password.")
		return
	}
	if !h.allow(w, r, "register", request.Email, 5) {
		return
	}

	user, token, err := h.service.Register(r.Context(), auth.RegisterInput{
		Username: request.Username,
		Email:    request.Email,
		Password: request.Password,
	})
	if err != nil {
		h.writeAuthError(w, err)
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"user": user}})
}

func (h authHandler) login(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	var request authRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid email and password.")
		return
	}
	if !h.allow(w, r, "login", request.Email, 10) {
		return
	}

	user, token, err := h.service.Login(r.Context(), request.Email, request.Password)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user": user}})
}

func (h authHandler) logout(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	token := sessionToken(r)
	if err := h.service.Logout(r.Context(), token); err != nil {
		h.logger.Error("logout failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to log out right now.")
		return
	}
	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h authHandler) me(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	user, err := h.service.CurrentUser(r.Context(), sessionToken(r))
	if errors.Is(err, auth.ErrInvalidSession) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in to continue.")
		return
	}
	if err != nil {
		h.logger.Error("session lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load your account.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user": user}})
}

func preventCaching(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}

func (h authHandler) allow(w http.ResponseWriter, r *http.Request, action, email string, limit int) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	identity := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	allowed, err := h.limiter.Allow(r.Context(), fmt.Sprintf("auth:%s:ip:%s", action, ip), limit*5, h.rateWindow)
	if err == nil && allowed {
		allowed, err = h.limiter.Allow(r.Context(), fmt.Sprintf("auth:%s:identity:%s", action, hex.EncodeToString(identity[:8])), limit, h.rateWindow)
	}
	if err != nil {
		h.logger.Error("auth rate limiter failed", "error", err, "action", action)
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(h.rateWindow.Seconds())))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many attempts. Please try again shortly.")
		return false
	}
	return true
}

func (h authHandler) writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email or password is incorrect.")
	case errors.Is(err, auth.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "USERNAME_TAKEN", "That username is unavailable.")
	case errors.Is(err, auth.ErrEmailTaken):
		writeError(w, http.StatusConflict, "EMAIL_TAKEN", "An account already uses that email.")
	case errors.Is(err, auth.ErrInvalidUsername), errors.Is(err, auth.ErrInvalidEmail), errors.Is(err, auth.ErrInvalidPassword):
		writeError(w, http.StatusUnprocessableEntity, "VALIDATION_FAILED", err.Error())
	default:
		h.logger.Error("authentication request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to complete authentication.")
	}
}

func (h authHandler) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: token, Path: "/", HttpOnly: true, Secure: h.cookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(h.sessionTTL.Seconds()), Expires: time.Now().Add(h.sessionTTL),
	})
}

func (h authHandler) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: "", Path: "/", HttpOnly: true, Secure: h.cookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0),
	})
}

func sessionToken(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func decodeJSON(r *http.Request, destination any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain exactly one JSON object")
	}
	return nil
}
