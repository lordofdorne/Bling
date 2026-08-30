package call

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepository struct {
	value   Call
	err     error
	entryID string
	mode    SelectionMode
	target  Status
}

func (f *fakeRepository) Select(_ context.Context, _, _, entryID string, mode SelectionMode, _ time.Time) (Call, error) {
	f.entryID, f.mode = entryID, mode
	return f.value, f.err
}
func (f *fakeRepository) CreatorActive(context.Context, string, string) (Call, error) {
	return f.value, f.err
}
func (f *fakeRepository) ViewerLatest(context.Context, string, []byte) (Call, error) {
	return f.value, f.err
}
func (f *fakeRepository) Transition(_ context.Context, _, _, _ string, target Status, _ time.Time) (Call, error) {
	f.target = target
	return f.value, f.err
}
func (f *fakeRepository) TransitionViewer(_ context.Context, _, _ string, _ []byte, target Status, _ time.Time) (Call, error) {
	f.target = target
	return f.value, f.err
}
func (f *fakeRepository) ExpireDue(context.Context, time.Time, int) ([]Call, error) {
	return nil, f.err
}
func (f *fakeRepository) MarkParticipantConnected(context.Context, string, string, time.Time) error {
	return f.err
}
func (f *fakeRepository) MarkParticipantDisconnected(context.Context, string, string, time.Time) error {
	return f.err
}
func (f *fakeRepository) ExpireDisconnected(context.Context, time.Time, time.Duration, int) ([]Call, error) {
	return nil, f.err
}
func (f *fakeRepository) AuthorizeCreator(context.Context, string, string, string) error {
	return f.err
}
func (f *fakeRepository) AuthorizeViewer(context.Context, string, string, []byte) error { return f.err }

func TestManualAndRandomSelectionShareRepositoryBoundary(t *testing.T) {
	repository := &fakeRepository{value: Call{ID: "call-1"}}
	service := NewService(repository)
	if _, err := service.SelectManual(context.Background(), "show-1", "creator-1", "entry-1"); err != nil {
		t.Fatal(err)
	}
	if repository.entryID != "entry-1" || repository.mode != SelectionManual {
		t.Fatalf("manual selection entry=%q mode=%q", repository.entryID, repository.mode)
	}
	if _, err := service.SelectRandom(context.Background(), "show-1", "creator-1"); err != nil {
		t.Fatal(err)
	}
	if repository.entryID != "" || repository.mode != SelectionRandom {
		t.Fatalf("random selection entry=%q mode=%q", repository.entryID, repository.mode)
	}
}

func TestTransitionRejectsUnsupportedTargetBeforePersistence(t *testing.T) {
	repository := &fakeRepository{}
	_, err := NewService(repository).Transition(context.Background(), "show", "call", "creator", StatusCreated)
	if !errors.Is(err, ErrInvalidTransition) || repository.target != "" {
		t.Fatalf("err=%v target=%q", err, repository.target)
	}
}

func TestViewerTransitionAllowsLiveEndAndFailureOnly(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository)
	if _, err := service.TransitionViewer(context.Background(), "show", "call", []byte("viewer"), StatusConnecting); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("connecting transition err=%v", err)
	}
	for _, target := range []Status{StatusLive, StatusEnded, StatusFailed} {
		if _, err := service.TransitionViewer(context.Background(), "show", "call", []byte("viewer"), target); err != nil {
			t.Fatalf("target=%q err=%v", target, err)
		}
		if repository.target != target {
			t.Fatalf("repository target=%q want=%q", repository.target, target)
		}
	}
}
