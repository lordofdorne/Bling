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

const (
	sessionCookieName  = "bling_session"
	recoveryCookieName = "bling_recovery"
)

type authService interface {
	Register(context.Context, auth.RegisterInput) (auth.User, string, error)
	Login(context.Context, string, string) (auth.User, string, error)
	CurrentUser(context.Context, string) (auth.User, error)
	Logout(context.Context, string) error
}

type authLifecycleService interface {
	ConfirmEmail(context.Context, string) (auth.User, string, error)
	ResendConfirmation(context.Context, string) error
	ForgotPassword(context.Context, string) error
	BeginPasswordReset(context.Context, string) (string, error)
	ResetPassword(context.Context, string, string) error
}

type authHandler struct {
	service      authService
	lifecycle    authLifecycleService
	limiter      auth.RateLimiter
	logger       *slog.Logger
	cookieSecure bool
	sessionTTL   time.Duration
	rateWindow   time.Duration
	frontendURL  string
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
	if h.lifecycle != nil {
		router.Get("/confirm", h.confirmEmail)
		router.Post("/resend-confirmation", h.resendConfirmation)
		router.Post("/forgot-password", h.forgotPassword)
		router.Get("/reset", h.beginPasswordReset)
		router.Post("/reset-password", h.resetPassword)
	}
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
	if token == "" {
		writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{
			"user": user, "confirmationRequired": true,
		}})
		return
	}
	h.setSessionCookie(w, token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"user": user, "confirmationRequired": false}})
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

func (h authHandler) confirmEmail(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	tokenHash := r.URL.Query().Get("token_hash")
	if tokenHash == "" || len(tokenHash) > 2048 {
		h.writeAuthError(w, auth.ErrInvalidIdentityToken)
		return
	}
	if !h.allow(w, r, "confirm", tokenHash, 10) {
		return
	}
	_, session, err := h.lifecycle.ConfirmEmail(r.Context(), tokenHash)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}
	h.setSessionCookie(w, session)
	h.redirectToFrontend(w, r, "/dashboard?emailConfirmed=1")
}

func (h authHandler) resendConfirmation(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	var request struct {
		Email string `json:"email"`
	}
	if decodeJSON(r, &request) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid email address.")
		return
	}
	if !h.allow(w, r, "resend-confirmation", request.Email, 3) {
		return
	}
	if err := h.lifecycle.ResendConfirmation(r.Context(), request.Email); err != nil {
		h.writeAuthError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h authHandler) forgotPassword(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	var request struct {
		Email string `json:"email"`
	}
	if decodeJSON(r, &request) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid email address.")
		return
	}
	if !h.allow(w, r, "forgot-password", request.Email, 3) {
		return
	}
	if err := h.lifecycle.ForgotPassword(r.Context(), request.Email); err != nil {
		if errors.Is(err, auth.ErrInvalidEmail) {
			// Preserve the non-enumerating response for malformed and unknown emails.
			w.WriteHeader(http.StatusAccepted)
			return
		}
		h.writeAuthError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h authHandler) beginPasswordReset(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	tokenHash := r.URL.Query().Get("token_hash")
	if tokenHash == "" || len(tokenHash) > 2048 {
		h.writeAuthError(w, auth.ErrInvalidIdentityToken)
		return
	}
	if !h.allow(w, r, "begin-password-reset", tokenHash, 10) {
		return
	}
	grant, err := h.lifecycle.BeginPasswordReset(r.Context(), tokenHash)
	if err != nil {
		h.writeAuthError(w, err)
		return
	}
	h.setRecoveryCookie(w, grant)
	h.redirectToFrontend(w, r, "/reset-password")
}

func (h authHandler) resetPassword(w http.ResponseWriter, r *http.Request) {
	preventCaching(w)
	var request struct {
		Password string `json:"password"`
	}
	if decodeJSON(r, &request) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Provide a valid new password.")
		return
	}
	grant := recoveryToken(r)
	if !h.allow(w, r, "reset-password", grant, 5) {
		return
	}
	if err := h.lifecycle.ResetPassword(r.Context(), grant, request.Password); err != nil {
		h.writeAuthError(w, err)
		return
	}
	h.clearRecoveryCookie(w)
	w.WriteHeader(http.StatusNoContent)
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
	case errors.Is(err, auth.ErrEmailUnconfirmed):
		writeError(w, http.StatusForbidden, "EMAIL_UNCONFIRMED", "Confirm your email address to continue.")
	case errors.Is(err, auth.ErrInvalidIdentityToken):
		writeError(w, http.StatusBadRequest, "INVALID_OR_EXPIRED_TOKEN", "This link is invalid or has expired.")
	case errors.Is(err, auth.ErrProviderRateLimited):
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many attempts. Please try again shortly.")
	case errors.Is(err, auth.ErrIdentityProvider):
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable.")
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

func (h authHandler) setRecoveryCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: recoveryCookieName, Value: token, Path: "/api/v1/auth", HttpOnly: true, Secure: h.cookieSecure,
		SameSite: http.SameSiteStrictMode, MaxAge: 15 * 60, Expires: time.Now().Add(15 * time.Minute),
	})
}

func (h authHandler) clearRecoveryCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: recoveryCookieName, Value: "", Path: "/api/v1/auth", HttpOnly: true, Secure: h.cookieSecure,
		SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: time.Unix(1, 0),
	})
}

func (h authHandler) redirectToFrontend(w http.ResponseWriter, r *http.Request, path string) {
	destination := strings.TrimRight(h.frontendURL, "/") + path
	if h.frontendURL == "" {
		destination = path
	}
	http.Redirect(w, r, destination, http.StatusSeeOther)
}

func sessionToken(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func recoveryToken(r *http.Request) string {
	cookie, err := r.Cookie(recoveryCookieName)
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
