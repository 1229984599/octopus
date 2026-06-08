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
	tags := []string{}
	if !channelBatchUpdateHasFields(&model.ChannelBatchUpdateRequest{IDs: []int{1}, Tags: &tags}) {
		t.Fatal("expected explicit empty tags to count as an update field")
	}
}

func TestBuildChannelTagSummaryCountsAndSortsTags(t *testing.T) {
	summary := buildChannelTagSummary([]model.Channel{
		{ID: 1, Tags: []string{"公益", "备用"}},
		{ID: 2, Tags: []string{"公益", "官方"}},
		{ID: 3, Tags: []string{"  备用  ", "公益"}},
	})

	if len(summary) != 3 {
		t.Fatalf("expected 3 tags, got %d", len(summary))
	}
	if summary[0].Tag != "公益" || summary[0].Count != 3 {
		t.Fatalf("expected most used tag first, got %#v", summary[0])
	}
	if summary[1].Tag != "备用" || summary[1].Count != 2 {
		t.Fatalf("expected second tag by count, got %#v", summary[1])
	}
}

func TestRenameChannelTagReplacesCaseInsensitiveAndDeduplicates(t *testing.T) {
	tags := renameChannelTags([]string{"公益", "备用"}, "公益", "备用")
	if len(tags) != 1 || tags[0] != "备用" {
		t.Fatalf("expected merge into one tag, got %#v", tags)
	}

	tags = renameChannelTags([]string{"公益", "官方"}, "公益", "公益站")
	if len(tags) != 2 || tags[0] != "公益站" || tags[1] != "官方" {
		t.Fatalf("expected renamed tag preserving order, got %#v", tags)
	}
}
