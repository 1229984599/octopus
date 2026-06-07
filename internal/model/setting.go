package model

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/robfig/cron/v3"
)

type SettingKey string

const (
	SettingKeyProxyURL                  SettingKey = "proxy_url"
	SettingKeyStatsSaveInterval         SettingKey = "stats_save_interval"          // 将统计信息写入数据库的周期(分钟)
	SettingKeyModelInfoUpdateInterval   SettingKey = "model_info_update_interval"   // 模型信息更新间隔(小时)
	SettingKeySyncLLMInterval           SettingKey = "sync_llm_interval"            // 兼容旧版：LLM 同步间隔(小时)
	SettingKeySyncLLMCron               SettingKey = "sync_llm_cron"                // LLM 同步 cron 表达式
	SettingKeyRelayLogKeepPeriod        SettingKey = "relay_log_keep_period"        // 日志保存时间范围(天)
	SettingKeyRelayLogKeepEnabled       SettingKey = "relay_log_keep_enabled"       // 是否保留历史日志
	SettingKeyCORSAllowOrigins          SettingKey = "cors_allow_origins"           // 跨域白名单(逗号分隔, 如 "example.com,example2.com"). 为空不允许跨域, "*"允许所有
	SettingKeyCircuitBreakerThreshold   SettingKey = "circuit_breaker_threshold"    // 熔断触发阈值（连续失败次数）
	SettingKeyCircuitBreakerCooldown    SettingKey = "circuit_breaker_cooldown"     // 熔断基础冷却时间（秒）
	SettingKeyCircuitBreakerMaxCooldown SettingKey = "circuit_breaker_max_cooldown" // 熔断最大冷却时间（秒），指数退避上限
	SettingKeyAutoCheckEnabled          SettingKey = "auto_check_enabled"           // 是否启用全局自动检测
	SettingKeyAutoCheckInterval         SettingKey = "auto_check_interval"          // 兼容旧版：自动检测周期(分钟)
	SettingKeyAutoCheckCron             SettingKey = "auto_check_cron"              // 自动检测 cron 表达式
	SettingKeyAutoCheckDingTalkWebhook  SettingKey = "auto_check_dingtalk_webhook"  // 自动检测钉钉机器人 webhook
	SettingKeyAutoCheckDingTalkSecret   SettingKey = "auto_check_dingtalk_secret"   // 自动检测钉钉机器人加签密钥
)

const SettingDefaultDailyTwoAMCron = "0 2 * * *"

type Setting struct {
	Key   SettingKey `json:"key" gorm:"primaryKey"`
	Value string     `json:"value" gorm:"not null"`
}

func IsKnownSettingKey(key SettingKey) bool {
	switch key {
	case SettingKeyProxyURL,
		SettingKeyStatsSaveInterval,
		SettingKeyModelInfoUpdateInterval,
		SettingKeySyncLLMInterval,
		SettingKeySyncLLMCron,
		SettingKeyRelayLogKeepPeriod,
		SettingKeyRelayLogKeepEnabled,
		SettingKeyCORSAllowOrigins,
		SettingKeyCircuitBreakerThreshold,
		SettingKeyCircuitBreakerCooldown,
		SettingKeyCircuitBreakerMaxCooldown,
		SettingKeyAutoCheckEnabled,
		SettingKeyAutoCheckInterval,
		SettingKeyAutoCheckCron,
		SettingKeyAutoCheckDingTalkWebhook,
		SettingKeyAutoCheckDingTalkSecret:
		return true
	default:
		return false
	}
}

func DefaultSettings() []Setting {
	return []Setting{
		{Key: SettingKeyProxyURL, Value: ""},
		{Key: SettingKeyStatsSaveInterval, Value: "10"},       // 默认10分钟保存一次统计信息
		{Key: SettingKeyCORSAllowOrigins, Value: ""},          // CORS 默认不允许跨域，设置为 "*" 才允许所有来源
		{Key: SettingKeyModelInfoUpdateInterval, Value: "24"}, // 默认24小时更新一次模型信息
		{Key: SettingKeySyncLLMCron, Value: SettingDefaultDailyTwoAMCron},
		{Key: SettingKeyRelayLogKeepPeriod, Value: "7"},          // 默认日志保存7天
		{Key: SettingKeyRelayLogKeepEnabled, Value: "true"},      // 默认保留历史日志
		{Key: SettingKeyCircuitBreakerThreshold, Value: "5"},     // 默认连续失败5次触发熔断
		{Key: SettingKeyCircuitBreakerCooldown, Value: "60"},     // 默认基础冷却60秒
		{Key: SettingKeyCircuitBreakerMaxCooldown, Value: "600"}, // 默认最大冷却600秒（10分钟）
		{Key: SettingKeyAutoCheckEnabled, Value: "true"},         // 默认启用自动检测任务
		{Key: SettingKeyAutoCheckCron, Value: SettingDefaultDailyTwoAMCron},
		{Key: SettingKeyAutoCheckDingTalkWebhook, Value: ""}, // 默认不推送钉钉通知
		{Key: SettingKeyAutoCheckDingTalkSecret, Value: ""},  // 默认不启用钉钉加签
	}
}

func (s *Setting) Validate() error {
	if !IsKnownSettingKey(s.Key) {
		return fmt.Errorf("setting %s is not supported", s.Key)
	}
	switch s.Key {
	case SettingKeyStatsSaveInterval, SettingKeyModelInfoUpdateInterval, SettingKeySyncLLMInterval, SettingKeyRelayLogKeepPeriod,
		SettingKeyCircuitBreakerThreshold, SettingKeyCircuitBreakerCooldown, SettingKeyCircuitBreakerMaxCooldown,
		SettingKeyAutoCheckInterval:
		value, err := strconv.Atoi(s.Value)
		if err != nil {
			return fmt.Errorf("setting %s must be an integer", s.Key)
		}
		if s.Key == SettingKeyAutoCheckInterval && value <= 0 {
			return fmt.Errorf("setting %s must be greater than 0", s.Key)
		}
		if value < 0 {
			return fmt.Errorf("setting %s must be greater than or equal to 0", s.Key)
		}
		return nil
	case SettingKeyRelayLogKeepEnabled, SettingKeyAutoCheckEnabled:
		if s.Value != "true" && s.Value != "false" {
			return fmt.Errorf("setting %s must be true or false", s.Key)
		}
		return nil
	case SettingKeySyncLLMCron, SettingKeyAutoCheckCron:
		if err := validateCronExpression(s.Value); err != nil {
			return fmt.Errorf("setting %s %w", s.Key, err)
		}
		return nil
	case SettingKeyProxyURL, SettingKeyAutoCheckDingTalkWebhook:
		value := strings.TrimSpace(s.Value)
		if value == "" {
			return nil
		}
		parsedURL, err := url.Parse(value)
		if err != nil {
			return fmt.Errorf("URL is invalid: %w", err)
		}
		if s.Key == SettingKeyProxyURL {
			validSchemes := map[string]bool{
				"http":   true,
				"https":  true,
				"socks5": true,
			}
			if !validSchemes[parsedURL.Scheme] {
				return fmt.Errorf("proxy URL scheme must be http, https, socks, or socks5")
			}
		} else if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
			return fmt.Errorf("webhook URL scheme must be http or https")
		}
		if parsedURL.Host == "" {
			return fmt.Errorf("URL must have a host")
		}
		return nil
	case SettingKeyAutoCheckDingTalkSecret:
		return nil
	}

	return nil
}

func validateCronExpression(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("must not be empty")
	}
	parser := cron.NewParser(
		cron.Minute |
			cron.Hour |
			cron.Dom |
			cron.Month |
			cron.Dow |
			cron.Descriptor,
	)
	if _, err := parser.Parse(value); err != nil {
		return fmt.Errorf("must be a valid cron expression: %w", err)
	}
	return nil
}
