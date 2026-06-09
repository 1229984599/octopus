package model

import (
	"testing"

	"github.com/looplj/axonhub/llm"
)

func TestGroupCapabilityCompatible(t *testing.T) {
	cases := []struct {
		name    string
		group   GroupCapability
		request GroupCapability
		want    bool
	}{
		{name: "auto accepts image", group: GroupCapabilityAuto, request: GroupCapabilityImage, want: true},
		{name: "image accepts image", group: GroupCapabilityImage, request: GroupCapabilityImage, want: true},
		{name: "image rejects chat", group: GroupCapabilityImage, request: GroupCapabilityChat, want: false},
		{name: "embedding rejects image", group: GroupCapabilityEmbedding, request: GroupCapabilityImage, want: false},
		{name: "legacy image generation normalizes", group: GroupCapabilityImageGeneration, request: GroupCapabilityImage, want: true},
		{name: "responses accepts chat fallback", group: GroupCapabilityResponsesCodex, request: GroupCapabilityChat, want: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := GroupCapabilityCompatible(tt.group, tt.request); got != tt.want {
				t.Fatalf("expected %t, got %t", tt.want, got)
			}
		})
	}
}

func TestRequestCapability(t *testing.T) {
	cases := []struct {
		name          string
		requestType   llm.RequestType
		inboundFormat llm.APIFormat
		want          GroupCapability
	}{
		{name: "responses", requestType: llm.RequestTypeChat, inboundFormat: llm.APIFormatOpenAIResponse, want: GroupCapabilityResponsesCodex},
		{name: "embedding", requestType: llm.RequestTypeEmbedding, inboundFormat: llm.APIFormatOpenAIEmbedding, want: GroupCapabilityEmbedding},
		{name: "image generation", requestType: llm.RequestTypeImage, inboundFormat: llm.APIFormatOpenAIImageGeneration, want: GroupCapabilityImage},
		{name: "image edit", requestType: llm.RequestTypeImage, inboundFormat: llm.APIFormatOpenAIImageEdit, want: GroupCapabilityImage},
		{name: "image variation", requestType: llm.RequestTypeImage, inboundFormat: llm.APIFormatOpenAIImageVariation, want: GroupCapabilityImage},
		{name: "chat", requestType: llm.RequestTypeChat, inboundFormat: llm.APIFormatOpenAIChatCompletion, want: GroupCapabilityChat},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := RequestCapability(tt.requestType, tt.inboundFormat); got != tt.want {
				t.Fatalf("expected %s, got %s", tt.want, got)
			}
		})
	}
}
