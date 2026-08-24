package show

import (
	"errors"
	"testing"
)

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
