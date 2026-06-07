package op

import (
	"context"
	"fmt"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
	"gorm.io/gorm/clause"
)

var groupCache = cache.New[int, model.Group](16)
var groupMap = cache.New[string, model.Group](16)

func GroupList(ctx context.Context) ([]model.Group, error) {
	groups := make([]model.Group, 0, groupCache.Len())
	for _, group := range groupCache.GetAll() {
		groups = append(groups, group)
	}
	return groups, nil
}

func GroupListModel(ctx context.Context) ([]string, error) {
	models := []string{}
	for _, group := range groupCache.GetAll() {
		models = append(models, group.Name)
	}
	return models, nil
}

func GroupGet(id int, ctx context.Context) (*model.Group, error) {
	group, ok := groupCache.Get(id)
	if !ok {
		return nil, fmt.Errorf("group not found")
	}
	return &group, nil
}

func GroupGetEnabledMap(name string, ctx context.Context) (model.Group, error) {
	group, ok := groupMap.Get(name)
	if !ok {
		return model.Group{}, fmt.Errorf("group not found")
	}
	if len(group.Items) == 0 {
		group.Items = nil
		return group, nil
	}

	enabledItems := make([]model.GroupItem, 0, len(group.Items))
	for _, item := range group.Items {
		channel, ok := channelCache.Get(item.ChannelID)
		if !ok || !channel.Enabled {
			continue
		}
		enabledItems = append(enabledItems, item)
	}
	group.Items = enabledItems
	return group, nil
}

func GroupCreate(group *model.Group, ctx context.Context) error {
	autoCheck := group.AutoCheck
	if err := db.GetDB().WithContext(ctx).Create(group).Error; err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Model(&model.Group{}).
		Where("id = ?", group.ID).
		Update("auto_check", autoCheck).Error; err != nil {
		return err
	}
	group.AutoCheck = autoCheck
	groupCache.Set(group.ID, *group)
	groupMap.Set(group.Name, *group)
	return nil
}

func GroupUpdate(req *model.GroupUpdateRequest, ctx context.Context) (*model.Group, error) {
	oldGroup, ok := groupCache.Get(req.ID)
	if !ok {
		return nil, fmt.Errorf("group not found")
	}
	oldName := oldGroup.Name

	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var selectFields []string
	updates := model.Group{ID: req.ID}

	if req.Name != nil {
		selectFields = append(selectFields, "name")
		updates.Name = *req.Name
	}
	if req.Mode != nil {
		selectFields = append(selectFields, "mode")
		updates.Mode = *req.Mode
	}
	if req.MatchRegex != nil {
		selectFields = append(selectFields, "match_regex")
		updates.MatchRegex = *req.MatchRegex
	}
	if req.FirstTokenTimeOut != nil {
		selectFields = append(selectFields, "first_token_time_out")
		updates.FirstTokenTimeOut = *req.FirstTokenTimeOut
	}
	if req.SessionKeepTime != nil {
		selectFields = append(selectFields, "session_keep_time")
		updates.SessionKeepTime = *req.SessionKeepTime
	}
	if req.AutoCheck != nil {
		selectFields = append(selectFields, "auto_check")
		updates.AutoCheck = *req.AutoCheck
	}

	if len(selectFields) > 0 {
		if err := tx.Model(&model.Group{}).Where("id = ?", req.ID).Select(selectFields).Updates(&updates).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to update group: %w", err)
		}
	}

	// 删除 items
	if len(req.ItemsToDelete) > 0 {
		if err := tx.Where("id IN ? AND group_id = ?", req.ItemsToDelete, req.ID).Delete(&model.GroupItem{}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to delete items: %w", err)
		}
	}

	// 批量更新 items
	if len(req.ItemsToUpdate) > 0 {
		for _, item := range req.ItemsToUpdate {
			updates := map[string]interface{}{}
			if item.Priority != nil {
				updates["priority"] = *item.Priority
			}
			if item.Weight != nil {
				weight := *item.Weight
				if weight <= 0 {
					weight = 1
				}
				updates["weight"] = weight
			}
			if item.RetryCount != nil {
				retryCount := *item.RetryCount
				if retryCount < 0 {
					retryCount = 0
				}
				updates["retry_count"] = retryCount
			}
			if len(updates) == 0 {
				continue
			}
			if err := tx.Model(&model.GroupItem{}).
				Where("id = ? AND group_id = ?", item.ID, req.ID).
				Updates(updates).Error; err != nil {
				tx.Rollback()
				return nil, fmt.Errorf("failed to update item %d: %w", item.ID, err)
			}
		}
	}

	// 批量新增 items
	if len(req.ItemsToAdd) > 0 {
		newItems := make([]model.GroupItem, len(req.ItemsToAdd))
		for i, item := range req.ItemsToAdd {
			newItems[i] = model.GroupItem{
				GroupID:    req.ID,
				ChannelID:  item.ChannelID,
				ModelName:  item.ModelName,
				Priority:   item.Priority,
				Weight:     normalizePositive(item.Weight, 1),
				RetryCount: normalizeNonNegative(item.RetryCount),
			}
		}
		if err := tx.Create(&newItems).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to create items: %w", err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// 刷新缓存并返回最新数据
	if err := groupRefreshCacheByID(req.ID, ctx); err != nil {
		return nil, err
	}

	group, _ := groupCache.Get(req.ID)
	if oldName != "" && oldName != group.Name {
		groupMap.Del(oldName)
	}
	return &group, nil
}

func normalizePositive(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func normalizeNonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func GroupDel(id int, ctx context.Context) error {
	group, ok := groupCache.Get(id)
	if !ok {
		return fmt.Errorf("group not found")
	}

	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Where("group_id = ?", id).Delete(&model.GroupItem{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete group items: %w", err)
	}

	if err := tx.Delete(&model.Group{}, id).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete group: %w", err)
	}

	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	groupCache.Del(id)
	groupMap.Del(group.Name)
	return nil
}

func GroupItemAdd(item *model.GroupItem, ctx context.Context) error {
	if _, ok := groupCache.Get(item.GroupID); !ok {
		return fmt.Errorf("group not found")
	}

	if err := db.GetDB().WithContext(ctx).Create(item).Error; err != nil {
		return err
	}

	return groupRefreshCacheByID(item.GroupID, ctx)
}

func GroupItemBatchAdd(groupID int, items []model.GroupIDAndLLMName, ctx context.Context) error {
	if len(items) == 0 {
		return nil
	}

	group, ok := groupCache.Get(groupID)
	if !ok {
		return fmt.Errorf("group not found")
	}

	seen := make(map[string]struct{}, len(items))
	uniq := make([]model.GroupIDAndLLMName, 0, len(items))
	for _, it := range items {
		if it.ChannelID == 0 || it.ModelName == "" {
			continue
		}
		k := fmt.Sprintf("%d|%s", it.ChannelID, it.ModelName)
		if _, exists := seen[k]; exists {
			continue
		}
		seen[k] = struct{}{}
		uniq = append(uniq, it)
	}
	if len(uniq) == 0 {
		return nil
	}

	nextPriority := 1
	for _, gi := range group.Items {
		if gi.Priority >= nextPriority {
			nextPriority = gi.Priority + 1
		}
	}

	newItems := make([]model.GroupItem, 0, len(uniq))
	for _, it := range uniq {
		newItems = append(newItems, model.GroupItem{
			GroupID:    groupID,
			ChannelID:  it.ChannelID,
			ModelName:  it.ModelName,
			Priority:   nextPriority,
			Weight:     1,
			RetryCount: 0,
		})
		nextPriority++
	}

	if err := db.GetDB().WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "group_id"}, {Name: "channel_id"}, {Name: "model_name"}},
			DoNothing: true,
		}).
		Create(&newItems).Error; err != nil {
		return fmt.Errorf("failed to create group items: %w", err)
	}

	return groupRefreshCacheByID(groupID, ctx)
}

func GroupItemUpdate(item *model.GroupItem, ctx context.Context) error {
	if err := db.GetDB().WithContext(ctx).Model(item).
		Select("ModelName", "Priority", "Weight", "RetryCount").
		Updates(item).Error; err != nil {
		return err
	}

	return groupRefreshCacheByID(item.GroupID, ctx)
}

func GroupItemDel(id int, ctx context.Context) error {
	var item model.GroupItem
	if err := db.GetDB().WithContext(ctx).First(&item, id).Error; err != nil {
		return fmt.Errorf("group item not found")
	}

	if err := db.GetDB().WithContext(ctx).Delete(&item).Error; err != nil {
		return err
	}

	return groupRefreshCacheByID(item.GroupID, ctx)
}

func GroupItemBatchDel(groupID int, itemIDs []int, ctx context.Context) error {
	if len(itemIDs) == 0 {
		return nil
	}
	if _, ok := groupCache.Get(groupID); !ok {
		return fmt.Errorf("group not found")
	}
	if err := db.GetDB().WithContext(ctx).
		Where("id IN ? AND group_id = ?", itemIDs, groupID).
		Delete(&model.GroupItem{}).Error; err != nil {
		return fmt.Errorf("failed to delete group items: %w", err)
	}
	return groupRefreshCacheByID(groupID, ctx)
}

// GroupItemBatchDelByChannelAndModels 根据渠道ID和模型名称批量删除分组项
func GroupItemBatchDelByChannelAndModels(keys []model.GroupIDAndLLMName, ctx context.Context) error {
	if len(keys) == 0 {
		return nil
	}

	conditions := make([][]interface{}, len(keys))
	for i, key := range keys {
		conditions[i] = []interface{}{key.ChannelID, key.ModelName}
	}

	var groupIDs []int
	if err := db.GetDB().WithContext(ctx).
		Model(&model.GroupItem{}).
		Distinct("group_id").
		Where("(channel_id, model_name) IN ?", conditions).
		Pluck("group_id", &groupIDs).Error; err != nil {
		return fmt.Errorf("failed to find group ids: %w", err)
	}

	if len(groupIDs) == 0 {
		return nil
	}

	if err := db.GetDB().WithContext(ctx).
		Where("(channel_id, model_name) IN ?", conditions).
		Delete(&model.GroupItem{}).Error; err != nil {
		return fmt.Errorf("failed to delete group items: %w", err)
	}

	if err := groupRefreshCacheByIDs(groupIDs, ctx); err != nil {
		return fmt.Errorf("failed to refresh group cache: %w", err)
	}

	return nil
}

func GroupItemList(groupID int, ctx context.Context) ([]model.GroupItem, error) {
	var items []model.GroupItem
	if err := db.GetDB().WithContext(ctx).
		Where("group_id = ?", groupID).
		Order("priority ASC").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func groupRefreshCache(ctx context.Context) error {
	groups := []model.Group{}
	if err := db.GetDB().WithContext(ctx).
		Preload("Items").
		Find(&groups).Error; err != nil {
		return err
	}
	for _, group := range groups {
		groupCache.Set(group.ID, group)
		groupMap.Set(group.Name, group)
	}
	return nil
}

func groupRefreshCacheByID(id int, ctx context.Context) error {
	var group model.Group
	if err := db.GetDB().WithContext(ctx).
		Preload("Items").
		First(&group, id).Error; err != nil {
		return err
	}
	groupCache.Set(group.ID, group)
	groupMap.Set(group.Name, group)
	return nil
}

func groupRefreshCacheByIDs(ids []int, ctx context.Context) error {
	if len(ids) == 0 {
		return nil
	}
	var groups []model.Group
	if err := db.GetDB().WithContext(ctx).
		Preload("Items").
		Where("id IN ?", ids).
		Find(&groups).Error; err != nil {
		return err
	}
	for _, group := range groups {
		groupCache.Set(group.ID, group)
		groupMap.Set(group.Name, group)
	}
	return nil
}
