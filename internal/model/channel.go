package model

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/looplj/axonhub/llm"
)

type AutoGroupType int

const (
	AutoGroupTypeNone  AutoGroupType = 0 //不自动分组
	AutoGroupTypeFuzzy AutoGroupType = 1 //模糊匹配
	AutoGroupTypeExact AutoGroupType = 2 //准确匹配
	AutoGroupTypeRegex AutoGroupType = 3 //正则匹配
)

const (
	DefaultChannelRPM       = 10
	DefaultChannelAutoGroup = AutoGroupTypeRegex
)

const ChannelTypeDoubao llm.APIFormat = "doubao"

var channelKeyRoundRobinCounter uint64

type Channel struct {
	ID            int            `json:"id" gorm:"primaryKey"`
	Name          string         `json:"name" gorm:"unique;not null"`
	Type          llm.APIFormat  `json:"type"`
	Enabled       bool           `json:"enabled" gorm:"default:true"`
	BaseUrls      []BaseUrl      `json:"base_urls" gorm:"serializer:json"`
	Tags          []string       `json:"tags" gorm:"serializer:json"`
	Keys          []ChannelKey   `json:"keys" gorm:"foreignKey:ChannelID"`
	KeyMode       GroupMode      `json:"key_mode" gorm:"default:1"`
	RPM           int            `json:"rpm" gorm:"default:0"`
	Model         string         `json:"model"`
	CustomModel   string         `json:"custom_model"`
	CheckModel    string         `json:"check_model"`
	Proxy         bool           `json:"proxy" gorm:"default:false"`
	AutoSync      bool           `json:"auto_sync" gorm:"default:false"`
	AutoCheck     bool           `json:"auto_check" gorm:"default:true"`
	AutoGroup     AutoGroupType  `json:"auto_group" gorm:"default:0"`
	CustomHeader  []CustomHeader `json:"custom_header" gorm:"serializer:json"`
	ParamOverride *string        `json:"param_override"`
	ChannelProxy  *string        `json:"channel_proxy"`
	Stats         *StatsChannel  `json:"stats,omitempty" gorm:"foreignKey:ChannelID"`
	MatchRegex    *string        `json:"match_regex"`
}

func (c *Channel) UnmarshalJSON(data []byte) error {
	type channelAlias Channel
	var payload struct {
		channelAlias
		Type      json.RawMessage `json:"type"`
		AutoCheck *bool           `json:"auto_check"`
	}

	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}

	*c = Channel(payload.channelAlias)
	if payload.AutoCheck != nil {
		c.AutoCheck = *payload.AutoCheck
	} else {
		c.AutoCheck = true
	}
	if len(payload.Type) == 0 || string(payload.Type) == "null" {
		return nil
	}

	channelType, err := decodeChannelAPIFormat(payload.Type)
	if err != nil {
		return err
	}
	c.Type = channelType
	return nil
}

func decodeChannelAPIFormat(data []byte) (llm.APIFormat, error) {
	var format string
	if err := json.Unmarshal(data, &format); err == nil {
		return NormalizeChannelAPIFormat(llm.APIFormat(format)), nil
	}

	var legacyType int
	if err := json.Unmarshal(data, &legacyType); err == nil {
		if format, ok := legacyChannelTypeToAPIFormat(legacyType); ok {
			return format, nil
		}
		return "", fmt.Errorf("unsupported legacy channel type %d", legacyType)
	}

	return "", fmt.Errorf("unsupported channel type %s", string(data))
}

func NormalizeChannelAPIFormat(format llm.APIFormat) llm.APIFormat {
	if legacyType, err := strconv.Atoi(format.String()); err == nil {
		if normalized, ok := legacyChannelTypeToAPIFormat(legacyType); ok {
			return normalized
		}
	}
	return format
}

func legacyChannelTypeToAPIFormat(legacyType int) (llm.APIFormat, bool) {
	switch legacyType {
	case 0:
		return llm.APIFormatOpenAIChatCompletion, true
	case 1:
		return llm.APIFormatOpenAIResponse, true
	case 2:
		return llm.APIFormatAnthropicMessage, true
	case 3:
		return llm.APIFormatGeminiContents, true
	case 4:
		return ChannelTypeDoubao, true
	case 5:
		return llm.APIFormatOpenAIEmbedding, true
	default:
		return "", false
	}
}

type BaseUrl struct {
	URL   string `json:"url"`
	Delay int    `json:"delay"`
}

type CustomHeader struct {
	HeaderKey   string `json:"header_key"`
	HeaderValue string `json:"header_value"`
}

type ChannelCreateRequest struct {
	Channel
}

func (r *ChannelCreateRequest) UnmarshalJSON(data []byte) error {
	var channel Channel
	if err := json.Unmarshal(data, &channel); err != nil {
		return err
	}

	var payload struct {
		RPM       *int           `json:"rpm"`
		AutoGroup *AutoGroupType `json:"auto_group"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}

	if payload.RPM != nil {
		channel.RPM = *payload.RPM
	} else {
		channel.RPM = DefaultChannelRPM
	}
	if payload.AutoGroup != nil {
		channel.AutoGroup = *payload.AutoGroup
	} else {
		channel.AutoGroup = DefaultChannelAutoGroup
	}

	r.Channel = channel
	return nil
}

type ChannelKey struct {
	ID               int    `json:"id" gorm:"primaryKey"`
	ChannelID        int    `json:"channel_id"`
	Enabled          bool   `json:"enabled" gorm:"default:true"`
	ChannelKey       string `json:"channel_key"`
	StatusCode       int    `json:"status_code"`
	LastUseTimeStamp int64  `json:"last_use_time_stamp"`
	Remark           string `json:"remark"`
	Priority         int    `json:"priority" gorm:"default:1"`
	Weight           int    `json:"weight" gorm:"default:1"`
}

// ChannelUpdateRequest 渠道更新请求 - 仅包含变更的数据
type ChannelUpdateRequest struct {
	ID            int             `json:"id" binding:"required"`
	Name          *string         `json:"name,omitempty"`
	Type          *llm.APIFormat  `json:"type,omitempty"`
	Enabled       *bool           `json:"enabled,omitempty"`
	BaseUrls      *[]BaseUrl      `json:"base_urls,omitempty"`
	Tags          *[]string       `json:"tags,omitempty"`
	KeyMode       *GroupMode      `json:"key_mode,omitempty"`
	RPM           *int            `json:"rpm,omitempty"`
	Model         *string         `json:"model,omitempty"`
	CustomModel   *string         `json:"custom_model,omitempty"`
	CheckModel    *string         `json:"check_model,omitempty"`
	Proxy         *bool           `json:"proxy,omitempty"`
	AutoSync      *bool           `json:"auto_sync,omitempty"`
	AutoCheck     *bool           `json:"auto_check,omitempty"`
	AutoGroup     *AutoGroupType  `json:"auto_group,omitempty"`
	CustomHeader  *[]CustomHeader `json:"custom_header,omitempty"`
	ChannelProxy  *string         `json:"channel_proxy,omitempty"`
	ParamOverride *string         `json:"param_override,omitempty"`
	MatchRegex    *string         `json:"match_regex,omitempty"`

	KeysToAdd    []ChannelKeyAddRequest    `json:"keys_to_add,omitempty"`
	KeysToUpdate []ChannelKeyUpdateRequest `json:"keys_to_update,omitempty"`
	KeysToDelete []int                     `json:"keys_to_delete,omitempty"`
}

type ChannelBatchDeleteRequest struct {
	IDs []int `json:"ids" binding:"required"`
}

type ChannelBatchUpdateRequest struct {
	IDs       []int          `json:"ids" binding:"required"`
	Enabled   *bool          `json:"enabled,omitempty"`
	Tags      *[]string      `json:"tags,omitempty"`
	KeyMode   *GroupMode     `json:"key_mode,omitempty"`
	RPM       *int           `json:"rpm,omitempty"`
	Proxy     *bool          `json:"proxy,omitempty"`
	AutoSync  *bool          `json:"auto_sync,omitempty"`
	AutoCheck *bool          `json:"auto_check,omitempty"`
	AutoGroup *AutoGroupType `json:"auto_group,omitempty"`
}

type ChannelKeyAddRequest struct {
	Enabled    bool   `json:"enabled"`
	ChannelKey string `json:"channel_key" binding:"required"`
	Remark     string `json:"remark"`
	Priority   int    `json:"priority,omitempty"`
	Weight     int    `json:"weight,omitempty"`
}

type ChannelKeyUpdateRequest struct {
	ID         int     `json:"id" binding:"required"`
	Enabled    *bool   `json:"enabled,omitempty"`
	ChannelKey *string `json:"channel_key,omitempty"`
	Remark     *string `json:"remark,omitempty"`
	Priority   *int    `json:"priority,omitempty"`
	Weight     *int    `json:"weight,omitempty"`
}

func (c *Channel) GetBaseUrl() string {
	if c == nil || len(c.BaseUrls) == 0 {
		return ""
	}

	bestURL := ""
	bestDelay := 0
	bestSet := false

	for _, bu := range c.BaseUrls {
		if bu.URL == "" {
			continue
		}
		if !bestSet || bu.Delay < bestDelay {
			bestURL = bu.URL
			bestDelay = bu.Delay
			bestSet = true
		}
	}

	return bestURL
}

func (c *Channel) GetChannelKey() ChannelKey {
	keys := c.GetChannelKeyCandidates()
	if len(keys) == 0 {
		return ChannelKey{}
	}
	return keys[0]
}

func (c *Channel) GetChannelKeyCandidates() []ChannelKey {
	if c == nil || len(c.Keys) == 0 {
		return nil
	}

	nowSec := time.Now().Unix()
	available := make([]ChannelKey, 0, len(c.Keys))

	for _, k := range c.Keys {
		if !k.Enabled || k.ChannelKey == "" {
			continue
		}
		if k.StatusCode == 429 && k.LastUseTimeStamp > 0 {
			if nowSec-k.LastUseTimeStamp < int64(5*time.Minute/time.Second) {
				continue
			}
		}
		available = append(available, k)
	}

	if len(available) == 0 {
		return nil
	}

	switch c.KeyMode {
	case GroupModeRoundRobin:
		return roundRobinChannelKeys(sortChannelKeysByPriority(available))
	case GroupModeRandom:
		return randomChannelKeys(available)
	case GroupModeFailover:
		return sortChannelKeysByPriority(available)
	case GroupModeWeighted:
		return weightedChannelKeys(available)
	default:
		return sortChannelKeysByPriority(available)
	}
}

func roundRobinChannelKeys(keys []ChannelKey) []ChannelKey {
	n := len(keys)
	if n == 0 {
		return nil
	}
	idx := int(atomic.AddUint64(&channelKeyRoundRobinCounter, 1) % uint64(n))
	result := make([]ChannelKey, n)
	for i := 0; i < n; i++ {
		result[i] = keys[(idx+i)%n]
	}
	return result
}

func randomChannelKeys(keys []ChannelKey) []ChannelKey {
	result := make([]ChannelKey, len(keys))
	copy(result, keys)
	rand.Shuffle(len(result), func(i, j int) {
		result[i], result[j] = result[j], result[i]
	})
	return result
}

func sortChannelKeysByPriority(keys []ChannelKey) []ChannelKey {
	result := make([]ChannelKey, len(keys))
	copy(result, keys)
	sort.Slice(result, func(i, j int) bool {
		left := result[i].NormalizedPriority()
		right := result[j].NormalizedPriority()
		if left == right {
			return result[i].ID < result[j].ID
		}
		return left < right
	})
	return result
}

func weightedChannelKeys(keys []ChannelKey) []ChannelKey {
	type weightedKey struct {
		key   ChannelKey
		score float64
	}

	totalWeight := 0
	for _, key := range keys {
		w := key.Weight
		if w <= 0 {
			w = 1
		}
		totalWeight += w
	}

	scored := make([]weightedKey, len(keys))
	for i, key := range keys {
		w := key.Weight
		if w <= 0 {
			w = 1
		}
		scored[i] = weightedKey{
			key:   key,
			score: rand.Float64() * float64(w) / float64(totalWeight),
		}
	}

	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	result := make([]ChannelKey, len(scored))
	for i := range scored {
		result[i] = scored[i].key
	}
	return result
}

func (k ChannelKey) NormalizedWeight() int {
	if k.Weight <= 0 {
		return 1
	}
	return k.Weight
}

func (k ChannelKey) NormalizedPriority() int {
	if k.Priority <= 0 {
		return 1
	}
	return k.Priority
}
