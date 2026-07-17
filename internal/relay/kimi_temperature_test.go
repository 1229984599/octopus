package relay

import (
	"testing"

	dbmodel "github.com/1229984599/octopus/internal/model"
	"github.com/looplj/axonhub/llm"
)

func floatPtr(v float64) *float64 { return &v }

func TestIsKimiCodingChannel(t *testing.T) {
	cases := []struct {
		name    string
		req     *llm.Request
		channel *dbmodel.Channel
		want    bool
	}{
		{
			name:    "kimi coding base url",
			req:     &llm.Request{Model: "anything"},
			channel: &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.kimi.com/coding/v1"}}},
			want:    true,
		},
		{
			name:    "kimi-for-coding model",
			req:     &llm.Request{Model: "kimi-for-coding"},
			channel: &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://other.example.com/v1"}}},
			want:    true,
		},
		{
			name:    "non-kimi channel",
			req:     &llm.Request{Model: "gpt-4"},
			channel: &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.openai.com/v1"}}},
			want:    false,
		},
		{
			name:    "kimi host without coding path",
			req:     &llm.Request{Model: "moonshot-v1"},
			channel: &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.moonshot.cn/v1"}}},
			want:    false,
		},
		{
			name:    "nil req",
			req:     nil,
			channel: &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.kimi.com/coding/v1"}}},
			want:    false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isKimiCodingChannel(tc.req, tc.channel); got != tc.want {
				t.Fatalf("isKimiCodingChannel=%v want %v", got, tc.want)
			}
		})
	}
}

func TestNormalizeKimiCodingTemperature(t *testing.T) {
	kimiChan := &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.kimi.com/coding/v1"}}}
	otherChan := &dbmodel.Channel{BaseUrls: []dbmodel.BaseUrl{{URL: "https://api.openai.com/v1"}}}

	// temp=0 -> forced to 1
	req := &llm.Request{Model: "kimi-for-coding", Temperature: floatPtr(0)}
	normalizeKimiCodingTemperature(req, kimiChan)
	if req.Temperature == nil || *req.Temperature != 1 {
		t.Fatalf("temp 0 not normalized to 1: %v", req.Temperature)
	}

	// temp=1 -> stays 1
	req = &llm.Request{Model: "kimi-for-coding", Temperature: floatPtr(1)}
	normalizeKimiCodingTemperature(req, kimiChan)
	if req.Temperature == nil || *req.Temperature != 1 {
		t.Fatalf("temp 1 should stay 1: %v", req.Temperature)
	}

	// temp=0.5 -> forced to 1
	req = &llm.Request{Model: "kimi-for-coding", Temperature: floatPtr(0.5)}
	normalizeKimiCodingTemperature(req, kimiChan)
	if req.Temperature == nil || *req.Temperature != 1 {
		t.Fatalf("temp 0.5 not normalized to 1: %v", req.Temperature)
	}

	// nil temp -> untouched (upstream defaults to 1)
	req = &llm.Request{Model: "kimi-for-coding", Temperature: nil}
	normalizeKimiCodingTemperature(req, kimiChan)
	if req.Temperature != nil {
		t.Fatalf("nil temp should stay nil: %v", req.Temperature)
	}

	// non-kimi channel -> untouched
	req = &llm.Request{Model: "gpt-4", Temperature: floatPtr(0)}
	normalizeKimiCodingTemperature(req, otherChan)
	if req.Temperature == nil || *req.Temperature != 0 {
		t.Fatalf("non-kimi temp 0 should stay 0: %v", req.Temperature)
	}
}
