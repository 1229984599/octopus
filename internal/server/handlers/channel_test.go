package handlers

import (
	"testing"

	"github.com/1229984599/octopus/internal/model"
)

func TestNormalizeChannelIDsRejectsEmptyAndInvalid(t *testing.T) {
	if _, err := normalizeChannelIDs(nil); err == nil {
		t.Fatal("expected empty ids to fail")
	}
	if _, err := normalizeChannelIDs([]int{1, 0}); err == nil {
		t.Fatal("expected invalid id to fail")
	}
}

func TestNormalizeChannelIDsDeduplicates(t *testing.T) {
	ids, err := normalizeChannelIDs([]int{3, 1, 3, 2, 1})
	if err != nil {
		t.Fatalf("normalize ids: %v", err)
	}
	want := []int{3, 1, 2}
	if len(ids) != len(want) {
		t.Fatalf("expected %d ids, got %d", len(want), len(ids))
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("expected ids %#v, got %#v", want, ids)
		}
	}
}

func TestChannelBatchUpdateHasFields(t *testing.T) {
	if channelBatchUpdateHasFields(&model.ChannelBatchUpdateRequest{IDs: []int{1}}) {
		t.Fatal("expected no update fields")
	}
	rpm := 0
	if !channelBatchUpdateHasFields(&model.ChannelBatchUpdateRequest{IDs: []int{1}, RPM: &rpm}) {
		t.Fatal("expected explicit zero rpm to count as an update field")
	}
}
