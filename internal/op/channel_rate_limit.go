package op

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type channelRateLimiterEntry struct {
	rpm     int
	limiter *rate.Limiter
}

var (
	channelRateLimiterMu sync.Mutex
	channelRateLimiters  = make(map[int]channelRateLimiterEntry)
)

// WaitChannelRateLimit applies the shared channel-level RPM limit used by relay
// traffic and channel key checks. rpm <= 0 means unlimited.
func WaitChannelRateLimit(ctx context.Context, channelID int, rpm int) error {
	rpm = normalizeNonNegative(rpm)
	if channelID <= 0 || rpm == 0 {
		return nil
	}

	limiter := getChannelRateLimiter(channelID, rpm)
	return limiter.Wait(ctx)
}

func getChannelRateLimiter(channelID int, rpm int) *rate.Limiter {
	channelRateLimiterMu.Lock()
	defer channelRateLimiterMu.Unlock()

	if entry, ok := channelRateLimiters[channelID]; ok && entry.rpm == rpm {
		return entry.limiter
	}

	interval := time.Minute / time.Duration(rpm)
	if interval <= 0 {
		interval = time.Nanosecond
	}
	limiter := rate.NewLimiter(rate.Every(interval), 1)
	channelRateLimiters[channelID] = channelRateLimiterEntry{
		rpm:     rpm,
		limiter: limiter,
	}
	return limiter
}

func clearChannelRateLimiter(channelID int) {
	if channelID <= 0 {
		return
	}
	channelRateLimiterMu.Lock()
	delete(channelRateLimiters, channelID)
	channelRateLimiterMu.Unlock()
}
