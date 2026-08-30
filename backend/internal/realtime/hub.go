package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
)

var ErrRoomFull = errors.New("realtime show room is full")

type Hub struct {
	ctx        context.Context
	bus        Bus
	logger     *slog.Logger
	bufferSize int
	maxPerShow int
	mu         sync.Mutex
	rooms      map[string]*room
}

type room struct {
	subscription Subscription
	clients      map[*Client]struct{}
	cancel       context.CancelFunc
}

type Client struct {
	Messages <-chan []byte
	messages chan []byte
	done     chan struct{}
	stopOnce sync.Once
}

func NewHub(ctx context.Context, bus Bus, logger *slog.Logger, bufferSize, maxPerShow int) *Hub {
	return &Hub{ctx: ctx, bus: bus, logger: logger, bufferSize: bufferSize, maxPerShow: maxPerShow, rooms: make(map[string]*room)}
}

func (h *Hub) Subscribe(ctx context.Context, showID string) (*Client, error) {
	h.mu.Lock()
	if existing := h.rooms[showID]; existing != nil {
		client, err := h.addClientLocked(existing)
		h.mu.Unlock()
		return client, err
	}
	h.mu.Unlock()

	roomCtx, cancel := context.WithCancel(h.ctx)
	subscription, err := h.bus.Subscribe(roomCtx, showID)
	if err != nil {
		cancel()
		return nil, err
	}

	h.mu.Lock()
	if existing := h.rooms[showID]; existing != nil {
		client, addErr := h.addClientLocked(existing)
		h.mu.Unlock()
		cancel()
		_ = subscription.Close()
		return client, addErr
	}
	created := &room{subscription: subscription, clients: make(map[*Client]struct{}), cancel: cancel}
	h.rooms[showID] = created
	client, err := h.addClientLocked(created)
	h.mu.Unlock()
	if err != nil {
		h.closeRoom(showID, created)
		return nil, err
	}
	go h.runRoom(showID, created)
	return client, nil
}

func (h *Hub) addClientLocked(target *room) (*Client, error) {
	if len(target.clients) >= h.maxPerShow {
		return nil, ErrRoomFull
	}
	messages := make(chan []byte, h.bufferSize)
	client := &Client{Messages: messages, messages: messages, done: make(chan struct{})}
	target.clients[client] = struct{}{}
	return client, nil
}

func (h *Hub) Unsubscribe(showID string, client *Client) {
	h.mu.Lock()
	target := h.rooms[showID]
	if target == nil {
		h.mu.Unlock()
		return
	}
	if _, exists := target.clients[client]; !exists {
		h.mu.Unlock()
		return
	}
	delete(target.clients, client)
	client.stop()
	empty := len(target.clients) == 0
	if empty {
		delete(h.rooms, showID)
	}
	h.mu.Unlock()
	if empty {
		target.cancel()
		_ = target.subscription.Close()
	}
}

func (h *Hub) runRoom(showID string, target *room) {
	for {
		select {
		case <-h.ctx.Done():
			h.closeRoom(showID, target)
			return
		case event, ok := <-target.subscription.Events():
			if !ok {
				h.closeRoom(showID, target)
				return
			}
			if event.ShowID != showID {
				continue
			}
			payload, err := json.Marshal(event)
			if err != nil {
				h.logger.Warn("realtime event encoding failed", "error", err, "show_id", showID)
				continue
			}
			h.broadcast(showID, target, payload)
		}
	}
}

func (h *Hub) broadcast(showID string, target *room, payload []byte) {
	h.mu.Lock()
	if h.rooms[showID] != target {
		h.mu.Unlock()
		return
	}
	dropped := 0
	for client := range target.clients {
		select {
		case client.messages <- payload:
		default:
			delete(target.clients, client)
			client.stop()
			dropped++
		}
	}
	if len(target.clients) == 0 {
		delete(h.rooms, showID)
		h.mu.Unlock()
		target.cancel()
		_ = target.subscription.Close()
		if dropped > 0 {
			h.logger.Warn("realtime slow clients dropped", "show_id", showID, "count", dropped)
		}
		return
	}
	h.mu.Unlock()
	if dropped > 0 {
		h.logger.Warn("realtime slow clients dropped", "show_id", showID, "count", dropped)
	}
}

func (h *Hub) closeRoom(showID string, target *room) {
	h.mu.Lock()
	if h.rooms[showID] != target {
		h.mu.Unlock()
		return
	}
	delete(h.rooms, showID)
	for client := range target.clients {
		client.stop()
	}
	h.mu.Unlock()
	target.cancel()
	if err := target.subscription.Close(); err != nil && !errors.Is(err, context.Canceled) {
		h.logger.Debug("realtime subscription close failed", "error", err, "show_id", showID)
	}
}

func (c *Client) Done() <-chan struct{} { return c.done }

func (c *Client) stop() { c.stopOnce.Do(func() { close(c.done) }) }

func (h *Hub) ConnectionCount(showID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	if target := h.rooms[showID]; target != nil {
		return len(target.clients)
	}
	return 0
}
