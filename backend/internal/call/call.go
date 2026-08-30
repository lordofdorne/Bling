package call

import (
	"context"
	"errors"
	"log/slog"
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
	ExpiresAt           *time.Time    `json:"expiresAt"`
	CreatedAt           time.Time     `json:"createdAt"`
	UpdatedAt           time.Time     `json:"updatedAt"`
	Caller              Caller        `json:"caller"`
}

type Repository interface {
	Select(context.Context, string, string, string, SelectionMode, time.Time) (Call, error)
	CreatorActive(context.Context, string, string) (Call, error)
	ViewerLatest(context.Context, string, []byte) (Call, error)
	Transition(context.Context, string, string, string, Status, time.Time) (Call, error)
	TransitionViewer(context.Context, string, string, []byte, Status, time.Time) (Call, error)
	ExpireDue(context.Context, time.Time, int) ([]Call, error)
	AuthorizeCreator(context.Context, string, string, string) error
	AuthorizeViewer(context.Context, string, string, []byte) error
}

type Service struct {
	repository Repository
	now        func() time.Time
	logger     *slog.Logger
}

func NewService(repository Repository, loggers ...*slog.Logger) *Service {
	logger := slog.Default()
	if len(loggers) > 0 && loggers[0] != nil {
		logger = loggers[0]
	}
	return &Service{repository: repository, now: time.Now, logger: logger}
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

func (s *Service) TransitionViewer(ctx context.Context, showID, callID string, tokenHash []byte, target Status) (Call, error) {
	if target != StatusLive && target != StatusEnded && target != StatusFailed {
		return Call{}, ErrInvalidTransition
	}
	return s.repository.TransitionViewer(ctx, showID, callID, tokenHash, target, s.now().UTC())
}

func (s *Service) RunTimeouts(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for {
				expired, err := s.repository.ExpireDue(ctx, s.now().UTC(), 100)
				if err != nil {
					s.logger.Error("call timeout sweep failed", "error", err)
					break
				}
				if len(expired) < 100 {
					break
				}
			}
		}
	}
}

func (s *Service) AuthorizeCreator(ctx context.Context, showID, callID, creatorID string) error {
	return s.repository.AuthorizeCreator(ctx, showID, callID, creatorID)
}

func (s *Service) AuthorizeViewer(ctx context.Context, showID, callID string, tokenHash []byte) error {
	return s.repository.AuthorizeViewer(ctx, showID, callID, tokenHash)
}
