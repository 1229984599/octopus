package handlers

import (
	"encoding/json"
	"testing"

	"github.com/1229984599/octopus/internal/model"
	"github.com/looplj/axonhub/llm"
)

func TestDecodeDBDumpSupportsExternalExportShape(t *testing.T) {
	body := []byte(`{
		"version": 1,
		"exported_at": "2026-06-07T06:59:17.013491725Z",
		"include_logs": false,
		"include_stats": false,
		"channels": [],
		"channel_keys": [],
		"proxy_configurations": [
			{"id": 1, "name": "proxy-a", "type": "socks5"}
		],
		"groups": [],
		"group_items": [],
		"api_keys": [
			{
				"id": 1,
				"name": "chat",
				"api_key": "sk-octopus-fgdsgf",
				"enabled": true
			}
		],
		"settings": [
			{
				"key": "circuit_breaker_cooldown",
				"value": "60"
			},
			{
				"key": "responses_ws_enabled",
				"value": "true"
			}
		]
	}`)

	var dump model.DBDump
	if err := decodeDBDump(body, &dump); err != nil {
		t.Fatalf("decode external export: %v", err)
	}
	if dump.Version != 1 {
		t.Fatalf("expected version 1, got %d", dump.Version)
	}
	if len(dump.ProxyConfigurations) != 1 {
		t.Fatalf("expected proxy configuration compatibility rows, got %d", len(dump.ProxyConfigurations))
	}
	if len(dump.APIKeys) != 1 {
		t.Fatalf("expected one api key, got %d", len(dump.APIKeys))
	}
	if dump.APIKeys[0].Name != "chat" || dump.APIKeys[0].APIKey != "sk-octopus-fgdsgf" || !dump.APIKeys[0].Enabled {
		t.Fatalf("decoded api key mismatch: %#v", dump.APIKeys[0])
	}
	if len(dump.Settings) != 2 {
		t.Fatalf("expected two settings, got %d", len(dump.Settings))
	}
	if dump.Settings[1].Key != "responses_ws_enabled" || dump.Settings[1].Value != "true" {
		t.Fatalf("decoded setting mismatch: %#v", dump.Settings[1])
	}
}

func TestDecodeDBDumpSupportsNumericChannelType(t *testing.T) {
	body := []byte(`{
		"version": 1,
		"channels": [
			{
				"id": 1,
				"name": "legacy-response-channel",
				"type": 1,
				"enabled": true,
				"base_urls": [{"url": "https://api.example.com", "delay": 0}],
				"keys": []
			}
		]
	}`)

	var dump model.DBDump
	if err := decodeDBDump(body, &dump); err != nil {
		t.Fatalf("decode numeric channel type: %v", err)
	}
	if len(dump.Channels) != 1 {
		t.Fatalf("expected one channel, got %d", len(dump.Channels))
	}
	if dump.Channels[0].Type != llm.APIFormatOpenAIResponse {
		t.Fatalf("expected legacy type 1 to map to %q, got %q", llm.APIFormatOpenAIResponse, dump.Channels[0].Type)
	}
}

func TestDecodeDBDumpDefaultsImportedChannels(t *testing.T) {
	body := []byte(`{
		"version": 1,
		"channels": [
			{
				"id": 1,
				"name": "missing-defaults",
				"type": "openai/chat_completions",
				"enabled": true,
				"base_urls": [{"url": "https://api.example.com", "delay": 0}],
				"keys": []
			},
			{
				"id": 2,
				"name": "explicit-zero",
				"type": "openai/chat_completions",
				"enabled": true,
				"base_urls": [{"url": "https://api.example.com", "delay": 0}],
				"keys": [],
				"rpm": 0,
				"auto_group": 0
			}
		]
	}`)

	var dump model.DBDump
	if err := decodeDBDump(body, &dump); err != nil {
		t.Fatalf("decode imported channels: %v", err)
	}
	if len(dump.Channels) != 2 {
		t.Fatalf("expected two channels, got %d", len(dump.Channels))
	}
	if dump.Channels[0].RPM != model.DefaultChannelRPM {
		t.Fatalf("expected missing rpm to default to %d, got %d", model.DefaultChannelRPM, dump.Channels[0].RPM)
	}
	if dump.Channels[0].AutoGroup != model.DefaultChannelAutoGroup {
		t.Fatalf("expected missing auto_group to default to %d, got %d", model.DefaultChannelAutoGroup, dump.Channels[0].AutoGroup)
	}
	if dump.Channels[1].RPM != 0 {
		t.Fatalf("expected explicit zero rpm to be preserved, got %d", dump.Channels[1].RPM)
	}
	if dump.Channels[1].AutoGroup != model.AutoGroupTypeNone {
		t.Fatalf("expected explicit zero auto_group to be preserved, got %d", dump.Channels[1].AutoGroup)
	}
}

func TestBuildDBImportPreviewCountsRowsAndWarnings(t *testing.T) {
	preview := buildDBImportPreview(&model.DBDump{
		Version:      1,
		IncludeLogs:  true,
		IncludeStats: false,
		Channels: []model.Channel{
			{ID: 1, Name: "a"},
			{ID: 2, Name: "b"},
		},
		ChannelKeys: []model.ChannelKey{{ID: 1}},
		ProxyConfigurations: []json.RawMessage{
			[]byte(`{"id":1}`),
		},
		RelayLogs: []model.RelayLog{{ID: 1}},
	})

	if preview.Version != 1 {
		t.Fatalf("expected version 1, got %d", preview.Version)
	}
	if preview.TotalRows != 5 {
		t.Fatalf("expected total rows 5, got %d", preview.TotalRows)
	}
	if len(preview.Tables) < 3 {
		t.Fatalf("expected preview tables, got %#v", preview.Tables)
	}
	if preview.Tables[0].Table != "channels" || preview.Tables[0].Count != 2 {
		t.Fatalf("expected channels first with count 2, got %#v", preview.Tables[0])
	}
	if len(preview.SkippedTables) != 1 || preview.SkippedTables[0] != "proxy_configurations" {
		t.Fatalf("expected proxy_configurations skipped, got %#v", preview.SkippedTables)
	}
	if len(preview.Warnings) == 0 {
		t.Fatal("expected warning for skipped compatibility table")
	}
}
