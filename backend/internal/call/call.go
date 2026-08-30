package call

import (
	"context"
	"errors"
	"time"
)

type Status string

const (
	StatusCreated    Status = "CREATED"
	StatusConnecting Status = "CONNECTING"
	StatusLive       Status = "LIVE"
	StatusEnded      Status = "ENDED"
	StatusFailed     Status = "FAILED"
)

type SelectionMode string

const (
	SelectionManual SelectionMode = "MANUAL"
	SelectionRandom SelectionMode = "RANDOM"
)

var (
	ErrShowNotFound      = errors.New("show not found")
	ErrShowNotLive       = errors.New("show is not live")
	ErrCallerNotWaiting  = errors.New("caller is not waiting")
	ErrQueueEmpty        = errors.New("caller queue is empty")
	ErrActiveCall        = errors.New("show already has an active call")
	ErrCallNotFound      = errors.New("call not found")
	ErrInvalidTransition = errors.New("invalid call state transition")
)

type Caller struct {
	ID                  string `json:"id"`
	DisplayName         string `json:"displayName"`
	Topic               string `json:"topic"`
	TierName            string `json:"tierName"`
	PriorityRank        int    `json:"priorityRank"`
	CallDurationSeconds int    `json:"callDurationSeconds"`
}

type Call struct {
	ID                  string        `json:"id"`
	ShowID              string        `json:"showId"`
	QueueEntryID        string        `json:"queueEntryId"`
	Status              Status        `json:"status"`
	SelectionMode       SelectionMode `json:"selectionMode"`
	CallDurationSeconds int           `json:"callDurationSeconds"`
	StartedAt           *time.Time    `json:"startedAt"`
	EndedAt             *time.Time    `json:"endedAt"`
	CreatedAt           time.Time     `json:"createdAt"`
	UpdatedAt           time.Time     `json:"updatedAt"`
	Caller              Caller        `json:"caller"`
}

type Repository interface {
	Select(context.Context, string, string, string, SelectionMode, time.Time) (Call, error)
	CreatorActive(context.Context, string, string) (Call, error)
	ViewerLatest(context.Context, string, []byte) (Call, error)
	Transition(context.Context, string, string, string, Status, time.Time) (Call, error)
	AuthorizeCreator(context.Context, string, string, string) error
	AuthorizeViewer(context.Context, string, string, []byte) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (s *Service) SelectManual(ctx context.Context, showID, creatorID, entryID string) (Call, error) {
	if entryID == "" {
		return Call{}, ErrCallerNotWaiting
	}
	return s.repository.Select(ctx, showID, creatorID, entryID, SelectionManual, s.now().UTC())
}

func (s *Service) SelectRandom(ctx context.Context, showID, creatorID string) (Call, error) {
	return s.repository.Select(ctx, showID, creatorID, "", SelectionRandom, s.now().UTC())
}

func (s *Service) CreatorActive(ctx context.Context, showID, creatorID string) (Call, error) {
	return s.repository.CreatorActive(ctx, showID, creatorID)
}

func (s *Service) ViewerLatest(ctx context.Context, showID string, tokenHash []byte) (Call, error) {
	return s.repository.ViewerLatest(ctx, showID, tokenHash)
}

func (s *Service) Transition(ctx context.Context, showID, callID, creatorID string, target Status) (Call, error) {
	if target != StatusConnecting && target != StatusLive && target != StatusEnded && target != StatusFailed {
		return Call{}, ErrInvalidTransition
	}
	return s.repository.Transition(ctx, showID, callID, creatorID, target, s.now().UTC())
}

func (s *Service) AuthorizeCreator(ctx context.Context, showID, callID, creatorID string) error {
	return s.repository.AuthorizeCreator(ctx, showID, callID, creatorID)
}

func (s *Service) AuthorizeViewer(ctx context.Context, showID, callID string, tokenHash []byte) error {
	return s.repository.AuthorizeViewer(ctx, showID, callID, tokenHash)
}
