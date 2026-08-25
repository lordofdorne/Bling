package queue

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCandidateIndex struct{ client *redis.Client }

func NewRedisCandidateIndex(client *redis.Client) *RedisCandidateIndex {
	return &RedisCandidateIndex{client: client}
}

func (i *RedisCandidateIndex) Add(ctx context.Context, candidate Candidate) error {
	pipe := i.client.TxPipeline()
	pipe.SAdd(ctx, priorityKey(candidate.ShowID), candidate.PriorityRank)
	pipe.ZAdd(ctx, candidatesKey(candidate.ShowID, candidate.PriorityRank), redis.Z{
		Score: float64(candidate.QueuePosition), Member: candidate.EntryID,
	})
	pipe.Expire(ctx, priorityKey(candidate.ShowID), 30*24*time.Hour)
	pipe.Expire(ctx, candidatesKey(candidate.ShowID, candidate.PriorityRank), 30*24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("index queue candidate: %w", err)
	}
	return nil
}

func (i *RedisCandidateIndex) Remove(ctx context.Context, candidate Candidate) error {
	if err := i.client.ZRem(ctx, candidatesKey(candidate.ShowID, candidate.PriorityRank), candidate.EntryID).Err(); err != nil {
		return fmt.Errorf("remove queue candidate: %w", err)
	}
	return nil
}

func (i *RedisCandidateIndex) Position(ctx context.Context, candidate Candidate) (int64, error) {
	ranks, err := i.priorities(ctx, candidate.ShowID)
	if err != nil {
		return 0, err
	}
	var ahead int64
	for _, rank := range ranks {
		if rank <= candidate.PriorityRank {
			continue
		}
		count, err := i.client.ZCard(ctx, candidatesKey(candidate.ShowID, rank)).Result()
		if err != nil {
			return 0, fmt.Errorf("count higher-priority candidates: %w", err)
		}
		ahead += count
	}
	rank, err := i.client.ZRank(ctx, candidatesKey(candidate.ShowID, candidate.PriorityRank), candidate.EntryID).Result()
	if err != nil {
		return 0, fmt.Errorf("rank queue candidate: %w", err)
	}
	return ahead + rank + 1, nil
}

func (i *RedisCandidateIndex) List(ctx context.Context, showID string, limit, offset int) ([]string, error) {
	ranks, err := i.priorities(ctx, showID)
	if err != nil {
		return nil, err
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ranks)))
	remainingOffset := int64(offset)
	remaining := int64(limit)
	ids := make([]string, 0, limit)
	for _, rank := range ranks {
		if remaining == 0 {
			break
		}
		key := candidatesKey(showID, rank)
		count, err := i.client.ZCard(ctx, key).Result()
		if err != nil {
			return nil, fmt.Errorf("count queue tier candidates: %w", err)
		}
		if remainingOffset >= count {
			remainingOffset -= count
			continue
		}
		page, err := i.client.ZRange(ctx, key, remainingOffset, remainingOffset+remaining-1).Result()
		if err != nil {
			return nil, fmt.Errorf("list queue tier candidates: %w", err)
		}
		ids = append(ids, page...)
		remaining -= int64(len(page))
		remainingOffset = 0
	}
	return ids, nil
}

func (i *RedisCandidateIndex) Clear(ctx context.Context, showID string) error {
	ranks, err := i.priorities(ctx, showID)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(ranks)+1)
	keys = append(keys, priorityKey(showID))
	for _, rank := range ranks {
		keys = append(keys, candidatesKey(showID, rank))
	}
	if err := i.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("clear show queue index: %w", err)
	}
	return nil
}

func (i *RedisCandidateIndex) priorities(ctx context.Context, showID string) ([]int, error) {
	values, err := i.client.SMembers(ctx, priorityKey(showID)).Result()
	if err != nil {
		return nil, fmt.Errorf("list queue priorities: %w", err)
	}
	ranks := make([]int, 0, len(values))
	for _, value := range values {
		rank, err := strconv.Atoi(value)
		if err != nil {
			continue
		}
		ranks = append(ranks, rank)
	}
	return ranks, nil
}

func priorityKey(showID string) string { return "queue:show:" + showID + ":priorities" }
func candidatesKey(showID string, priority int) string {
	return "queue:show:" + showID + ":priority:" + strconv.Itoa(priority)
}
