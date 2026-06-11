package migrate

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

func init() {
	RegisterBeforeAutoMigration(Migration{
		Version: 5,
		Up:      repairMySQLGroupAutoExcludedItems,
	})
}

// 005: v0.1.9 introduced group_auto_excluded_items with model_name in a
// unique key. On MySQL, an unbounded string may become TEXT/LONGTEXT, which
// cannot be indexed without a prefix length. Repair possible partial tables
// before AutoMigrate recreates or updates the schema.
func repairMySQLGroupAutoExcludedItems(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	if db.Dialector.Name() != "mysql" {
		return nil
	}
	const table = "group_auto_excluded_items"
	if !db.Migrator().HasTable(table) {
		return nil
	}

	var count int64
	if err := db.Table(table).Count(&count).Error; err != nil {
		return fmt.Errorf("failed to count %s: %w", table, err)
	}
	if count == 0 {
		if err := db.Exec("DROP TABLE `group_auto_excluded_items`").Error; err != nil {
			return fmt.Errorf("failed to drop empty %s: %w", table, err)
		}
		return nil
	}

	if err := db.Exec("ALTER TABLE `group_auto_excluded_items` MODIFY COLUMN `model_name` varchar(191) NOT NULL").Error; err != nil {
		return fmt.Errorf("failed to alter %s.model_name: %w", table, err)
	}

	if db.Migrator().HasIndex(table, "idx_group_auto_excluded_key") {
		return nil
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_group_auto_excluded_key ON group_auto_excluded_items (group_id, channel_id, model_name)`).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return fmt.Errorf("failed to create %s unique index, duplicate excluded items exist: %w", table, err)
		}
		return fmt.Errorf("failed to create %s unique index: %w", table, err)
	}
	return nil
}
