package helper

import (
	"testing"

	"github.com/1229984599/octopus/internal/model"
	"github.com/looplj/axonhub/llm"
)

func TestSelectCheckStrategyUsesImageAuthOnlyByDefault(t *testing.T) {
	got := SelectCheckStrategy(llm.APIFormatOpenAIChatCompletion, "gpt-image-1", CheckModeSmart)
	if got != CheckStrategyImageAuthOnly {
		t.Fatalf("expected image auth-only strategy, got %s", got)
	}
}

func TestSelectCheckStrategyUsesImageAuthOnlyForImageChannelType(t *testing.T) {
	got := SelectCheckStrategy(llm.APIFormatOpenAIImageGeneration, "custom-model-name", CheckModeSmart)
	if got != CheckStrategyImageAuthOnly {
		t.Fatalf("expected image auth-only strategy, got %s", got)
	}
}

func TestSelectCheckStrategyUsesImageAuthOnlyForImageCapability(t *testing.T) {
	got := SelectCheckStrategyForCapability(llm.APIFormatOpenAIChatCompletion, "custom-model-name", CheckModeSmart, model.GroupCapabilityImage)
	if got != CheckStrategyImageAuthOnly {
		t.Fatalf("expected image auth-only strategy, got %s", got)
	}
}

func TestSelectCheckStrategySupportsLegacyImageCapability(t *testing.T) {
	got := SelectCheckStrategyForCapability(llm.APIFormatOpenAIChatCompletion, "custom-model-name", CheckModeSmart, model.GroupCapabilityImageGeneration)
	if got != CheckStrategyImageAuthOnly {
		t.Fatalf("expected image auth-only strategy, got %s", got)
	}
}

func TestSelectCheckStrategyAllowsExplicitRealImageGeneration(t *testing.T) {
	got := SelectCheckStrategy(llm.APIFormatOpenAIChatCompletion, "gpt-image-1", CheckModeRealImageGeneration)
	if got != CheckStrategyImageGenerationReal {
		t.Fatalf("expected real image generation strategy, got %s", got)
	}
}

func TestSelectCheckStrategyKeepsProviderSpecificChecks(t *testing.T) {
	cases := []struct {
		name        string
		channelType llm.APIFormat
		model       string
		want        CheckStrategy
	}{
		{name: "responses channel", channelType: llm.APIFormatOpenAIResponse, model: "gpt-5.1-codex", want: CheckStrategyResponses},
		{name: "embedding channel", channelType: llm.APIFormatOpenAIEmbedding, model: "text-embedding-3-small", want: CheckStrategyEmbedding},
		{name: "gemini text channel", channelType: llm.APIFormatGeminiContents, model: "gemini-2.5-flash", want: CheckStrategyGemini},
		{name: "gemini image channel", channelType: llm.APIFormatGeminiContents, model: "gemini-2.5-flash-image", want: CheckStrategyImageAuthOnly},
		{name: "doubao image model", channelType: model.ChannelTypeDoubao, model: "gpt-image-test", want: CheckStrategyImageAuthOnly},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := SelectCheckStrategy(tt.channelType, tt.model, CheckModeSmart); got != tt.want {
				t.Fatalf("expected %s, got %s", tt.want, got)
			}
		})
	}
}
