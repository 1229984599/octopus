package relay

import (
	"testing"

	"github.com/looplj/axonhub/llm"
)

func textMessage(role, content string) llm.Message {
	c := content
	return llm.Message{Role: role, Content: llm.MessageContent{Content: &c}}
}

func TestSessionFingerprintStableAcrossTurns(t *testing.T) {
	// 同一对话：第二轮历史增长（附加 assistant 回复 + 新 user 消息），
	// 首条消息和首条 user 消息不变 → 指纹必须一致。
	turn1 := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a coder"),
		textMessage("user", "hello"),
	}}
	turn2 := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a coder"),
		textMessage("user", "hello"),
		textMessage("assistant", "hi, how can I help?"),
		textMessage("user", "write a function"),
	}}

	if sessionFingerprint(turn1) != sessionFingerprint(turn2) {
		t.Fatalf("fingerprint changed across turns of the same conversation")
	}
}

func TestSessionFingerprintDiffersBetweenConversations(t *testing.T) {
	// 同一 system prompt、不同首条 user 消息 → 不同对话 → 指纹不同
	convA := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a coder"),
		textMessage("user", "hello"),
	}}
	convB := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a coder"),
		textMessage("user", "goodbye"),
	}}

	if sessionFingerprint(convA) == sessionFingerprint(convB) {
		t.Fatalf("expected different fingerprints for different conversations")
	}
}

func TestSessionFingerprintDiffersBySystemPrompt(t *testing.T) {
	// 同一 user 消息、不同 system → 视为不同对话（不同 agent/工具的会话）
	convA := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a coder"),
		textMessage("user", "hello"),
	}}
	convB := &llm.Request{Messages: []llm.Message{
		textMessage("system", "you are a writer"),
		textMessage("user", "hello"),
	}}

	if sessionFingerprint(convA) == sessionFingerprint(convB) {
		t.Fatalf("expected different fingerprints for different system prompts")
	}
}

func TestSessionFingerprintUsesFirstUserWhenLeadingSystem(t *testing.T) {
	// 两个对话共享同一条 system，但第一条 user 不同 → 必须区分
	convA := &llm.Request{Messages: []llm.Message{
		textMessage("system", "shared prompt"),
		textMessage("user", "topic A"),
		textMessage("assistant", "answer A"),
		textMessage("user", "follow up"),
	}}
	convB := &llm.Request{Messages: []llm.Message{
		textMessage("system", "shared prompt"),
		textMessage("user", "topic B"),
		textMessage("assistant", "answer B"),
		textMessage("user", "follow up"),
	}}

	if sessionFingerprint(convA) == sessionFingerprint(convB) {
		t.Fatalf("expected different fingerprints when first user message differs")
	}
}

func TestSessionFingerprintEmptyForNoMessages(t *testing.T) {
	if got := sessionFingerprint(&llm.Request{}); got != "" {
		t.Fatalf("expected empty fingerprint for empty request, got %q", got)
	}
	if got := sessionFingerprint(nil); got != "" {
		t.Fatalf("expected empty fingerprint for nil request, got %q", got)
	}
}
