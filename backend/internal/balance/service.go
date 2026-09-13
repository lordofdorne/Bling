package balance

import (
	"context"
	"log/slog"
	"time"
)

type Service struct {
	repository Repository
	gateway    Gateway
	currency   string
	minimum    int64
	payoutDay  int
	enabled    bool
	logger     *slog.Logger
	now        func() time.Time
}

func NewService(repository Repository, gateway Gateway, currency string, minimum int64, payoutDay int, enabled bool, logger *slog.Logger) *Service {
	return &Service{repository: repository, gateway: gateway, currency: currency, minimum: minimum, payoutDay: payoutDay, enabled: enabled, logger: logger, now: time.Now}
}

func (s *Service) Summary(ctx context.Context, creatorID string) (Summary, error) {
	value, err := s.repository.Summary(ctx, creatorID, s.currency, s.now().UTC())
	if err == nil {
		next := nextPayout(s.now().UTC(), s.payoutDay)
		value.NextPayoutAt = &next
	}
	return value, err
}
func (s *Service) Entries(ctx context.Context, creatorID string, limit int) ([]Entry, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	return s.repository.Entries(ctx, creatorID, s.currency, limit)
}

func (s *Service) Run(ctx context.Context) {
	if !s.enabled || s.gateway == nil {
		return
	}
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	s.runDue(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runDue(ctx)
		}
	}
}
func (s *Service) runDue(ctx context.Context) {
	now := s.now().UTC()
	scheduled := time.Date(now.Year(), now.Month(), s.payoutDay, 0, 0, 0, 0, time.UTC)
	if now.Before(scheduled) {
		scheduled = scheduled.AddDate(0, -1, 0)
	}
	end := time.Date(scheduled.Year(), scheduled.Month(), 1, 0, 0, 0, 0, time.UTC)
	start := end.AddDate(0, -1, 0)
	if err := s.repository.CreateMonthlyRun(ctx, start, end, s.currency, s.minimum, now); err != nil {
		s.logger.Error("create monthly creator payout run failed", "error", err)
		return
	}
	for {
		items, err := s.repository.ClaimTransfers(ctx, now, 25)
		if err != nil {
			s.logger.Error("claim creator payout transfers failed", "error", err)
			return
		}
		for _, item := range items {
			result, transferErr := s.gateway.Transfer(ctx, item)
			if transferErr != nil {
				_ = s.repository.MarkRetry(ctx, item, "provider_error", now)
				continue
			}
			_ = s.repository.MarkPaid(ctx, item.ItemID, result.ID, now)
		}
		if len(items) < 25 {
			break
		}
	}
	_ = s.repository.FinishRuns(ctx, now)
}
func nextPayout(now time.Time, day int) time.Time {
	candidate := time.Date(now.Year(), now.Month(), day, 0, 0, 0, 0, time.UTC)
	if !candidate.After(now) {
		candidate = candidate.AddDate(0, 1, 0)
	}
	return candidate
}
