package finance

import (
	"context"
	"log/slog"
	"time"
)

type Service struct {
	repository Repository
	gateway    Gateway
	logger     *slog.Logger
	now        func() time.Time
}

func NewService(repository Repository, gateway Gateway, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{repository: repository, gateway: gateway, logger: logger, now: time.Now}
}

func (s *Service) Enabled() bool { return s != nil && s.gateway != nil }

func (s *Service) ClaimEvent(ctx context.Context, id, eventType, connectedAccountID string) (EventClaim, error) {
	return s.repository.ClaimEvent(ctx, id, eventType, connectedAccountID, s.now().UTC())
}

func (s *Service) CompleteEvent(ctx context.Context, id string) error {
	return s.repository.CompleteEvent(ctx, id, s.now().UTC())
}

func (s *Service) FailEvent(ctx context.Context, id, code string) error {
	return s.repository.FailEvent(ctx, id, code, s.now().UTC())
}

func (s *Service) ReconcileRefund(ctx context.Context, refundID, intentID string, status RefundStatus, failureCode string) error {
	return s.repository.ReconcileRefund(ctx, refundID, intentID, status, failureCode, s.now().UTC())
}

func (s *Service) ReconcileDispute(ctx context.Context, dispute Dispute) error {
	return s.repository.UpsertDispute(ctx, dispute, s.now().UTC())
}

func (s *Service) ReconcilePayout(ctx context.Context, payout Payout) error {
	return s.repository.UpsertPayout(ctx, payout, s.now().UTC())
}

func (s *Service) Activity(ctx context.Context, creatorID string) ([]Activity, error) {
	return s.repository.ActivityForCreator(ctx, creatorID, 50)
}

func (s *Service) LatestPayoutFailure(ctx context.Context, creatorID string) (*PayoutFailure, error) {
	return s.repository.LatestPayoutFailure(ctx, creatorID)
}

func (s *Service) Run(ctx context.Context) {
	if !s.Enabled() {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.processRefunds(ctx, 25); err != nil {
				s.logger.Error("payment refund sweep failed", "error", err)
			}
		}
	}
}

func (s *Service) processRefunds(ctx context.Context, limit int) error {
	requests, err := s.repository.ClaimRefunds(ctx, s.now().UTC(), limit)
	if err != nil {
		return err
	}
	for _, request := range requests {
		result, refundErr := s.gateway.Refund(ctx, request)
		now := s.now().UTC()
		if refundErr != nil {
			if err := s.repository.MarkRefundRetry(ctx, request, "provider_error", now); err != nil {
				return err
			}
			continue
		}
		if err := s.repository.MarkRefundResult(ctx, request, result, now); err != nil {
			return err
		}
	}
	return nil
}
