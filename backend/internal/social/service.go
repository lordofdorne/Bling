package social

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

const PresenceTTL = 90 * time.Second
const CacheTTL = 20 * time.Second

type Service struct {
	Store             *Store
	Redis             *redis.Client
	Logger            *slog.Logger
	group             singleflight.Group
	CacheHits         atomic.Uint64
	CacheMisses       atomic.Uint64
	PresenceWrites    atomic.Uint64
	ProjectionBatches atomic.Uint64
	Errors            atomic.Uint64
}

func NewService(store *Store, client *redis.Client, logger *slog.Logger) *Service {
	return &Service{Store: store, Redis: client, Logger: logger}
}
func (s *Service) invalidate(ctx context.Context) {
	if err := s.Redis.Incr(ctx, "social:directory:version").Err(); err != nil {
		s.Logger.Warn("social cache invalidation delayed until TTL", "error", err)
		s.Errors.Add(1)
	}
}
func (s *Service) List(ctx context.Context, o ListOptions, userID string) (Page, error) {
	if err := o.Validate(); err != nil {
		return Page{}, err
	}
	// Cache only fixed-size public first pages without arbitrary search strings.
	// Private follow flags and visitor counts are attached after cache retrieval.
	cacheable := !o.Following && o.Query == "" && o.Cursor == "" && o.Limit == 24
	var page Page
	if cacheable {
		version, _ := s.Redis.Get(ctx, "social:directory:version").Result()
		raw, _ := json.Marshal(o)
		sum := sha256.Sum256(raw)
		key := "social:directory:" + version + ":" + hex.EncodeToString(sum[:12])
		if data, err := s.Redis.Get(ctx, key).Bytes(); err == nil && json.Unmarshal(data, &page) == nil {
			s.CacheHits.Add(1)
		} else {
			s.CacheMisses.Add(1)
			// Coalesce local cache misses without binding shared work to one caller's cancellation.
			result := s.group.DoChan(key, func() (any, error) {
				work, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
				defer cancel()
				p, err := s.Store.List(work, o, "")
				if err != nil {
					return nil, err
				}
				data, _ := json.Marshal(p)
				_ = s.Redis.Set(work, key, data, CacheTTL).Err()
				return data, nil
			})
			select {
			case <-ctx.Done():
				return Page{}, ctx.Err()
			case r := <-result:
				if r.Err != nil {
					return Page{}, r.Err
				}
				if err := json.Unmarshal(r.Val.([]byte), &page); err != nil {
					return Page{}, err
				}
			}
		}
	} else {
		var err error
		page, err = s.Store.List(ctx, o, userID)
		if err != nil {
			return Page{}, err
		}
	}
	return page, s.decorate(ctx, page.Items, userID)
}
func (s *Service) decorate(ctx context.Context, profiles []Profile, userID string) error {
	ids := make([]string, len(profiles))
	for i, p := range profiles {
		ids[i] = p.ID
	}
	followed, err := s.Store.FollowingIDs(ctx, userID, ids)
	if err != nil {
		return err
	}
	pipe := s.Redis.Pipeline()
	counts := map[int]*redis.IntCmd{}
	cutoff := strconv.FormatInt(time.Now().Add(-PresenceTTL).UnixMilli(), 10)
	for i := range profiles {
		profiles[i].IsFollowing = followed[profiles[i].ID]
		if profiles[i].IsLive && profiles[i].LiveShowID != nil {
			counts[i] = pipe.ZCount(ctx, presenceKey(*profiles[i].LiveShowID), cutoff, "+inf")
		}
	}
	if len(counts) > 0 {
		if _, err := pipe.Exec(ctx); err != nil {
			s.Errors.Add(1)
		} else {
			for i, cmd := range counts {
				value := cmd.Val()
				profiles[i].ChannelVisitors = &value
			}
		}
	}
	return nil
}
func (s *Service) Profile(ctx context.Context, username, userID string) (Profile, error) {
	p, err := s.Store.Profile(ctx, username, userID)
	if err != nil {
		return p, err
	}
	items := []Profile{p}
	err = s.decorate(ctx, items, userID)
	return items[0], err
}
func (s *Service) SaveProfile(ctx context.Context, id string, input ProfileInput) (Profile, error) {
	if err := input.Validate(); err != nil {
		return Profile{}, err
	}
	p, err := s.Store.SaveProfile(ctx, id, input)
	if err == nil {
		s.invalidate(ctx)
	}
	return p, err
}
func presenceKey(showID string) string { return "social:presence:{" + showID + "}" }

var heartbeatScript = redis.NewScript(`
local expired=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[2],'LIMIT',0,100)
if #expired>0 then redis.call('ZREM',KEYS[1],unpack(expired)) end
redis.call('ZADD',KEYS[1],ARGV[1],ARGV[3])
redis.call('PEXPIRE',KEYS[1],ARGV[4])
return redis.call('ZCOUNT',KEYS[1],ARGV[2],'+inf')
`)

func (s *Service) Heartbeat(ctx context.Context, username, actor string) (int64, error) {
	p, err := s.Store.Profile(ctx, username, "")
	if err != nil {
		return 0, err
	}
	if !p.IsLive || p.LiveShowID == nil {
		return 0, ErrLiveRequired
	}
	now := time.Now()
	count, err := heartbeatScript.Run(ctx, s.Redis, []string{presenceKey(*p.LiveShowID)}, now.UnixMilli(), now.Add(-PresenceTTL).UnixMilli(), actor, PresenceTTL.Milliseconds()).Int64()
	if err != nil {
		s.Errors.Add(1)
		return 0, fmt.Errorf("presence unavailable: %w", err)
	}
	s.PresenceWrites.Add(1)
	return count, nil
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	lastPrune := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			work, cancel := context.WithTimeout(ctx, 4*time.Second)
			n, err := s.Store.FlushCounts(work)
			if err != nil {
				s.Logger.Error("social projection failed", "error", err)
				s.Errors.Add(1)
			} else if n > 0 {
				s.ProjectionBatches.Add(1)
				s.invalidate(work)
			}
			if time.Since(lastPrune) > time.Minute {
				if err := s.Store.PruneEvents(work); err != nil {
					s.Logger.Error("social retention failed", "error", err)
					s.Errors.Add(1)
				} else {
					lastPrune = time.Now()
				}
			}
			cancel()
		}
	}
}
