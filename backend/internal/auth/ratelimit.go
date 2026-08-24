package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter interface {
	Allow(context.Context, string, int, time.Duration) (bool, error)
}

type RedisRateLimiter struct{ client *redis.Client }

var incrementWindow = redis.NewScript(`
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`)

func NewRedisRateLimiter(client *redis.Client) *RedisRateLimiter {
	return &RedisRateLimiter{client: client}
}

func (l *RedisRateLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	count, err := incrementWindow.Run(ctx, l.client, []string{"rate-limit:" + key}, window.Milliseconds()).Int64()
	if err != nil {
		return false, fmt.Errorf("increment rate limit: %w", err)
	}
	return count <= int64(limit), nil
}
