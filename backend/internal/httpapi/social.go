package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/bling-app/bling/backend/internal/auth"
	"github.com/bling-app/bling/backend/internal/social"
	"github.com/go-chi/chi/v5"
)

type socialHandler struct {
	trustedProxies []netip.Prefix
	service        *social.Service
	authentication authService
	limiter        auth.RateLimiter
	logger         *slog.Logger
	cookieSecure   bool
}

func (h *socialHandler) mount(api chi.Router) {
	api.Group(func(r chi.Router) {
		r.Use(h.guard)
		r.Get("/creators", h.list)
		r.Get("/creators/{username}", h.profile)
		r.Post("/creators/{username}/presence", h.presence)
		r.Group(func(p chi.Router) {
			p.Use(requireCreator(h.authentication, h.logger))
			p.Get("/following", h.following)
			p.Get("/following/count", h.followingCount)
			p.Post("/creators/{username}/follow", h.follow)
			p.Delete("/creators/{username}/follow", h.unfollow)
			p.Get("/profile", h.ownProfile)
			p.Post("/profile", h.saveProfile)
			p.Get("/notifications", h.notifications)
			p.Post("/notifications/read", h.markRead)
		})
	})
}
func (h *socialHandler) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		preventCaching(w)
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		if r.Method == http.MethodPost {
			kind, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if kind != "application/json" {
				writeError(w, 415, "INVALID_CONTENT_TYPE", "Use application/json.")
				return
			}
		}
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !h.allow(w, r, "ip:"+h.clientIP(ip, r.Header.Get("X-Forwarded-For")), 600) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Walk from the socket peer toward the client. Only explicitly trusted hops
// may supply the address to their left; arbitrary request headers cannot evade limits.
func (h *socialHandler) clientIP(peer, forwarded string) string {
	address, err := netip.ParseAddr(peer)
	if err != nil {
		return peer
	}
	address = address.Unmap()
	trusted := func(ip netip.Addr) bool {
		for _, prefix := range h.trustedProxies {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	if !trusted(address) || forwarded == "" || len(forwarded) > 2048 {
		return address.String()
	}
	hops := strings.Split(forwarded, ",")
	if len(hops) > 20 {
		return address.String()
	}
	for i := len(hops) - 1; i >= 0; i-- {
		if !trusted(address) {
			break
		}
		next, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return peer
		}
		address = next.Unmap()
	}
	return address.String()
}

func (h *socialHandler) allow(w http.ResponseWriter, r *http.Request, key string, limit int) bool {
	allowed, err := h.limiter.Allow(r.Context(), "social:"+key, limit, time.Minute)
	if err != nil {
		h.logger.Error("social rate limiter unavailable", "error", err)
		writeError(w, 503, "SERVICE_UNAVAILABLE", "Please try again shortly.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "RATE_LIMITED", "Too many requests. Please try again shortly.")
		return false
	}
	return true
}
func (h *socialHandler) viewer(r *http.Request) (string, error) {
	if sessionToken(r) == "" {
		return "", nil
	}
	u, err := h.authentication.CurrentUser(r.Context(), sessionToken(r))
	if errors.Is(err, auth.ErrInvalidSession) {
		return "", nil
	}
	return u.ID, err
}
func listOptions(r *http.Request) (social.ListOptions, error) {
	q := r.URL.Query()
	limit := 24
	var err error
	if q.Get("limit") != "" {
		limit, err = strconv.Atoi(q.Get("limit"))
		if err != nil {
			return social.ListOptions{}, social.ErrInvalid
		}
	}
	if q.Get("live") != "" && q.Get("live") != "true" && q.Get("live") != "false" {
		return social.ListOptions{}, social.ErrInvalid
	}
	o := social.ListOptions{Query: q.Get("q"), Category: q.Get("category"), Cursor: q.Get("cursor"), Live: q.Get("live") == "true", Following: r.URL.Path == "/api/v1/following", Limit: limit}
	return o, o.Validate()
}
func (h *socialHandler) list(w http.ResponseWriter, r *http.Request) {
	o, err := listOptions(r)
	if err != nil {
		h.fail(w, err)
		return
	}
	id, err := h.viewer(r)
	if err != nil {
		h.fail(w, err)
		return
	}
	result, err := h.service.List(r.Context(), o, id)
	h.respond(w, result, err)
}
func (h *socialHandler) following(w http.ResponseWriter, r *http.Request) {
	o, err := listOptions(r)
	if err != nil {
		h.fail(w, err)
		return
	}
	o.Following = true
	// Validate cursor scope after identifying the following collection.
	result, err := h.service.List(r.Context(), o, creatorFromContext(r.Context()).ID)
	h.respond(w, result, err)
}
func (h *socialHandler) followingCount(w http.ResponseWriter, r *http.Request) {
	n, err := h.service.Store.FollowingCount(r.Context(), creatorFromContext(r.Context()).ID)
	h.respond(w, map[string]int{"count": n}, err)
}
func (h *socialHandler) profile(w http.ResponseWriter, r *http.Request) {
	name := strings.ToLower(chi.URLParam(r, "username"))
	if !social.ValidUsername(name) {
		h.fail(w, social.ErrNotFound)
		return
	}
	id, err := h.viewer(r)
	if err != nil {
		h.fail(w, err)
		return
	}
	p, err := h.service.Profile(r.Context(), name, id)
	h.respond(w, p, err)
}
func (h *socialHandler) ownProfile(w http.ResponseWriter, r *http.Request) {
	p, err := h.service.Store.OwnProfile(r.Context(), creatorFromContext(r.Context()).ID)
	h.respond(w, p, err)
}
func (h *socialHandler) saveProfile(w http.ResponseWriter, r *http.Request) {
	id := creatorFromContext(r.Context()).ID
	if !h.allow(w, r, "profile:"+id, 20) {
		return
	}
	var input social.ProfileInput
	if decodeJSON(r, &input) != nil {
		h.fail(w, social.ErrInvalid)
		return
	}
	p, err := h.service.SaveProfile(r.Context(), id, input)
	h.respond(w, p, err)
}
func (h *socialHandler) follow(w http.ResponseWriter, r *http.Request)   { h.setFollow(w, r, true) }
func (h *socialHandler) unfollow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, false) }
func (h *socialHandler) setFollow(w http.ResponseWriter, r *http.Request, value bool) {
	id := creatorFromContext(r.Context()).ID
	name := strings.ToLower(chi.URLParam(r, "username"))
	if !social.ValidUsername(name) {
		h.fail(w, social.ErrNotFound)
		return
	}
	if !h.allow(w, r, "follow:"+id, 60) {
		return
	}
	following, err := h.service.Store.Follow(r.Context(), id, name, value)
	h.respond(w, map[string]bool{"isFollowing": following}, err)
}
func (h *socialHandler) notifications(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Store.Notifications(r.Context(), creatorFromContext(r.Context()).ID, r.URL.Query().Get("cursor"))
	h.respond(w, result, err)
}
func (h *socialHandler) markRead(w http.ResponseWriter, r *http.Request) {
	id := creatorFromContext(r.Context()).ID
	if !h.allow(w, r, "read:"+id, 120) {
		return
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if decodeJSON(r, &input) != nil || len(input.IDs) == 0 || len(input.IDs) > 50 {
		h.fail(w, social.ErrInvalid)
		return
	}
	ids := make([]int64, len(input.IDs))
	for i, raw := range input.IDs {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			h.fail(w, social.ErrInvalid)
			return
		}
		ids[i] = n
	}
	if err := h.service.Store.MarkRead(r.Context(), id, ids); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *socialHandler) presence(w http.ResponseWriter, r *http.Request) {
	name := strings.ToLower(chi.URLParam(r, "username"))
	if !social.ValidUsername(name) {
		h.fail(w, social.ErrNotFound)
		return
	}
	id, err := h.viewer(r)
	if err != nil {
		h.fail(w, err)
		return
	}
	actor := "user:" + id
	if id == "" {
		var token string
		if cookie, err := r.Cookie("bling_presence"); err == nil && len(cookie.Value) == 64 {
			if _, err := hex.DecodeString(cookie.Value); err == nil {
				token = cookie.Value
			}
		}
		if token == "" {
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				h.fail(w, err)
				return
			}
			token = hex.EncodeToString(b)
			http.SetCookie(w, &http.Cookie{Name: "bling_presence", Value: token, Path: "/", HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: 86400})
		}
		actor = "browser:" + token
	}
	digest := sha256.Sum256([]byte(actor))
	actor = hex.EncodeToString(digest[:])
	if !h.allow(w, r, "presence:"+actor+":"+name, 6) {
		return
	}
	count, err := h.service.Heartbeat(r.Context(), name, actor)
	if err != nil {
		if errors.Is(err, social.ErrNotFound) || errors.Is(err, social.ErrLiveRequired) {
			h.fail(w, err)
		} else {
			writeError(w, 503, "PRESENCE_UNAVAILABLE", "Channel presence is temporarily unavailable.")
		}
		return
	}
	h.respond(w, map[string]any{"channelVisitors": count, "expiresInSeconds": 90}, nil)
}
func (h *socialHandler) respond(w http.ResponseWriter, data any, err error) {
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"data": data})
}
func (h *socialHandler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, social.ErrNotFound):
		writeError(w, 404, "CREATOR_NOT_FOUND", "Creator not found.")
	case errors.Is(err, social.ErrInvalid):
		writeError(w, 422, "VALIDATION_FAILED", "Check your profile, filters, or pagination cursor.")
	case errors.Is(err, social.ErrSelfFollow), errors.Is(err, social.ErrFollowLimit):
		writeError(w, 422, "FOLLOW_NOT_ALLOWED", err.Error())
	case errors.Is(err, social.ErrLiveRequired):
		writeError(w, 409, "HOTLINE_CLOSED", "This creator is not live.")
	default:
		h.logger.Error("social request failed", "error", err)
		writeError(w, 500, "SOCIAL_UNAVAILABLE", "Unable to load this information. Please try again.")
	}
}
func (h *socialHandler) metrics() string {
	return fmt.Sprintf("# TYPE bling_social_cache_hits_total counter\nbling_social_cache_hits_total %d\n# TYPE bling_social_cache_misses_total counter\nbling_social_cache_misses_total %d\n# TYPE bling_social_presence_writes_total counter\nbling_social_presence_writes_total %d\n# TYPE bling_social_projection_batches_total counter\nbling_social_projection_batches_total %d\n# TYPE bling_social_errors_total counter\nbling_social_errors_total %d\n", h.service.CacheHits.Load(), h.service.CacheMisses.Load(), h.service.PresenceWrites.Load(), h.service.ProjectionBatches.Load(), h.service.Errors.Load())
}
