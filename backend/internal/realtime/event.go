package realtime

import "time"

type Event struct {
	Type       string    `json:"type"`
	ShowID     string    `json:"showId"`
	OccurredAt time.Time `json:"occurredAt"`
}

const (
	EventQueueJoined = "queue.joined"
	EventQueueLeft   = "queue.left"
	EventShowEnded   = "show.ended"
)
