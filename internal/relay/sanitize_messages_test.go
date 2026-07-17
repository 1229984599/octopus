package relay

import (
	"testing"

	"github.com/looplj/axonhub/llm"
)

func strPtr(s string) *string { return &s }

func TestSanitizeEmptyMessageContents(t *testing.T) {
	req := &llm.Request{
		Messages: []llm.Message{
			{Role: "system", Content: llm.MessageContent{Content: strPtr("")}},
			{Role: "user", Content: llm.MessageContent{}}, // nil content
			{Role: "assistant", Content: llm.MessageContent{Content: strPtr("")}},
			{
				Role: "assistant",
				Content: llm.MessageContent{Content: strPtr("")},
				ToolCalls: []llm.ToolCall{
					{ID: "c1", Type: "function", Function: llm.FunctionCall{Name: "f", Arguments: "{}"}},
				},
			},
			{Role: "tool", Content: llm.MessageContent{Content: strPtr("")}, ToolCallID: strPtr("c1")},
			{Role: "user", Content: llm.MessageContent{Content: strPtr("hi")}},
			{
				Role: "user",
				Content: llm.MessageContent{
					MultipleContent: []llm.MessageContentPart{
						{Type: "text", Text: strPtr("")},
					},
				},
			},
		},
	}

	sanitizeEmptyMessageContents(req)

	// system empty -> placeholder
	if req.Messages[0].Content.Content == nil || *req.Messages[0].Content.Content != " " {
		t.Fatalf("system empty content not sanitized: %+v", req.Messages[0].Content)
	}
	// user nil content -> placeholder
	if req.Messages[1].Content.Content == nil || *req.Messages[1].Content.Content != " " {
		t.Fatalf("user nil content not sanitized: %+v", req.Messages[1].Content)
	}
	// assistant empty no tools -> placeholder
	if req.Messages[2].Content.Content == nil || *req.Messages[2].Content.Content != " " {
		t.Fatalf("assistant empty content not sanitized: %+v", req.Messages[2].Content)
	}
	// assistant with tool_calls stays empty string
	if req.Messages[3].Content.Content == nil || *req.Messages[3].Content.Content != "" {
		t.Fatalf("assistant with tool_calls should keep empty content: %+v", req.Messages[3].Content)
	}
	// tool stays empty
	if req.Messages[4].Content.Content == nil || *req.Messages[4].Content.Content != "" {
		t.Fatalf("tool empty content should be untouched: %+v", req.Messages[4].Content)
	}
	// non-empty user untouched
	if req.Messages[5].Content.Content == nil || *req.Messages[5].Content.Content != "hi" {
		t.Fatalf("non-empty user mutated: %+v", req.Messages[5].Content)
	}
	// multi empty text parts -> placeholder (replaced as string content)
	if req.Messages[6].Content.Content == nil || *req.Messages[6].Content.Content != " " {
		t.Fatalf("multi empty text parts not sanitized: %+v", req.Messages[6].Content)
	}
}

func TestMessageTextContentEmpty(t *testing.T) {
	if !messageTextContentEmpty(&llm.Message{}) {
		t.Fatal("nil content should be empty")
	}
	if !messageTextContentEmpty(&llm.Message{Content: llm.MessageContent{Content: strPtr("")}}) {
		t.Fatal("empty string should be empty")
	}
	if messageTextContentEmpty(&llm.Message{Content: llm.MessageContent{Content: strPtr("x")}}) {
		t.Fatal("non-empty string should not be empty")
	}
	if messageTextContentEmpty(&llm.Message{Content: llm.MessageContent{
		MultipleContent: []llm.MessageContentPart{{Type: "image_url", ImageURL: &llm.ImageURL{URL: "http://x"}}},
	}}) {
		t.Fatal("image part should not be empty")
	}
}
