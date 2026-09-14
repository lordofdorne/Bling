package show

import (
	"context"
	"errors"
	"strings"
	"time"
)

type Status string

const (
	StatusCreated Status = "CREATED"
	StatusLive    Status = "LIVE"
	StatusEnded   Status = "ENDED"
)

var (
	ErrNotFound            = errors.New("show not found")
	ErrActiveShowExists    = errors.New("creator already has a live show")
	ErrInvalidTransition   = errors.New("show state transition is not allowed")
	ErrTierConfiguration   = errors.New("invalid tier configuration")
	ErrShowNotConfigurable = errors.New("show tiers can only be changed before the show starts")
	ErrPayoutSetupRequired = errors.New("payout setup is required before a paid show can start")
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

type Tier struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	PriorityRank        int       `json:"priorityRank"`
	CallDurationSeconds int       `json:"callDurationSeconds"`
	PriceCents          int       `json:"priceCents"`
	Enabled             bool      `json:"enabled"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type TierInput struct {
	Name                string `json:"name"`
	CallDurationSeconds int    `json:"callDurationSeconds"`
	PriceCents          int    `json:"priceCents"`
	Enabled             bool   `json:"enabled"`
	PriorityRank        int    `json:"-"`
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
	Start(context.Context, string, string, time.Time, bool) (Show, error)
	End(context.Context, string, string, time.Time) (Show, error)
	LiveByUsername(context.Context, string) (Show, error)
	CurrentForCreator(context.Context, string) (Show, error)
	TiersForCreator(context.Context, string, string) ([]Tier, error)
	ReplaceTiers(context.Context, string, string, []TierInput, time.Time) ([]Tier, error)
}

// PayoutReadiness reports whether Bling can pay a creator. A show cannot charge
// callers before its creator can be paid, so the show service consults it
// before starting a show that has an enabled paid tier.
type PayoutReadiness interface {
	Ready(context.Context, string) (bool, error)
}

type Service struct {
	store   Store
	payouts PayoutReadiness
	now     func() time.Time
}

func NewService(store Store) *Service { return &Service{store: store, now: time.Now} }

// WithPayouts attaches the payout readiness source. Without it no paid show can
// start, because an unattached service can never establish that the creator is
// able to receive the money it would collect.
func (s *Service) WithPayouts(payouts PayoutReadiness) *Service {
	s.payouts = payouts
	return s
}

func (s *Service) Create(ctx context.Context, creatorID string) (Show, error) {
	return s.store.Create(ctx, creatorID)
}

func (s *Service) Get(ctx context.Context, showID, creatorID string) (Show, error) {
	return s.store.ByIDForCreator(ctx, showID, creatorID)
}

// Start opens the show to callers.
//
// A show with an enabled paid tier charges callers for the call, so the creator
// must have completed payout setup first; otherwise Bling would take money for
// a creator it cannot pay. Readiness is resolved here and handed to the store,
// which re-reads the tiers under the same lock that flips the show LIVE, so a
// tier configuration racing this call cannot slip a paid tier past the check.
func (s *Service) Start(ctx context.Context, showID, creatorID string) (Show, error) {
	ready, err := s.payoutReadyForShow(ctx, showID, creatorID)
	if err != nil {
		return Show{}, err
	}
	return s.store.Start(ctx, showID, creatorID, s.now(), ready)
}

func (s *Service) payoutReadyForShow(ctx context.Context, showID, creatorID string) (bool, error) {
	tiers, err := s.store.TiersForCreator(ctx, showID, creatorID)
	if err != nil {
		return false, err
	}
	paid := false
	for _, tier := range tiers {
		if tier.Enabled && tier.PriceCents > 0 {
			paid = true
			break
		}
	}
	// A free show never needs payout setup, and resolving readiness can call
	// Stripe, so it is not worth asking for one.
	if !paid || s.payouts == nil {
		return false, nil
	}
	return s.payouts.Ready(ctx, creatorID)
}

func (s *Service) End(ctx context.Context, showID, creatorID string) (Show, error) {
	return s.store.End(ctx, showID, creatorID, s.now())
}

func (s *Service) LiveByUsername(ctx context.Context, username string) (Show, error) {
	return s.store.LiveByUsername(ctx, username)
}

func (s *Service) Current(ctx context.Context, creatorID string) (Show, error) {
	return s.store.CurrentForCreator(ctx, creatorID)
}

func (s *Service) Tiers(ctx context.Context, showID, creatorID string) ([]Tier, error) {
	return s.store.TiersForCreator(ctx, showID, creatorID)
}

func (s *Service) ReplaceTiers(ctx context.Context, showID, creatorID string, tiers []TierInput) ([]Tier, error) {
	if len(tiers) < 1 || len(tiers) > 5 {
		return nil, ErrTierConfiguration
	}
	seen := make(map[string]struct{}, len(tiers))
	enabled := 0
	for index := range tiers {
		tiers[index].Name = strings.TrimSpace(tiers[index].Name)
		key := strings.ToLower(tiers[index].Name)
		if len(tiers[index].Name) < 1 || len(tiers[index].Name) > 40 || tiers[index].CallDurationSeconds < 30 || tiers[index].CallDurationSeconds > 3600 || tiers[index].PriceCents < 0 || (tiers[index].PriceCents > 0 && tiers[index].PriceCents < 50) || tiers[index].PriceCents > 1000000 {
			return nil, ErrTierConfiguration
		}
		if _, exists := seen[key]; exists {
			return nil, ErrTierConfiguration
		}
		seen[key] = struct{}{}
		if tiers[index].Enabled {
			enabled++
		}
		// The request order is authoritative; clients cannot manufacture rank.
		tiers[index].PriorityRank = (len(tiers) - index) * 100
	}
	if enabled == 0 {
		return nil, ErrTierConfiguration
	}
	return s.store.ReplaceTiers(ctx, showID, creatorID, tiers, s.now().UTC())
}
