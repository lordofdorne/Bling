package show

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeStore struct{ replaced []TierInput }

func (f *fakeStore) Create(context.Context, string) (Show, error)                 { return Show{}, nil }
func (f *fakeStore) ByIDForCreator(context.Context, string, string) (Show, error) { return Show{}, nil }
func (f *fakeStore) Start(context.Context, string, string, time.Time) (Show, error) {
	return Show{}, nil
}
func (f *fakeStore) End(context.Context, string, string, time.Time) (Show, error)    { return Show{}, nil }
func (f *fakeStore) LiveByUsername(context.Context, string) (Show, error)            { return Show{}, nil }
func (f *fakeStore) CurrentForCreator(context.Context, string) (Show, error)         { return Show{}, nil }
func (f *fakeStore) TiersForCreator(context.Context, string, string) ([]Tier, error) { return nil, nil }
func (f *fakeStore) ReplaceTiers(_ context.Context, _, _ string, tiers []TierInput, _ time.Time) ([]Tier, error) {
	f.replaced = tiers
	return nil, nil
}

func TestTransition(t *testing.T) {
	tests := []struct {
		name    string
		current Status
		action  Action
		want    Status
		wantErr error
	}{
		{"created starts", StatusCreated, ActionStart, StatusLive, nil},
		{"live start is idempotent", StatusLive, ActionStart, StatusLive, nil},
		{"live ends", StatusLive, ActionEnd, StatusEnded, nil},
		{"ended end is idempotent", StatusEnded, ActionEnd, StatusEnded, nil},
		{"created cannot end", StatusCreated, ActionEnd, StatusCreated, ErrInvalidTransition},
		{"ended cannot restart", StatusEnded, ActionStart, StatusEnded, ErrInvalidTransition},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Transition(test.current, test.action)
			if got != test.want || !errors.Is(err, test.wantErr) {
				t.Fatalf("Transition() = (%s, %v), want (%s, %v)", got, err, test.want, test.wantErr)
			}
		})
	}
}

func TestReplaceTiersDerivesPriorityAndValidatesConfiguration(t *testing.T) {
	store := &fakeStore{}
	service := NewService(store)
	_, err := service.ReplaceTiers(context.Background(), "show", "creator", []TierInput{
		{Name: " VIP ", CallDurationSeconds: 120, PriceCents: 5000, Enabled: true},
		{Name: "Standard", CallDurationSeconds: 300, PriceCents: 1000, Enabled: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if store.replaced[0].Name != "VIP" || store.replaced[0].PriorityRank != 200 || store.replaced[1].PriorityRank != 100 {
		t.Fatalf("replaced=%+v", store.replaced)
	}
	invalid := [][]TierInput{
		{},
		{{Name: "VIP", CallDurationSeconds: 29, Enabled: true}},
		{{Name: "VIP", CallDurationSeconds: 60, PriceCents: 49, Enabled: true}},
		{{Name: "VIP", CallDurationSeconds: 60, Enabled: false}},
		{{Name: "VIP", CallDurationSeconds: 60, Enabled: true}, {Name: "vip", CallDurationSeconds: 60, Enabled: true}},
	}
	for _, tiers := range invalid {
		if _, err := service.ReplaceTiers(context.Background(), "show", "creator", tiers); !errors.Is(err, ErrTierConfiguration) {
			t.Fatalf("tiers=%+v err=%v", tiers, err)
		}
	}
}
