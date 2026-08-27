package relay

import (
	"testing"
	"time"

	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/relay/balancer"
)

func newStickyTestRun(t *testing.T, apiKeyID int, stickyChannelID, stickyKeyID int, channelKeys []model.ChannelKey) (*relayRun, *model.Channel) {
	t.Helper()
	if stickyChannelID != 0 {
		balancer.SetSticky(balancer.SessionKey(apiKeyID, "gpt-test", ""), stickyChannelID, stickyKeyID, 5*time.Minute)
	}
	group := model.Group{
		Mode:            model.GroupModeRoundRobin,
		SessionKeepTime: 300,
		Items: []model.GroupItem{
			{ID: 1, ChannelID: 10, ModelName: "gpt-test", Priority: 1},
		},
	}
	channel := &model.Channel{
		ID:      10,
		Enabled: true,
		Keys:    channelKeys,
	}
	iter := balancer.NewIterator(group, apiKeyID, "gpt-test", "")
	// 真实流程中 selectChannelKey 在 iter.Next() 之后调用，这里同样先推进到首个候选
	if !iter.Next() {
		t.Fatal("no candidates")
	}
	return &relayRun{iter: iter, failedKeys: make(map[channelKeyRef]struct{})}, channel
}

func TestSelectChannelKeyPrefersStickyKey(t *testing.T) {
	r, channel := newStickyTestRun(t, 101, 10, 2, []model.ChannelKey{
		{ID: 1, Enabled: true, ChannelKey: "first", Priority: 1},
		{ID: 2, Enabled: true, ChannelKey: "second", Priority: 2},
	})

	got := r.selectChannelKey(channel)
	if got.ID != 2 {
		t.Fatalf("expected sticky key 2, got key %d", got.ID)
	}
}

func TestSelectChannelKeyFallsBackWhenStickyKeyDisabled(t *testing.T) {
	r, channel := newStickyTestRun(t, 102, 10, 2, []model.ChannelKey{
		{ID: 1, Enabled: true, ChannelKey: "first", Priority: 1},
		{ID: 2, Enabled: false, ChannelKey: "second", Priority: 2},
	})

	got := r.selectChannelKey(channel)
	if got.ID != 1 {
		t.Fatalf("expected fallback to key 1 when sticky key disabled, got key %d", got.ID)
	}
}

func TestSelectChannelKeyFallsBackWhenStickyKeyFailedThisRequest(t *testing.T) {
	r, channel := newStickyTestRun(t, 103, 10, 2, []model.ChannelKey{
		{ID: 1, Enabled: true, ChannelKey: "first", Priority: 1},
		{ID: 2, Enabled: true, ChannelKey: "second", Priority: 2},
	})
	r.failedKeys[channelKeyRef{channelID: 10, keyID: 2}] = struct{}{}

	got := r.selectChannelKey(channel)
	if got.ID != 1 {
		t.Fatalf("expected fallback to key 1 when sticky key failed this request, got key %d", got.ID)
	}
}

func TestSelectChannelKeyFallsBackWhenStickyKeyInCooldown(t *testing.T) {
	now := time.Now().Unix()
	r, channel := newStickyTestRun(t, 104, 10, 2, []model.ChannelKey{
		{ID: 1, Enabled: true, ChannelKey: "first", Priority: 1},
		// 429 冷却 5 分钟内，GetChannelKeyCandidates 会过滤掉
		{ID: 2, Enabled: true, ChannelKey: "second", Priority: 2, StatusCode: 429, LastUseTimeStamp: now - 60},
	})

	got := r.selectChannelKey(channel)
	if got.ID != 1 {
		t.Fatalf("expected fallback to key 1 when sticky key in 429 cooldown, got key %d", got.ID)
	}
}

func TestIteratorStickyKeyIDIgnoresOtherChannel(t *testing.T) {
	balancer.SetSticky(balancer.SessionKey(105, "gpt-test", ""), 10, 2, 5*time.Minute)
	group := model.Group{
		Mode:            model.GroupModeFailover,
		SessionKeepTime: 300,
		Items: []model.GroupItem{
			{ID: 1, ChannelID: 20, ModelName: "gpt-test", Priority: 1},
		},
	}
	iter := balancer.NewIterator(group, 105, "gpt-test", "")

	if got := iter.StickyKeyID(20); got != 0 {
		t.Fatalf("expected 0 for non-sticky channel, got %d", got)
	}
	if got := iter.StickyKeyID(10); got != 2 {
		t.Fatalf("expected sticky key 2 for sticky channel, got %d", got)
	}
}

func TestIteratorStickyKeyIDZeroWithoutSession(t *testing.T) {
	group := model.Group{
		Mode: model.GroupModeFailover,
		Items: []model.GroupItem{
			{ID: 1, ChannelID: 20, ModelName: "gpt-test", Priority: 1},
		},
	}
	iter := balancer.NewIterator(group, 106, "gpt-test", "")

	if got := iter.StickyKeyID(20); got != 0 {
		t.Fatalf("expected 0 without session, got %d", got)
	}
}

func TestStickyChannelRetrySlotsStayTogether(t *testing.T) {
	// 粘性渠道 20 带 retry_count=1，非粘性渠道 10 在前：
	// 候选必须是 [20,20,10,...]（粘性渠道的重试槽位连续），而不是 [20,10,20,...]
	balancer.SetSticky(balancer.SessionKey(107, "gpt-test", "fp"), 20, 5, 5*time.Minute)
	group := model.Group{
		Mode:            model.GroupModeFailover,
		SessionKeepTime: 300,
		Items: []model.GroupItem{
			{ID: 1, ChannelID: 10, ModelName: "gpt-test", Priority: 1, RetryCount: 0},
			{ID: 2, ChannelID: 20, ModelName: "gpt-test", Priority: 2, RetryCount: 1},
		},
	}
	iter := balancer.NewIterator(group, 107, "gpt-test", "fp")

	got := make([]int, 0, iter.Len())
	for iter.Next() {
		got = append(got, iter.Item().ChannelID)
	}
	want := []int{20, 20, 10}
	if len(got) != len(want) {
		t.Fatalf("expected %d candidates, got %d: %v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate %d: expected channel %d, got %d (all=%v)", i, want[i], got[i], got)
		}
	}
}

func TestSelectChannelKeyRotatesWithinStickyChannelAfterFailure(t *testing.T) {
	// 粘性 Key 2 在本请求内失败 → 同渠道内换下一个 Key（Key1）而不是跳渠道
	r, channel := newStickyTestRun(t, 108, 10, 2, []model.ChannelKey{
		{ID: 1, Enabled: true, ChannelKey: "first", Priority: 1},
		{ID: 2, Enabled: true, ChannelKey: "second", Priority: 2},
	})
	r.failedKeys[channelKeyRef{channelID: 10, keyID: 2}] = struct{}{}

	got := r.selectChannelKey(channel)
	if got.ID != 1 {
		t.Fatalf("expected same-channel key rotation to key 1 after sticky key failed, got key %d", got.ID)
	}
}
