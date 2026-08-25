package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/bling-app/bling/backend/internal/auth"
)

type creatorContextKey struct{}

func requireCreator(service authService, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := service.CurrentUser(r.Context(), sessionToken(r))
			if errors.Is(err, auth.ErrInvalidSession) {
				writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in to continue.")
				return
			}
			if err != nil {
				logger.Error("protected session lookup failed", "error", err)
				writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to verify your account.")
				return
			}
			ctx := context.WithValue(r.Context(), creatorContextKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func creatorFromContext(ctx context.Context) auth.User {
	user, _ := ctx.Value(creatorContextKey{}).(auth.User)
	return user
}
