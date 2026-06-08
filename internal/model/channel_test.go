package model

import (
	"encoding/json"
	"sync/atomic"
	"testing"
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
