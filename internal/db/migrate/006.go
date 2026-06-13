package migrate

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 6,
		Up:      dropPriceAndCostSchema,
	})
}

func dropPriceAndCostSchema(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}

	columnsByTable := map[string][]string{
		"stats_metrics":  {"input_cost", "output_cost"},
		"stats_totals":   {"input_cost", "output_cost"},
		"stats_dailies":  {"input_cost", "output_cost"},
		"stats_hourlies": {"input_cost", "output_cost"},
		"stats_models":   {"input_cost", "output_cost"},
		"stats_channels": {"input_cost", "output_cost"},
		"stats_api_keys": {"input_cost", "output_cost"},
		"relay_logs":     {"cost"},
		"api_keys":       {"max_cost"},
		"channel_keys":   {"total_cost"},
	}

	for table, columns := range columnsByTable {
		if !db.Migrator().HasTable(table) {
			continue
		}
		for _, column := range columns {
			if !db.Migrator().HasColumn(table, column) {
				continue
			}
			if err := dropColumn(db, table, column); err != nil {
				return fmt.Errorf("drop %s.%s: %w", table, column, err)
			}
		}
	}

	if db.Migrator().HasTable("llm_infos") {
		if err := db.Exec("DROP TABLE IF EXISTS " + quoteIdent(db, "llm_infos")).Error; err != nil {
			return fmt.Errorf("drop llm_infos: %w", err)
		}
	}
	return nil
}

func dropColumn(db *gorm.DB, table, column string) error {
	return db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", quoteIdent(db, table), quoteIdent(db, column))).Error
}

func quoteIdent(db *gorm.DB, ident string) string {
	if db != nil && db.Dialector != nil && db.Dialector.Name() == "mysql" {
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}
