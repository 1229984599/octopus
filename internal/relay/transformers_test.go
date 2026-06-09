package relay

import (
	"testing"

	"github.com/looplj/axonhub/llm"
)

func TestNewOutboundNormalizesLegacyChannelTypes(t *testing.T) {
	cases := []struct {
		name        string
		channelType llm.APIFormat
		requestType llm.RequestType
	}{
		{name: "legacy openai chat", channelType: "0", requestType: llm.RequestTypeChat},
		{name: "legacy openai responses", channelType: "1", requestType: llm.RequestTypeChat},
		{name: "legacy anthropic", channelType: "2", requestType: llm.RequestTypeChat},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			outbound, err := newOutbound(tt.channelType, &llm.Request{RequestType: tt.requestType}, "https://example.com", "test-key")
			if err != nil {
				t.Fatalf("expected legacy channel type %q to be compatible, got error: %v", tt.channelType, err)
			}
			if outbound == nil {
				t.Fatal("expected outbound transformer")
			}
		})
	}
}
