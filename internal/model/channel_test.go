package model

import (
	"encoding/json"
	"slices"
	"sort"
	"sync/atomic"
	"testing"
	"time"

	"github.com/looplj/axonhub/llm"
)

func TestChannelGetChannelKeyUsesFailoverPriority(t *testing.T) {
	ch := Channel{
		KeyMode: GroupModeFailover,
		Keys: []ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "later", Priority: 20},
			{ID: 2, Enabled: true, ChannelKey: "first", Priority: 1},
		},
	}

	got := ch.GetChannelKey()
	if got.ID != 2 {
		t.Fatalf("expected priority key 2, got %d", got.ID)
	}
}

func TestChannelRoundRobinUsesPriorityOrder(t *testing.T) {
	atomic.StoreUint64(&channelKeyRoundRobinCounter, ^uint64(0))

	ch := Channel{
		KeyMode: GroupModeRoundRobin,
		Keys: []ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "later", Priority: 20},
			{ID: 2, Enabled: true, ChannelKey: "first", Priority: 1},
			{ID: 3, Enabled: true, ChannelKey: "middle", Priority: 10},
		},
	}

	candidates := ch.GetChannelKeyCandidates()
	if len(candidates) != 3 {
		t.Fatalf("expected 3 candidates, got %d", len(candidates))
	}

	positions := map[int]int{}
	for i, key := range candidates {
		positions[key.ID] = i
	}
	if positions[2] >= positions[3] || positions[3] >= positions[1] {
		t.Fatalf("expected round-robin candidate order to preserve priority cycle, got %#v", candidates)
	}
}

func TestChannelGetChannelKeyUsesWeightedKey(t *testing.T) {
	ch := Channel{
		KeyMode: GroupModeWeighted,
		Keys: []ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "zero", Weight: 0},
			{ID: 2, Enabled: true, ChannelKey: "weighted", Weight: 10},
		},
	}

	got := ch.GetChannelKey()
	if got.ID == 0 {
		t.Fatal("expected a weighted key candidate")
	}
}

func TestChannelUnmarshalAutoCheckDefaultsToTrue(t *testing.T) {
	var ch Channel
	if err := json.Unmarshal([]byte(`{"id":1,"name":"test","type":"openai/chat_completions"}`), &ch); err != nil {
		t.Fatal(err)
	}
	if !ch.AutoCheck {
		t.Fatal("expected auto_check to default to true when missing")
	}
}

func TestChannelUnmarshalAutoCheckPreservesFalse(t *testing.T) {
	var ch Channel
	if err := json.Unmarshal([]byte(`{"id":1,"name":"test","type":"openai/chat_completions","auto_check":false}`), &ch); err != nil {
		t.Fatal(err)
	}
	if ch.AutoCheck {
		t.Fatal("expected explicit auto_check=false to be preserved")
	}
}

func TestChannelUnmarshalSupportsLegacyStringType(t *testing.T) {
	var ch Channel
	if err := json.Unmarshal([]byte(`{"id":1,"name":"legacy","type":"2"}`), &ch); err != nil {
		t.Fatal(err)
	}
	if ch.Type != llm.APIFormatAnthropicMessage {
		t.Fatalf("expected legacy string type 2 to map to %q, got %q", llm.APIFormatAnthropicMessage, ch.Type)
	}
}

func TestChannelCreateRequestDefaultsRPMAndAutoGroup(t *testing.T) {
	var req ChannelCreateRequest
	if err := json.Unmarshal([]byte(`{"name":"test","type":"openai/chat_completions"}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.RPM != DefaultChannelRPM {
		t.Fatalf("expected default rpm %d, got %d", DefaultChannelRPM, req.RPM)
	}
	if req.AutoGroup != DefaultChannelAutoGroup {
		t.Fatalf("expected default auto_group %d, got %d", DefaultChannelAutoGroup, req.AutoGroup)
	}
}

func TestChannelCreateRequestPreservesExplicitZeroDefaults(t *testing.T) {
	var req ChannelCreateRequest
	if err := json.Unmarshal([]byte(`{"name":"test","type":"openai/chat_completions","rpm":0,"auto_group":0}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.RPM != 0 {
		t.Fatalf("expected explicit rpm 0 to be preserved, got %d", req.RPM)
	}
	if req.AutoGroup != AutoGroupTypeNone {
		t.Fatalf("expected explicit auto_group none to be preserved, got %d", req.AutoGroup)
	}
}

func TestGetChannelKeyCandidatesCooldownFiltersFailedKeys(t *testing.T) {
	now := time.Now().Unix()
	ch := Channel{
		KeyMode: GroupModeFailover,
		Keys: []ChannelKey{
			// 429 冷却 5 分钟内：跳过
			{ID: 1, Enabled: true, ChannelKey: "rate-limited", StatusCode: 429, LastUseTimeStamp: now - 60},
			// 402 冷却 30 分钟内：跳过
			{ID: 2, Enabled: true, ChannelKey: "no-balance", StatusCode: 402, LastUseTimeStamp: now - 10*60},
			// 402 冷却已过：可用
			{ID: 3, Enabled: true, ChannelKey: "no-balance-recovered", StatusCode: 402, LastUseTimeStamp: now - 31*60},
			// 401 无冷却（由健康检测禁用）：仍可用
			{ID: 4, Enabled: true, ChannelKey: "unauthorized", StatusCode: 401, LastUseTimeStamp: now - 60},
			// 429 冷却已过：可用
			{ID: 5, Enabled: true, ChannelKey: "rate-limited-recovered", StatusCode: 429, LastUseTimeStamp: now - 6*60},
		},
	}

	got := ch.GetChannelKeyCandidates()
	gotIDs := make([]int, 0, len(got))
	for _, k := range got {
		gotIDs = append(gotIDs, k.ID)
	}
	sort.Ints(gotIDs)
	if !slices.Equal(gotIDs, []int{3, 4, 5}) {
		t.Fatalf("expected keys [3 4 5] after cooldown filtering, got %v", gotIDs)
	}
}

func TestGetChannelKeyCandidatesCooldownRequiresTimestamp(t *testing.T) {
	// 无时间戳的失败 Key（如刚导入）不进入冷却，仍参与调度
	ch := Channel{
		KeyMode: GroupModeFailover,
		Keys: []ChannelKey{
			{ID: 1, Enabled: true, ChannelKey: "no-balance-no-ts", StatusCode: 402},
		},
	}
	got := ch.GetChannelKeyCandidates()
	if len(got) != 1 || got[0].ID != 1 {
		t.Fatalf("expected key 1 without timestamp to stay available, got %v", got)
	}
}

func TestGetBaseUrlPrefersMeasuredDelay(t *testing.T) {
	// 第一个 URL 从未测速（delay=0），第二个已测速：应选已测速的，而不是把 0 当最快
	ch := Channel{BaseUrls: []BaseUrl{
		{URL: "https://unmeasured.example.com", Delay: 0},
		{URL: "https://measured.example.com", Delay: 120},
	}}
	if got := ch.GetBaseUrl(); got != "https://measured.example.com" {
		t.Fatalf("expected measured URL, got %s", got)
	}
}

func TestGetBaseUrlFallsBackWhenAllUnmeasured(t *testing.T) {
	ch := Channel{BaseUrls: []BaseUrl{
		{URL: "https://a.example.com", Delay: 0},
		{URL: "https://b.example.com", Delay: 0},
	}}
	if got := ch.GetBaseUrl(); got != "https://a.example.com" {
		t.Fatalf("expected first URL when all unmeasured, got %s", got)
	}
}

func TestGetBaseUrlPicksLowestMeasured(t *testing.T) {
	ch := Channel{BaseUrls: []BaseUrl{
		{URL: "https://slow.example.com", Delay: 500},
		{URL: "https://fast.example.com", Delay: 80},
		{URL: "https://unmeasured.example.com", Delay: 0},
	}}
	if got := ch.GetBaseUrl(); got != "https://fast.example.com" {
		t.Fatalf("expected fastest measured URL, got %s", got)
	}
}
