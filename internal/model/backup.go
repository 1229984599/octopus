package model

import (
	"encoding/json"
	"time"
)

// DBDump is a full-database JSON export format for Octopus.
// Import uses incremental semantics (insert new rows, and upsert on certain key-based tables).
type DBDump struct {
	Version      int       `json:"version"`
	ExportedAt   time.Time `json:"exported_at"`
	IncludeLogs  bool      `json:"include_logs"`
	IncludeStats bool      `json:"include_stats"`

	Channels    []Channel    `json:"channels,omitempty"`
	ChannelKeys []ChannelKey `json:"channel_keys,omitempty"`
	// ProxyConfigurations is reserved for compatibility with exports from
	// deployments that include proxy configuration records. This repository does
	// not currently have a matching table, so import recognizes but skips it.
	ProxyConfigurations []json.RawMessage `json:"proxy_configurations,omitempty"`
	Groups              []Group           `json:"groups,omitempty"`
	GroupItems          []GroupItem       `json:"group_items,omitempty"`
	APIKeys             []APIKey          `json:"api_keys,omitempty"`
	Settings            []Setting         `json:"settings,omitempty"`

	StatsTotal   []StatsTotal   `json:"stats_total,omitempty"`
	StatsDaily   []StatsDaily   `json:"stats_daily,omitempty"`
	StatsHourly  []StatsHourly  `json:"stats_hourly,omitempty"`
	StatsModel   []StatsModel   `json:"stats_model,omitempty"`
	StatsChannel []StatsChannel `json:"stats_channel,omitempty"`
	StatsAPIKey  []StatsAPIKey  `json:"stats_api_key,omitempty"`

	RelayLogs []RelayLog `json:"relay_logs,omitempty"`
}

type DBBackupSelection struct {
	ChannelIDs  []int    `json:"channel_ids,omitempty"`
	GroupIDs    []int    `json:"group_ids,omitempty"`
	SettingKeys []string `json:"setting_keys,omitempty"`
}

type DBBackupSelectableItem struct {
	ID        int    `json:"id"`
	Key       string `json:"key,omitempty"`
	Name      string `json:"name"`
	SubCount  int    `json:"sub_count"`
	Secondary string `json:"secondary,omitempty"`
}
type DBImportResult struct {
	// RowsAffected contains the rows affected for each table operation (insert/upsert depending on table).
	RowsAffected map[string]int64 `json:"rows_affected"`
}

type DBImportPreviewTable struct {
	Table   string `json:"table"`
	Count   int    `json:"count"`
	Action  string `json:"action"`
	Warning string `json:"warning,omitempty"`
}

type DBImportPreview struct {
	Channels      []DBBackupSelectableItem `json:"channels,omitempty"`
	Groups        []DBBackupSelectableItem `json:"groups,omitempty"`
	Settings      []DBBackupSelectableItem `json:"settings,omitempty"`
	Version       int                      `json:"version"`
	IncludeLogs   bool                     `json:"include_logs"`
	IncludeStats  bool                     `json:"include_stats"`
	Tables        []DBImportPreviewTable   `json:"tables"`
	Warnings      []string                 `json:"warnings"`
	TotalRows     int                      `json:"total_rows"`
	SkippedTables []string                 `json:"skipped_tables"`
}
