package balancer

import (
	"testing"

	"github.com/1229984599/octopus/internal/model"
)

func TestIteratorExpandsGroupItemRetryCount(t *testing.T) {
	group := model.Group{
		Mode: model.GroupModeFailover,
		Items: []model.GroupItem{
			{ID: 1, ChannelID: 10, ModelName: "gpt-test", Priority: 1, RetryCount: 2},
			{ID: 2, ChannelID: 20, ModelName: "gpt-test", Priority: 2, RetryCount: 0},
		},
	}

	iter := NewIterator(group, 0, "gpt-test", "")
	got := make([]int, 0, iter.Len())
	for iter.Next() {
		got = append(got, iter.Item().ChannelID)
	}

	want := []int{10, 10, 10, 20}
	if len(got) != len(want) {
		t.Fatalf("expected %d candidates, got %d: %v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate %d: expected channel %d, got %d (all=%v)", i, want[i], got[i], got)
		}
	}
}
