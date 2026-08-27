package balancer

import (
	"fmt"
	"time"

	"github.com/1229984599/octopus/internal/model"
)

// Iterator 统一的负载均衡迭代器
// 内部编排：策略排序 + 粘性优先 + 决策追踪
type Iterator struct {
	candidates []model.GroupItem
	index      int
	sticky     *SessionEntry // 粘性会话记录（渠道 + Key），Key 级亲和用
	modelName  string        // 请求模型名（用于熔断检查）

	// 内嵌追踪
	attempts []model.ChannelAttempt
	count    int
}

// NewIterator 创建负载均衡迭代器
// 自动处理：策略排序 + 粘性通道提前
// sessionFingerprint 标识客户端的独立对话，为空时退化为 apiKey+模型级亲和
func NewIterator(group model.Group, apiKeyID int, requestModel, sessionFingerprint string) *Iterator {
	b := GetBalancer(group.Mode)
	ordered := b.Candidates(group.Items)

	var sticky *SessionEntry
	if group.SessionKeepTime > 0 {
		if entry := GetSticky(SessionKey(apiKeyID, requestModel, sessionFingerprint)); entry != nil {
			sticky = entry
			for i, item := range ordered {
				if item.ChannelID == entry.ChannelID {
					if i > 0 {
						// 将粘性通道整体移到最前面；必须在重试展开前移动，
						// 这样粘性渠道的重试槽位保持连续，Key 失败后先在同渠道内换 Key 重试。
						stickyItem := ordered[i]
						copy(ordered[1:i+1], ordered[0:i])
						ordered[0] = stickyItem
					}
					break
				}
			}
		}
	}

	return &Iterator{
		candidates: expandRetryCandidates(ordered),
		index:      -1,
		sticky:     sticky,
		modelName:  requestModel,
	}
}

// StickyKeyID 返回粘性会话在指定渠道上记录的 Key ID；无粘性会话或渠道不匹配时返回 0。
// 同一会话复用同一渠道的同一 Key，可最大化上游 prompt cache 命中率。
func (it *Iterator) StickyKeyID(channelID int) int {
	if it.sticky == nil || it.sticky.ChannelID != channelID {
		return 0
	}
	return it.sticky.ChannelKeyID
}

func expandRetryCandidates(items []model.GroupItem) []model.GroupItem {
	if len(items) == 0 {
		return nil
	}

	total := 0
	for _, item := range items {
		repeat := item.RetryCount + 1
		if repeat < 1 {
			repeat = 1
		}
		total += repeat
	}

	candidates := make([]model.GroupItem, 0, total)
	for _, item := range items {
		repeat := item.RetryCount + 1
		if repeat < 1 {
			repeat = 1
		}
		for i := 0; i < repeat; i++ {
			candidates = append(candidates, item)
		}
	}
	return candidates
}

// Next 移动到下一个候选，返回 false 表示遍历完成
func (it *Iterator) Next() bool {
	it.index++
	return it.index < len(it.candidates)
}

// Item 返回当前候选的 GroupItem
func (it *Iterator) Item() model.GroupItem {
	return it.candidates[it.index]
}

// IsSticky 当前候选是否属于粘性渠道
func (it *Iterator) IsSticky() bool {
	return it.sticky != nil && it.candidates[it.index].ChannelID == it.sticky.ChannelID
}

// Len 返回候选列表长度
func (it *Iterator) Len() int {
	return len(it.candidates)
}

// Index 返回当前迭代位置（0-based）
func (it *Iterator) Index() int {
	return it.index
}

// Skip 记录当前通道被跳过（通道禁用、无Key、类型不兼容等）
func (it *Iterator) Skip(channelID, channelKeyID int, channelName, msg string) {
	it.count++
	it.attempts = append(it.attempts, model.ChannelAttempt{
		ChannelID:    channelID,
		ChannelKeyID: channelKeyID,
		ChannelName:  channelName,
		ModelName:    it.candidates[it.index].ModelName,
		AttemptNum:   it.count,
		Status:       model.AttemptSkipped,
		Sticky:       it.IsSticky(),
		Msg:          msg,
	})
}

// SkipCircuitBreak 检查熔断状态，若已熔断自动记录（含剩余冷却时间）并返回 true
func (it *Iterator) SkipCircuitBreak(channelID, channelKeyID int, channelName string) bool {
	modelName := it.candidates[it.index].ModelName
	tripped, remaining := IsTripped(channelID, channelKeyID, modelName)
	if !tripped {
		return false
	}
	msg := "circuit breaker tripped"
	if remaining > 0 {
		msg = fmt.Sprintf("circuit breaker tripped, remaining cooldown: %ds", int(remaining.Seconds()))
	}
	it.count++
	it.attempts = append(it.attempts, model.ChannelAttempt{
		ChannelID:    channelID,
		ChannelKeyID: channelKeyID,
		ChannelName:  channelName,
		ModelName:    modelName,
		AttemptNum:   it.count,
		Status:       model.AttemptCircuitBreak,
		Sticky:       it.IsSticky(),
		Msg:          msg,
	})
	return true
}

// StartAttempt 开始一次真实转发尝试，返回 Span 用于记录结果
func (it *Iterator) StartAttempt(channelID, channelKeyID int, channelName string) *AttemptSpan {
	it.count++
	return &AttemptSpan{
		attempt: model.ChannelAttempt{
			ChannelID:    channelID,
			ChannelKeyID: channelKeyID,
			ChannelName:  channelName,
			ModelName:    it.candidates[it.index].ModelName,
			AttemptNum:   it.count,
			Sticky:       it.IsSticky(),
		},
		startTime: time.Now(),
		iter:      it,
	}
}

// Attempts 返回所有决策记录（交给日志模块持久化）
func (it *Iterator) Attempts() []model.ChannelAttempt {
	return it.attempts
}

// AttemptSpan 管理单次通道尝试的生命周期（计时、状态、结果）
type AttemptSpan struct {
	attempt   model.ChannelAttempt
	startTime time.Time
	iter      *Iterator
	ended     bool
}

// End 结束尝试：设置状态，自动计算耗时，追加到 Iterator
func (s *AttemptSpan) End(status model.AttemptStatus, msg string) {
	if s.ended {
		return
	}
	s.ended = true
	s.attempt.Status = status
	s.attempt.Duration = int(time.Since(s.startTime).Milliseconds())
	s.attempt.Msg = msg
	s.iter.attempts = append(s.iter.attempts, s.attempt)
}

// Duration 返回从开始到现在的耗时
func (s *AttemptSpan) Duration() time.Duration {
	return time.Since(s.startTime)
}
