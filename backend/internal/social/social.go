package social

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrNotFound = errors.New("creator not found")
var ErrInvalid = errors.New("invalid social request")
var ErrSelfFollow = errors.New("you cannot follow yourself")
var ErrFollowLimit = errors.New("you can follow up to 1000 creators")
var ErrLiveRequired = errors.New("this creator is not live")
var Categories = []string{"Just chatting", "Music", "Gaming", "Creative", "Tech"}
var usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,30}$`)
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func ValidUsername(s string) bool { return usernamePattern.MatchString(s) }

type Profile struct {
	ID              string     `json:"id"`
	Username        string     `json:"username"`
	DisplayName     string     `json:"displayName"`
	Bio             string     `json:"bio"`
	AvatarURL       string     `json:"avatarUrl"`
	CoverURL        string     `json:"coverUrl"`
	Category        string     `json:"category"`
	Published       bool       `json:"published"`
	FollowerCount   int64      `json:"followerCount"`
	IsLive          bool       `json:"isLive"`
	LiveShowID      *string    `json:"liveShowId"`
	LiveStartedAt   *time.Time `json:"liveStartedAt"`
	IsFollowing     bool       `json:"isFollowing"`
	ChannelVisitors *int64     `json:"channelVisitors"`
}
type ProfileInput struct {
	DisplayName string `json:"displayName"`
	Bio         string `json:"bio"`
	AvatarURL   string `json:"avatarUrl"`
	CoverURL    string `json:"coverUrl"`
	Category    string `json:"category"`
	Published   bool   `json:"published"`
}

func (p *ProfileInput) Validate() error {
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	p.Bio = strings.TrimSpace(p.Bio)
	p.AvatarURL = strings.TrimSpace(p.AvatarURL)
	p.CoverURL = strings.TrimSpace(p.CoverURL)
	if utf8.RuneCountInString(p.DisplayName) < 1 || utf8.RuneCountInString(p.DisplayName) > 60 || utf8.RuneCountInString(p.Bio) > 500 || !validCategory(p.Category) {
		return ErrInvalid
	}
	for _, raw := range []string{p.AvatarURL, p.CoverURL} {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || len(raw) > 2048 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return ErrInvalid
		}
	}
	return nil
}
func validCategory(s string) bool {
	for _, c := range Categories {
		if s == c {
			return true
		}
	}
	return false
}

type ListOptions struct {
	Query, Category, Cursor string
	Live, Following         bool
	Limit                   int
}
type Page struct {
	Items      []Profile `json:"items"`
	NextCursor string    `json:"nextCursor,omitempty"`
}
type directoryCursor struct {
	Live  bool   `json:"l"`
	Count int64  `json:"n"`
	ID    string `json:"id"`
	Scope string `json:"s"`
}

func (o ListOptions) scope() string {
	b, _ := json.Marshal([]any{o.Query, o.Category, o.Live, o.Following})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:8])
}
func (o *ListOptions) Validate() error {
	o.Query = strings.TrimSpace(o.Query)
	if o.Limit == 0 {
		o.Limit = 24
	}
	if o.Limit < 1 || o.Limit > 50 || utf8.RuneCountInString(o.Query) > 80 || len(o.Cursor) > 512 || (o.Category != "" && !validCategory(o.Category)) {
		return ErrInvalid
	}
	_, err := o.decodeCursor()
	return err
}
func (o ListOptions) decodeCursor() (*directoryCursor, error) {
	if o.Cursor == "" {
		return nil, nil
	}
	var c directoryCursor
	b, err := base64.RawURLEncoding.DecodeString(o.Cursor)
	if err != nil || json.Unmarshal(b, &c) != nil || !uuidPattern.MatchString(c.ID) || c.Count < 0 || c.Scope != o.scope() {
		return nil, ErrInvalid
	}
	return &c, nil
}
func encodeCursor(v any) string {
	b, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(b)
}

type Notification struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	AvatarURL   string    `json:"avatarUrl"`
	ShowID      string    `json:"showId"`
	CreatedAt   time.Time `json:"createdAt"`
	IsLive      bool      `json:"isLive"`
	Read        bool      `json:"read"`
}
type Notifications struct {
	Items        []Notification `json:"items"`
	NextCursor   string         `json:"nextCursor,omitempty"`
	UnreadCount  int            `json:"unreadCount"`
	UnreadCapped bool           `json:"unreadCapped"`
}
type notificationCursor struct {
	At time.Time `json:"at"`
	ID int64     `json:"id"`
}

func decodeNotificationCursor(raw string) (*notificationCursor, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 256 {
		return nil, ErrInvalid
	}
	var c notificationCursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(b, &c) != nil || c.At.IsZero() || c.ID < 1 {
		return nil, ErrInvalid
	}
	return &c, nil
}
