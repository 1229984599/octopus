package migrate

import (
	"fmt"

	"github.com/1229984599/octopus/internal/utils/log"
	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 7,
		Up:      deleteOrphanGroupItems,
	})
}

// deleteOrphanGroupItems 清理指向已删除分组的孤儿 group_items。
// group_del 事务删表外（如同步任务的 GroupItemBatchDelByChannelAndModels）
// 与历史版本可能遗留 group 已删但 items 残留的脏数据，导致统计与自动分组失真。
func deleteOrphanGroupItems(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	if !db.Migrator().HasTable("group_items") || !db.Migrator().HasTable("groups") {
		return nil
	}

	result := db.Exec(`
		DELETE FROM group_items
		WHERE group_id NOT IN (SELECT id FROM groups)
	`)
	if result.Error != nil {
		return fmt.Errorf("delete orphan group items: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		log.Infof("migration 007: deleted %d orphan group items", result.RowsAffected)
	}
	return nil
}
