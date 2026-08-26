package queue

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

type fakeRepository struct {
	entry          Entry
	state          ViewerState
	entries        []Entry
	err            error
	joinCalls      int
	authorizeCalls int
	listCalls      int
}

func (f *fakeRepository) Join(context.Context, JoinInput) (Entry, error) {
	f.joinCalls++
	return f.entry, f.err
}
func (f *fakeRepository) Me(context.Context, string, []byte) (ViewerState, error) {
	return f.state, f.err
}
func (f *fakeRepository) Leave(context.Context, string, []byte, time.Time) (Entry, error) {
	return f.entry, f.err
}
func (f *fakeRepository) ListWaiting(context.Context, string, string, int, int) ([]Entry, error) {
	f.listCalls++
	return f.entries, f.err
}
func (f *fakeRepository) EntriesByIDs(context.Context, string, string, []string) ([]Entry, error) {
	return f.entries, f.err
}
func (f *fakeRepository) Tiers(context.Context, string) ([]Tier, error) { return nil, f.err }
func (f *fakeRepository) AuthorizeShow(context.Context, string, string) error {
	f.authorizeCalls++
	return f.err
}
func (f *fakeRepository) PendingOutbox(context.Context, int) ([]OutboxEvent, error) {
	return nil, f.err
}
func (f *fakeRepository) MarkOutboxPublished(context.Context, int64, time.Time) error {
	return f.err
}

type fakeIndex struct {
	position  int64
	ids       []string
	err       error
	listCalls int
}

func (f *fakeIndex) Add(context.Context, Candidate) error    { return f.err }
func (f *fakeIndex) Remove(context.Context, Candidate) error { return f.err }
func (f *fakeIndex) Position(context.Context, Candidate) (int64, error) {
	return f.position, f.err
}
func (f *fakeIndex) List(context.Context, string, int, int) ([]string, error) {
	f.listCalls++
	return f.ids, f.err
}
func (f *fakeIndex) Clear(context.Context, string) error { return f.err }

func testService(repository Repository, index CandidateIndex) *Service {
	return NewService(repository, index, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestJoinValidatesBeforePersistence(t *testing.T) {
	repository := &fakeRepository{}
	_, err := testService(repository, &fakeIndex{}).Join(context.Background(), JoinInput{DisplayName: " ", Topic: "hello"})
	if !errors.Is(err, ErrInvalidName) || repository.joinCalls != 0 {
		t.Fatalf("err=%v join calls=%d", err, repository.joinCalls)
	}
}

func TestJoinFallsBackToPostgresPositionWhenRedisIsUnavailable(t *testing.T) {
	entry := Entry{ID: "entry-1", ShowID: "show-1", Status: StatusWaiting, PriorityRank: 3, QueuePosition: 8}
	repository := &fakeRepository{entry: entry, state: ViewerState{Entry: entry, Position: 4}}
	state, err := testService(repository, &fakeIndex{err: errors.New("redis unavailable")}).Join(context.Background(), JoinInput{DisplayName: "Alice", Topic: "Launch", SessionTokenHash: []byte("viewer"), JoinKeyHash: []byte("join")})
	if err != nil || state.Position != 4 {
		t.Fatalf("state=%+v err=%v", state, err)
	}
}

func TestCreatorQueueAuthorizesBeforeReadingRedis(t *testing.T) {
	repository := &fakeRepository{err: ErrShowNotFound}
	index := &fakeIndex{ids: []string{"entry-1"}}
	_, err := testService(repository, index).List(context.Background(), "show-1", "other-creator", 50, 0)
	if !errors.Is(err, ErrShowNotFound) || repository.authorizeCalls != 1 || index.listCalls != 0 {
		t.Fatalf("err=%v authorize=%d index list=%d", err, repository.authorizeCalls, index.listCalls)
	}
}
