package show

import (
	"context"
	"errors"
	"time"
)

type Status string

const (
	StatusCreated Status = "CREATED"
	StatusLive    Status = "LIVE"
	StatusEnded   Status = "ENDED"
)

var (
	ErrNotFound          = errors.New("show not found")
	ErrActiveShowExists  = errors.New("creator already has a live show")
	ErrInvalidTransition = errors.New("show state transition is not allowed")
)

type Show struct {
	ID        string     `json:"id"`
	CreatorID string     `json:"creatorId"`
	Status    Status     `json:"status"`
	StartedAt *time.Time `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type Action string

const (
	ActionStart Action = "START"
	ActionEnd   Action = "END"
)

func Transition(current Status, action Action) (Status, error) {
	switch {
	case action == ActionStart && current == StatusCreated:
		return StatusLive, nil
	case action == ActionStart && current == StatusLive:
		return StatusLive, nil
	case action == ActionEnd && current == StatusLive:
		return StatusEnded, nil
	case action == ActionEnd && current == StatusEnded:
		return StatusEnded, nil
	default:
		return current, ErrInvalidTransition
	}
}

type Store interface {
	Create(context.Context, string) (Show, error)
	ByIDForCreator(context.Context, string, string) (Show, error)
	Start(context.Context, string, string, time.Time) (Show, error)
	End(context.Context, string, string, time.Time) (Show, error)
	LiveByUsername(context.Context, string) (Show, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service { return &Service{store: store, now: time.Now} }

func (s *Service) Create(ctx context.Context, creatorID string) (Show, error) {
	return s.store.Create(ctx, creatorID)
}

func (s *Service) Get(ctx context.Context, showID, creatorID string) (Show, error) {
	return s.store.ByIDForCreator(ctx, showID, creatorID)
}

func (s *Service) Start(ctx context.Context, showID, creatorID string) (Show, error) {
	return s.store.Start(ctx, showID, creatorID, s.now())
}

func (s *Service) End(ctx context.Context, showID, creatorID string) (Show, error) {
	return s.store.End(ctx, showID, creatorID, s.now())
}

func (s *Service) LiveByUsername(ctx context.Context, username string) (Show, error) {
	return s.store.LiveByUsername(ctx, username)
}
