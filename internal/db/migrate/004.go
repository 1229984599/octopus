package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 4,
		Up:      addRelayLogQueryIndexes,
	})
}

// 004: add indexes used by relay log list queries and retention cleanup.
func addRelayLogQueryIndexes(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	if !db.Migrator().HasTable("relay_logs") {
		return nil
	}

	switch db.Dialector.Name() {
	case "mysql":
		if err := createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time", "CREATE INDEX idx_relay_logs_time ON relay_logs (`time`)"); err != nil {
			return err
		}
		return createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time_id", "CREATE INDEX idx_relay_logs_time_id ON relay_logs (`time`, id)")
	case "postgres":
		if err := createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time", "CREATE INDEX idx_relay_logs_time ON relay_logs (time)"); err != nil {
			return err
		}
		return createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time_id", "CREATE INDEX idx_relay_logs_time_id ON relay_logs (time, id)")
	default:
		if err := createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time", "CREATE INDEX idx_relay_logs_time ON relay_logs (time)"); err != nil {
			return err
		}
		return createIndexIfMissing(db, "relay_logs", "idx_relay_logs_time_id", "CREATE INDEX idx_relay_logs_time_id ON relay_logs (time, id)")
	}
}

func createIndexIfMissing(db *gorm.DB, table, name, sql string) error {
	if db.Migrator().HasIndex(table, name) {
		return nil
	}
	if err := db.Exec(sql).Error; err != nil {
		return fmt.Errorf("failed to create index %s: %w", name, err)
	}
	return nil
}
