package queue

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

type Service struct {
	repository Repository
	index      CandidateIndex
	publisher  EventPublisher
	logger     *slog.Logger
	now        func() time.Time
}

func NewService(repository Repository, index CandidateIndex, publisher EventPublisher, logger *slog.Logger) *Service {
	return &Service{repository: repository, index: index, publisher: publisher, logger: logger, now: time.Now}
}

func (s *Service) Join(ctx context.Context, input JoinInput) (ViewerState, error) {
	if err := input.NormalizeAndValidate(); err != nil {
		return ViewerState{}, err
	}
	entry, err := s.repository.Join(ctx, input)
	if err != nil {
		return ViewerState{}, err
	}
	candidate := candidateFromEntry(entry)
	if err := s.index.Add(ctx, candidate); err != nil {
		s.logger.Warn("queue index update deferred to outbox", "error", err, "show_id", entry.ShowID, "queue_entry_id", entry.ID)
	}
	position, err := s.index.Position(ctx, candidate)
	if err != nil {
		state, repositoryErr := s.repository.Me(ctx, entry.ShowID, input.SessionTokenHash)
		if repositoryErr != nil {
			return ViewerState{}, repositoryErr
		}
		return state, nil
	}
	return ViewerState{Entry: entry, Position: position}, nil
}

func (s *Service) Me(ctx context.Context, showID string, tokenHash []byte) (ViewerState, error) {
	state, err := s.repository.Me(ctx, showID, tokenHash)
	if err != nil || state.Entry.Status != StatusWaiting {
		return state, err
	}
	position, indexErr := s.index.Position(ctx, candidateFromEntry(state.Entry))
	if indexErr == nil {
		state.Position = position
	}
	return state, nil
}

func (s *Service) Leave(ctx context.Context, showID string, tokenHash []byte) (Entry, error) {
	entry, err := s.repository.Leave(ctx, showID, tokenHash, s.now())
	if err != nil {
		return Entry{}, err
	}
	if err := s.index.Remove(ctx, candidateFromEntry(entry)); err != nil {
		s.logger.Warn("queue index removal deferred to outbox", "error", err, "show_id", entry.ShowID, "queue_entry_id", entry.ID)
	}
	return entry, nil
}

func (s *Service) List(ctx context.Context, showID, creatorID string, limit, offset int) ([]Entry, error) {
	if err := s.repository.AuthorizeShow(ctx, showID, creatorID); err != nil {
		return nil, err
	}
	ids, err := s.index.List(ctx, showID, limit, offset)
	if err == nil && len(ids) > 0 {
		entries, hydrateErr := s.repository.EntriesByIDs(ctx, showID, creatorID, ids)
		if hydrateErr == nil {
			return entries, nil
		}
	}
	return s.repository.ListWaiting(ctx, showID, creatorID, limit, offset)
}

func (s *Service) Tiers(ctx context.Context, showID string) ([]Tier, error) {
	return s.repository.Tiers(ctx, showID)
}

func (s *Service) AuthorizeCreator(ctx context.Context, showID, creatorID string) error {
	return s.repository.AuthorizeShow(ctx, showID, creatorID)
}

func (s *Service) AuthorizeViewer(ctx context.Context, showID string, tokenHash []byte) error {
	return s.repository.AuthorizeViewer(ctx, showID, tokenHash)
}

func (s *Service) RunOutbox(ctx context.Context) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		if s.flushOutbox(ctx) {
			// Drain an active backlog without imposing the idle polling delay.
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) flushOutbox(ctx context.Context) bool {
	const batchSize = 1000
	events, err := s.repository.PendingOutbox(ctx, batchSize)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			s.logger.Error("queue outbox read failed", "error", err)
		}
		return false
	}
	notifications := make(map[string]string)
	for _, event := range events {
		var publishErr error
		switch event.EventType {
		case "queue.caller_joined":
			publishErr = s.index.Add(ctx, event.Candidate)
		case "queue.caller_left", "queue.caller_selected":
			publishErr = s.index.Remove(ctx, event.Candidate)
		case "queue.show_ended":
			publishErr = s.index.Clear(ctx, event.Candidate.ShowID)
		}
		if publishErr != nil {
			s.logger.Warn("queue outbox publish failed", "error", publishErr, "outbox_id", event.ID)
			return false
		}
		current := notifications[event.Candidate.ShowID]
		if current == "" || event.EventType == "queue.show_ended" {
			notifications[event.Candidate.ShowID] = event.EventType
		}
	}
	if s.publisher != nil {
		for showID, eventType := range notifications {
			if err := s.publisher.PublishQueueEvent(ctx, showID, eventType); err != nil {
				s.logger.Warn("queue realtime publish failed", "error", err, "show_id", showID)
				return false
			}
		}
	}
	ids := make([]int64, len(events))
	for index, event := range events {
		ids[index] = event.ID
	}
	if err := s.repository.MarkOutboxPublished(ctx, ids, s.now()); err != nil {
		s.logger.Warn("queue outbox acknowledgement failed", "error", err, "event_count", len(ids))
		return false
	}
	return len(events) == batchSize
}

func candidateFromEntry(entry Entry) Candidate {
	return Candidate{EntryID: entry.ID, ShowID: entry.ShowID, PriorityRank: entry.PriorityRank, QueuePosition: entry.QueuePosition}
}
