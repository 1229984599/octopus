package model

import (
	"encoding/json"
	"time"
)

type GroupMode int
type GroupCapability string

const (
	GroupModeRoundRobin GroupMode = 1 // 轮询：依次循环选择渠道
	GroupModeRandom     GroupMode = 2 // 随机：每次随机选择一个渠道
	GroupModeFailover   GroupMode = 3 // 故障转移：按优先级选择，失败时降级到下一个
	GroupModeWeighted   GroupMode = 4 // 加权分配：按优权重分配流量
)

const (
	GroupCapabilityAuto            GroupCapability = "auto"
	GroupCapabilityChat            GroupCapability = "chat"
	GroupCapabilityResponsesCodex  GroupCapability = "responses_codex"
	GroupCapabilityEmbedding       GroupCapability = "embedding"
	GroupCapabilityImage           GroupCapability = "image"
	GroupCapabilityImageGeneration GroupCapability = "image_generation" // legacy alias, normalized to image
	GroupCapabilityImageEdit       GroupCapability = "image_edit"       // legacy alias, normalized to image
	GroupCapabilityImageVariation  GroupCapability = "image_variation"  // legacy alias, normalized to image
)

type Group struct {
	ID                int                     `json:"id" gorm:"primaryKey"`
	Name              string                  `json:"name" gorm:"unique;not null"`
	SortOrder         int                     `json:"sort_order" gorm:"default:0;index"`
	Mode              GroupMode               `json:"mode" gorm:"not null"`
	Capability        GroupCapability         `json:"capability" gorm:"default:auto"`
	MatchRegex        string                  `json:"match_regex"`
	FirstTokenTimeOut int                     `json:"first_token_time_out"` // 单个渠道首个Token响应超时时间(秒)
	SessionKeepTime   int                     `json:"session_keep_time"`    // 会话保持时间(秒) 0 为禁用
	AutoCheck         bool                    `json:"auto_check" gorm:"default:true"`
	Items             []GroupItem             `json:"items,omitempty" gorm:"foreignKey:GroupID"`
	ExcludedItems     []GroupAutoExcludedItem `json:"excluded_items,omitempty" gorm:"foreignKey:GroupID"`
}

func (g *Group) UnmarshalJSON(data []byte) error {
	type groupAlias Group
	var payload struct {
		groupAlias
		AutoCheck *bool `json:"auto_check"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	*g = Group(payload.groupAlias)
	if payload.AutoCheck != nil {
		g.AutoCheck = *payload.AutoCheck
	} else {
		g.AutoCheck = true
	}
	if g.Capability == "" {
		g.Capability = GroupCapabilityAuto
	}
	return nil
}

type GroupItem struct {
	ID               int    `json:"id" gorm:"primaryKey"`
	GroupID          int    `json:"group_id" gorm:"not null;index:idx_group_channel_model,unique"` // 创建时不携带此字段,更新时需要
	ChannelID        int    `json:"channel_id" gorm:"not null;index:idx_group_channel_model,unique"`
	ModelName        string `json:"model_name" gorm:"not null;index:idx_group_channel_model,unique"`
	Priority         int    `json:"priority"`
	Weight           int    `json:"weight" gorm:"default:1"`
	RetryCount       int    `json:"retry_count" gorm:"default:0"`
	LastCheckOK      *bool  `json:"last_check_ok,omitempty"`
	LastCheckMessage string `json:"last_check_message,omitempty"`
	AutoExcluded     bool   `json:"auto_excluded" gorm:"default:false;index:idx_group_auto_excluded"`
}

// GroupUpdateRequest 分组更新请求 - 仅包含变更的数据
type GroupUpdateRequest struct {
	ID                int                      `json:"id" binding:"required"`
	Name              *string                  `json:"name,omitempty"`
	SortOrder         *int                     `json:"sort_order,omitempty"`           // 自定义排序
	Mode              *GroupMode               `json:"mode,omitempty"`                 // 仅在模式变更时发送
	Capability        *GroupCapability         `json:"capability,omitempty"`           // 请求/模型能力类型
	MatchRegex        *string                  `json:"match_regex,omitempty"`          // 仅在匹配正则变更时发送
	FirstTokenTimeOut *int                     `json:"first_token_time_out,omitempty"` // 仅在超时变更时发送(秒)
	SessionKeepTime   *int                     `json:"session_keep_time,omitempty"`    // 仅在会话保持时间变更时发送(秒)
	AutoCheck         *bool                    `json:"auto_check,omitempty"`           // 是否参与自动检测
	ItemsToAdd        []GroupItemAddRequest    `json:"items_to_add,omitempty"`         // 新增的 items
	ItemsToUpdate     []GroupItemUpdateRequest `json:"items_to_update,omitempty"`      // 更新的 items (priority 变更)
	ItemsToDelete     []int                    `json:"items_to_delete,omitempty"`      // 删除的 item IDs
}

// GroupItemAddRequest 新增 item 请求
type GroupItemAddRequest struct {
	ChannelID  int    `json:"channel_id" binding:"required"`
	ModelName  string `json:"model_name" binding:"required"`
	Priority   int    `json:"priority,omitempty"`
	Weight     int    `json:"weight,omitempty"`
	RetryCount int    `json:"retry_count,omitempty"`
}

// GroupItemUpdateRequest 更新 item 请求
type GroupItemUpdateRequest struct {
	ID         int  `json:"id" binding:"required"`
	Priority   *int `json:"priority,omitempty"`
	Weight     *int `json:"weight,omitempty"`
	RetryCount *int `json:"retry_count,omitempty"`
}
type GroupIDAndLLMName struct {
	ChannelID int
	ModelName string
}

type GroupAutoExcludedItem struct {
	ID               int       `json:"id" gorm:"primaryKey"`
	GroupID          int       `json:"group_id" gorm:"not null;uniqueIndex:idx_group_auto_excluded_key;index"`
	ChannelID        int       `json:"channel_id" gorm:"not null;uniqueIndex:idx_group_auto_excluded_key"`
	ModelName        string    `json:"model_name" gorm:"not null;uniqueIndex:idx_group_auto_excluded_key"`
	Reason           string    `json:"reason"`
	LastCheckOK      *bool     `json:"last_check_ok,omitempty"`
	LastCheckMessage string    `json:"last_check_message,omitempty"`
	FailedCount      int       `json:"failed_count" gorm:"default:0"`
	LastCheckedAt    time.Time `json:"last_checked_at,omitempty"`
	NextCheckAt      time.Time `json:"next_check_at,omitempty" gorm:"index"`
}
