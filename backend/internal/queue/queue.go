package queue

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

type Status string

const (
	StatusWaiting Status = "WAITING"
	StatusLeft    Status = "LEFT"
)

var (
	ErrShowNotLive   = errors.New("show is not live")
	ErrTierNotFound  = errors.New("queue tier not found")
	ErrEntryNotFound = errors.New("queue entry not found")
	ErrShowNotFound  = errors.New("show not found")
	ErrInvalidName   = errors.New("display name must be 1-60 characters")
	ErrInvalidTopic  = errors.New("topic must be 1-280 characters")
	ErrCannotLeave   = errors.New("queue entry cannot leave from its current state")
)

type Tier struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	PriorityRank        int    `json:"priorityRank"`
	CallDurationSeconds int    `json:"callDurationSeconds"`
}

type Entry struct {
	ID                  string     `json:"id"`
	ShowID              string     `json:"showId"`
	DisplayName         string     `json:"displayName"`
	Topic               string     `json:"topic"`
	Status              Status     `json:"status"`
	TierID              string     `json:"tierId"`
	TierName            string     `json:"tierName"`
	PriorityRank        int        `json:"priorityRank"`
	CallDurationSeconds int        `json:"callDurationSeconds"`
	QueuePosition       int64      `json:"-"`
	JoinedAt            time.Time  `json:"joinedAt"`
	SelectedAt          *time.Time `json:"selectedAt"`
	LeftAt              *time.Time `json:"leftAt"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type ViewerState struct {
	Entry    Entry `json:"entry"`
	Position int64 `json:"position"`
}

type JoinInput struct {
	ShowID           string
	TierID           string
	DisplayName      string
	Topic            string
	SessionTokenHash []byte
	JoinKeyHash      []byte
}

func (input *JoinInput) NormalizeAndValidate() error {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Topic = strings.TrimSpace(input.Topic)
	if len(input.DisplayName) < 1 || len(input.DisplayName) > 60 {
		return ErrInvalidName
	}
	if len(input.Topic) < 1 || len(input.Topic) > 280 {
		return ErrInvalidTopic
	}
	return nil
}

func NewToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func Hash(value string) []byte {
	hash := sha256.Sum256([]byte(value))
	return hash[:]
}

type Repository interface {
	Join(context.Context, JoinInput) (Entry, error)
	Me(context.Context, string, []byte) (ViewerState, error)
	Leave(context.Context, string, []byte, time.Time) (Entry, error)
	ListWaiting(context.Context, string, string, int, int) ([]Entry, error)
	EntriesByIDs(context.Context, string, string, []string) ([]Entry, error)
	Tiers(context.Context, string) ([]Tier, error)
	AuthorizeShow(context.Context, string, string) error
	AuthorizeViewer(context.Context, string, []byte) error
	PendingOutbox(context.Context, int) ([]OutboxEvent, error)
	MarkOutboxPublished(context.Context, []int64, time.Time) error
}

type Candidate struct {
	EntryID       string `json:"entryId"`
	ShowID        string `json:"showId"`
	PriorityRank  int    `json:"priorityRank"`
	QueuePosition int64  `json:"queuePosition"`
}

type OutboxEvent struct {
	ID        int64
	EventType string
	Candidate Candidate
}

type CandidateIndex interface {
	Add(context.Context, Candidate) error
	Remove(context.Context, Candidate) error
	Position(context.Context, Candidate) (int64, error)
	List(context.Context, string, int, int) ([]string, error)
	Clear(context.Context, string) error
}

type EventPublisher interface {
	PublishQueueEvent(context.Context, string, string) error
}
