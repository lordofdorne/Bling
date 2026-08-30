package realtime

import "time"

type Event struct {
	Type       string    `json:"type"`
	ShowID     string    `json:"showId"`
	OccurredAt time.Time `json:"occurredAt"`
}

const (
	EventQueueJoined    = "queue.joined"
	EventQueueLeft      = "queue.left"
	EventCallSelected   = "call.selected"
	EventCallConnecting = "call.connecting"
	EventCallLive       = "call.live"
	EventCallEnded      = "call.ended"
	EventCallFailed     = "call.failed"
	EventShowEnded      = "show.ended"
)
