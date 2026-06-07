package model

import "testing"

func TestDefaultSettingsUseCronForNightlyTasks(t *testing.T) {
	settings := DefaultSettings()
	values := make(map[SettingKey]string, len(settings))
	for _, setting := range settings {
		values[setting.Key] = setting.Value
	}

	if got := values[SettingKeySyncLLMCron]; got != SettingDefaultDailyTwoAMCron {
		t.Fatalf("expected sync cron %q, got %q", SettingDefaultDailyTwoAMCron, got)
	}
	if got := values[SettingKeyAutoCheckCron]; got != SettingDefaultDailyTwoAMCron {
		t.Fatalf("expected auto check cron %q, got %q", SettingDefaultDailyTwoAMCron, got)
	}
}

func TestSettingValidateCronExpression(t *testing.T) {
	valid := Setting{Key: SettingKeyAutoCheckCron, Value: "0 2 * * *"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("expected valid cron expression: %v", err)
	}

	invalid := Setting{Key: SettingKeySyncLLMCron, Value: "not a cron"}
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected invalid cron expression to fail validation")
	}
}
