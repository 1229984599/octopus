package task

import (
	"testing"

	"github.com/1229984599/octopus/internal/model"
)

func TestDefaultCheckModelPrefersSavedCheckModel(t *testing.T) {
	channel := model.Channel{
		Model:      "model-a,model-b",
		CheckModel: " model-b ",
	}

	if got := defaultCheckModel(channel); got != "model-b" {
		t.Fatalf("expected saved check model model-b, got %q", got)
	}
}

func TestDefaultCheckModelFallsBackToFirstModel(t *testing.T) {
	channel := model.Channel{
		Model:       "model-a,model-b",
		CustomModel: "custom-a",
	}

	if got := defaultCheckModel(channel); got != "model-a" {
		t.Fatalf("expected first listed model model-a, got %q", got)
	}
}
