package model

import (
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
