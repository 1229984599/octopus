package relay

import (
	"strings"
	"testing"
)

type fakeCtx struct {
	headers map[string]string
	query   map[string]string
}

func (f fakeCtx) GetHeader(k string) string { return f.headers[k] }
func (f fakeCtx) Query(k string) string     { return f.query[k] }

func TestRenderLiteral(t *testing.T) {
	got := renderHeaderValue("codex_cli_rs", fakeCtx{})
	if got != "codex_cli_rs" {
		t.Fatalf("literal not preserved: %q", got)
	}
}

func TestRenderUUID(t *testing.T) {
	got := renderHeaderValue("{{uuid}}", fakeCtx{})
	if got == "" || !strings.Contains(got, "-") {
		t.Fatalf("uuid not generated: %q", got)
	}
	got2 := renderHeaderValue("{{uuid}}", fakeCtx{})
	if got == got2 {
		t.Fatalf("uuid not unique across calls: %q", got)
	}
}

func TestInboundHeaderPassthrough(t *testing.T) {
	ctx := fakeCtx{headers: map[string]string{"session_id": "abc"}}
	got := renderHeaderValue("{{inbound.header.session_id|{{uuid}}}}", ctx)
	if got != "abc" {
		t.Fatalf("inbound header not passthrough: %q", got)
	}
}

func TestInboundHeaderFallbackUUID(t *testing.T) {
	got := renderHeaderValue("{{inbound.header.session_id|{{uuid}}}}", fakeCtx{})
	if got == "" || !strings.Contains(got, "-") {
		t.Fatalf("should fallback to uuid: %q", got)
	}
}

func TestEmptyFallbackReturnsEmpty(t *testing.T) {
	got := renderHeaderValue("{{inbound.header.anthropic-beta|}}", fakeCtx{})
	if got != "" {
		t.Fatalf("empty fallback should render empty: %q", got)
	}
}

func TestLiteralFallback(t *testing.T) {
	got := renderHeaderValue("{{platform|unknown}}", fakeCtx{})
	if got != "unknown" {
		t.Fatalf("literal fallback failed: %q", got)
	}
}

func TestMixedLiteralAndPlaceholder(t *testing.T) {
	ctx := fakeCtx{headers: map[string]string{"session_id": "S"}}
	got := renderHeaderValue("prefix-{{inbound.header.session_id|{{uuid}}}}-suffix", ctx)
	if got != "prefix-S-suffix" {
		t.Fatalf("mixed render failed: %q", got)
	}
}

func TestInboundQuery(t *testing.T) {
	ctx := fakeCtx{query: map[string]string{"model": "gpt-4"}}
	got := renderHeaderValue("{{inbound.query.model|default}}", ctx)
	if got != "gpt-4" {
		t.Fatalf("query passthrough failed: %q", got)
	}
}

func TestUnclosedPlaceholderPreserved(t *testing.T) {
	got := renderHeaderValue("foo {{uuid bar", fakeCtx{})
	if got != "foo {{uuid bar" {
		t.Fatalf("unclosed placeholder should be preserved: %q", got)
	}
}

func TestMultiFallback(t *testing.T) {
	// 三段回退：header 缺失 → query 缺失 → 字面量
	got := renderHeaderValue("{{inbound.header.x|inbound.query.x|lit}}", fakeCtx{})
	if got != "lit" {
		t.Fatalf("multi fallback should hit literal: %q", got)
	}
}
