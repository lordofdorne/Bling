package realtime

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type ExpiredPresence struct {
	CallID string
	Role   string
}

type PresenceStore struct {
	client *redis.Client
	ttl    time.Duration
}

func NewPresenceStore(client *redis.Client, ttl time.Duration) *PresenceStore {
	return &PresenceStore{client: client, ttl: ttl}
}

func (s *PresenceStore) Touch(ctx context.Context, callID, role, connectionID string, now time.Time) error {
	expires := now.Add(s.ttl).UnixMilli()
	member := presenceMember(callID, role, connectionID)
	pipe := s.client.TxPipeline()
	pipe.ZAdd(ctx, presenceRoleKey(callID, role), redis.Z{Score: float64(expires), Member: connectionID})
	pipe.ZAdd(ctx, "bling:call-presence:deadlines", redis.Z{Score: float64(expires), Member: member})
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("refresh call presence: %w", err)
	}
	return nil
}

func (s *PresenceStore) Disconnect(ctx context.Context, callID, role, connectionID string, now time.Time) (bool, error) {
	pipe := s.client.TxPipeline()
	pipe.ZRem(ctx, "bling:call-presence:deadlines", presenceMember(callID, role, connectionID))
	pipe.ZRem(ctx, presenceRoleKey(callID, role), connectionID)
	pipe.ZRemRangeByScore(ctx, presenceRoleKey(callID, role), "-inf", strconv.FormatInt(now.UnixMilli(), 10))
	count := pipe.ZCard(ctx, presenceRoleKey(callID, role))
	if _, err := pipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("remove call presence: %w", err)
	}
	return count.Val() == 0, nil
}

var reapPresenceScript = redis.NewScript(`
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[3]) then return -1 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
return redis.call('ZCARD', KEYS[2])
`)

func (s *PresenceStore) Reap(ctx context.Context, now time.Time, limit int64) ([]ExpiredPresence, error) {
	members, err := s.client.ZRangeByScore(ctx, "bling:call-presence:deadlines", &redis.ZRangeBy{
		Min: "-inf", Max: strconv.FormatInt(now.UnixMilli(), 10), Offset: 0, Count: limit,
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("list expired call presence: %w", err)
	}
	expired := make([]ExpiredPresence, 0, len(members))
	seen := make(map[string]struct{})
	for _, member := range members {
		callID, role, connectionID, ok := parsePresenceMember(member)
		if !ok {
			_ = s.client.ZRem(ctx, "bling:call-presence:deadlines", member).Err()
			continue
		}
		remaining, scriptErr := reapPresenceScript.Run(ctx, s.client,
			[]string{"bling:call-presence:deadlines", presenceRoleKey(callID, role)},
			member, connectionID, now.UnixMilli()).Int64()
		if scriptErr != nil {
			return nil, fmt.Errorf("reap call presence: %w", scriptErr)
		}
		key := callID + "|" + role
		if remaining == 0 {
			if _, exists := seen[key]; !exists {
				expired = append(expired, ExpiredPresence{CallID: callID, Role: role})
				seen[key] = struct{}{}
			}
		}
	}
	return expired, nil
}

func presenceRoleKey(callID, role string) string {
	return "bling:call-presence:" + callID + ":" + role
}

func presenceMember(callID, role, connectionID string) string {
	return callID + "|" + role + "|" + connectionID
}

func parsePresenceMember(value string) (string, string, string, bool) {
	parts := strings.Split(value, "|")
	if len(parts) != 3 || parts[0] == "" || parts[2] == "" || (parts[1] != RoleCreator && parts[1] != RoleViewer) {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}
