package show

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeStore struct {
	replaced     []TierInput
	tiers        []Tier
	startedReady bool
	started      bool
}

func (f *fakeStore) Create(context.Context, string) (Show, error)                 { return Show{}, nil }
func (f *fakeStore) ByIDForCreator(context.Context, string, string) (Show, error) { return Show{}, nil }

// Start mirrors the Postgres store, which rejects the same combination inside
// the transaction that flips the show LIVE.
func (f *fakeStore) Start(_ context.Context, _, _ string, _ time.Time, payoutsReady bool) (Show, error) {
	f.started = true
	f.startedReady = payoutsReady
	for _, tier := range f.tiers {
		if tier.Enabled && tier.PriceCents > 0 && !payoutsReady {
			return Show{}, ErrPayoutSetupRequired
		}
	}
	return Show{Status: StatusLive}, nil
}

type fakePayouts struct {
	ready bool
	err   error
	calls int
}

func (f *fakePayouts) Ready(context.Context, string) (bool, error) {
	f.calls++
	return f.ready, f.err
}
func (f *fakeStore) End(context.Context, string, string, time.Time) (Show, error) { return Show{}, nil }
func (f *fakeStore) LiveByUsername(context.Context, string) (Show, error)         { return Show{}, nil }
func (f *fakeStore) CurrentForCreator(context.Context, string) (Show, error)      { return Show{}, nil }
func (f *fakeStore) TiersForCreator(context.Context, string, string) ([]Tier, error) {
	return f.tiers, nil
}
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

func TestStartRejectsPaidShowUntilPayoutSetupIsComplete(t *testing.T) {
	store := &fakeStore{tiers: []Tier{
		{Name: "VIP", PriceCents: 5000, Enabled: true},
		{Name: "Standard", PriceCents: 0, Enabled: true},
	}}
	payouts := &fakePayouts{}
	service := NewService(store).WithPayouts(payouts)

	if _, err := service.Start(context.Background(), "show", "creator"); !errors.Is(err, ErrPayoutSetupRequired) {
		t.Fatalf("start without payout setup err=%v", err)
	}
	if payouts.calls != 1 || store.startedReady {
		t.Fatalf("payout lookups=%d startedReady=%v", payouts.calls, store.startedReady)
	}

	payouts.ready = true
	started, err := service.Start(context.Background(), "show", "creator")
	if err != nil || started.Status != StatusLive || !store.startedReady {
		t.Fatalf("started=%+v startedReady=%v err=%v", started, store.startedReady, err)
	}
}

// A disabled paid tier cannot take money, so it must not block a free show.
func TestStartFreeShowSkipsPayoutSetup(t *testing.T) {
	store := &fakeStore{tiers: []Tier{
		{Name: "Standard", PriceCents: 0, Enabled: true},
		{Name: "VIP", PriceCents: 5000, Enabled: false},
	}}
	payouts := &fakePayouts{err: errors.New("payout lookup must not run")}
	service := NewService(store).WithPayouts(payouts)

	started, err := service.Start(context.Background(), "show", "creator")
	if err != nil || started.Status != StatusLive {
		t.Fatalf("started=%+v err=%v", started, err)
	}
	if payouts.calls != 0 {
		t.Fatalf("payout lookups=%d, want 0", payouts.calls)
	}
}

func TestStartPaidShowFailsClosedWithoutPayoutSource(t *testing.T) {
	store := &fakeStore{tiers: []Tier{{Name: "VIP", PriceCents: 5000, Enabled: true}}}
	if _, err := NewService(store).Start(context.Background(), "show", "creator"); !errors.Is(err, ErrPayoutSetupRequired) {
		t.Fatalf("start without payout source err=%v", err)
	}
}

func TestStartPropagatesPayoutLookupFailure(t *testing.T) {
	lookup := errors.New("stripe unavailable")
	store := &fakeStore{tiers: []Tier{{Name: "VIP", PriceCents: 5000, Enabled: true}}}
	service := NewService(store).WithPayouts(&fakePayouts{err: lookup})
	if _, err := service.Start(context.Background(), "show", "creator"); !errors.Is(err, lookup) {
		t.Fatalf("start err=%v, want %v", err, lookup)
	}
	if store.started {
		t.Fatal("an unresolved payout lookup must not start the show")
	}
}
