package helper

import (
	"reflect"
	"testing"

	"github.com/1229984599/octopus/internal/model"
)

func TestMatchAutoGroupModelsSkipsExcludedRegexMatches(t *testing.T) {
	group := model.Group{ID: 1, Name: "gpt", MatchRegex: "^gpt-"}
	excluded := map[string]struct{}{"7|gpt-bad": {}}

	got := matchAutoGroupModels(
		model.AutoGroupTypeRegex,
		group,
		7,
		[]string{"gpt-good", "gpt-bad", "claude"},
		excluded,
	)

	want := []string{"gpt-good"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}
