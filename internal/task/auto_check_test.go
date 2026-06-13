package task

import (
	"strings"
	"testing"
	"time"

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

func TestDingTalkContentIncludesRecoverySummary(t *testing.T) {
	summary := autoHealthCheckSummary{
		StartedAt:           time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local),
		FinishedAt:          time.Date(2026, 1, 2, 3, 5, 5, 0, time.Local),
		RecoveryCheckItems:  3,
		RecoveredGroupItems: 2,
	}

	content := summary.dingTalkContent()
	if !strings.Contains(content, "恢复探测: 检测 3, 恢复 2") {
		t.Fatalf("expected recovery summary in dingtalk content, got %q", content)
	}
}

func TestDingTalkContentReportsDisabledKeys(t *testing.T) {
	summary := autoHealthCheckSummary{
		StartedAt:          time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local),
		FinishedAt:         time.Date(2026, 1, 2, 3, 5, 5, 0, time.Local),
		CheckedKeys:        3,
		DisabledKeys:       2,
		DisabledKeyDetails: []string{"channel-a(1): 2 key(s)"},
	}

	content := summary.dingTalkContent()
	if !strings.Contains(content, "Key: 检测 3, 禁用 2") {
		t.Fatalf("expected disabled key summary in dingtalk content, got %q", content)
	}
	if !strings.Contains(content, "禁用 Key:\n- channel-a(1): 2 key(s)") {
		t.Fatalf("expected disabled key details in dingtalk content, got %q", content)
	}
	if strings.Contains(content, "删除 Key") {
		t.Fatalf("expected no deleted key wording in dingtalk content, got %q", content)
	}
}
