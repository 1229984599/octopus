package helper

import (
	"testing"

	"github.com/1229984599/octopus/internal/model"
)

func TestMatchAutoGroupModelsRegexIsCaseInsensitive(t *testing.T) {
	// 分组正则小写、渠道模型驼峰（MiniMax-M2.7 vs minimax-m2.7），必须能匹配
	group := model.Group{MatchRegex: "minimax-m2.7"}
	got := matchAutoGroupModels(model.AutoGroupTypeRegex, group, 1, []string{"MiniMax-M2.7", "MiniMax-M2.7-highspeed"}, nil)
	if len(got) != 2 {
		t.Fatalf("expected 2 case-insensitive matches, got %v", got)
	}
}

func TestMatchAutoGroupModelsRegexRespectsWordBoundaries(t *testing.T) {
	// 前缀相同的不同模型不应误匹配（m2.7 vs m2.7-highspeed 由调用方正则决定，这里验证精确正则行为）
	group := model.Group{MatchRegex: "^minimax-m2[.]7$"}
	got := matchAutoGroupModels(model.AutoGroupTypeRegex, group, 1, []string{"MiniMax-M2.7", "MiniMax-M2.7-highspeed"}, nil)
	if len(got) != 1 || got[0] != "MiniMax-M2.7" {
		t.Fatalf("expected exact match only, got %v", got)
	}
}

func TestMatchAutoGroupModelsExcludedKeysAreSkipped(t *testing.T) {
	group := model.Group{MatchRegex: "minimax"}
	excluded := map[string]struct{}{"1|MiniMax-M2.7": {}}
	got := matchAutoGroupModels(model.AutoGroupTypeRegex, group, 1, []string{"MiniMax-M2.7", "MiniMax-M3"}, excluded)
	if len(got) != 1 || got[0] != "MiniMax-M3" {
		t.Fatalf("expected excluded model skipped, got %v", got)
	}
}
