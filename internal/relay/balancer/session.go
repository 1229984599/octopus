package balancer

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// SessionEntry 会话保持条目
type SessionEntry struct {
	ChannelID    int
	ChannelKeyID int
	ExpiresAt    time.Time
}

// 全局会话存储
var globalSession sync.Map // key: string -> value: *SessionEntry

// sessionSweepInterval 每写入 N 条粘性记录做一次全量过期清扫。
const sessionSweepInterval = 4096

var sessionOpsSinceSweep atomic.Uint64

// SessionKey 生成会话键：apiKeyID:requestModel:fingerprint。
// fingerprint 标识客户端的一个独立对话：Chat/Messages API 每轮携带完整历史，
// 同一对话的首条消息保持不变，据此计算的指纹跨轮次稳定；不同对话指纹不同。
// fingerprint 为空（无消息体的请求，如图片/嵌入）时退化为 apiKey+模型级亲和。
func SessionKey(apiKeyID int, requestModel, fingerprint string) string {
	return fmt.Sprintf("%d:%s:%s", apiKeyID, requestModel, fingerprint)
}

// GetSticky 获取粘性通道（未过期时有效），过期时惰性清除
func GetSticky(key string) *SessionEntry {
	v, ok := globalSession.Load(key)
	if !ok {
		return nil
	}
	entry := v.(*SessionEntry)

	if time.Now().After(entry.ExpiresAt) {
		globalSession.Delete(key)
		return nil
	}

	return entry
}

// SetSticky 写入/更新粘性记录，ttl 为分组配置的会话保持时间；ttl <= 0 时不写入。
func SetSticky(key string, channelID, keyID int, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	globalSession.Store(key, &SessionEntry{
		ChannelID:    channelID,
		ChannelKeyID: keyID,
		ExpiresAt:    time.Now().Add(ttl),
	})
	if sessionOpsSinceSweep.Add(1)%sessionSweepInterval == 0 {
		sweepExpiredSessions()
	}
}

// sweepExpiredSessions 清理已过期的会话条目。会话键带对话指纹后随对话数增长，
// 仅靠读取时的惰性过期不足以控制内存，需要周期性全量清扫。
func sweepExpiredSessions() {
	now := time.Now()
	globalSession.Range(func(key, value any) bool {
		if entry, ok := value.(*SessionEntry); ok && now.After(entry.ExpiresAt) {
			globalSession.Delete(key)
		}
		return true
	})
}
