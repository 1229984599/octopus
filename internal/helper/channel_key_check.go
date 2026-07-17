package helper

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/looplj/axonhub/llm"
	"github.com/looplj/axonhub/llm/transformer"
)

type CheckMode string
type CheckStrategy string

const (
	CheckModeSmart               CheckMode = "smart"
	CheckModeRealImageGeneration CheckMode = "real_image_generation"
)

const (
	CheckStrategyChat                CheckStrategy = "chat"
	CheckStrategyResponses           CheckStrategy = "responses"
	CheckStrategyEmbedding           CheckStrategy = "embedding"
	CheckStrategyImageAuthOnly       CheckStrategy = "image_auth_only"
	CheckStrategyImageGenerationReal CheckStrategy = "image_generation_real"
	CheckStrategyGemini              CheckStrategy = "gemini"
	CheckStrategyAnthropic           CheckStrategy = "anthropic"
)

type ChannelKeyCheckResult struct {
	ID               int    `json:"id"`
	StatusCode       int    `json:"status_code"`
	LastUseTimeStamp int64  `json:"last_use_time_stamp,omitempty"`
	OK               bool   `json:"ok"`
	Error            string `json:"error,omitempty"`
	Strategy         string `json:"strategy,omitempty"`
	Note             string `json:"note,omitempty"`
}

func CheckChannelKeys(ctx context.Context, channel model.Channel, modelName string, keyIDs []int) []ChannelKeyCheckResult {
	return CheckChannelKeysWithMode(ctx, channel, modelName, keyIDs, CheckModeSmart)
}

func CheckChannelKeysWithMode(ctx context.Context, channel model.Channel, modelName string, keyIDs []int, mode CheckMode) []ChannelKeyCheckResult {
	return CheckChannelKeysWithOptions(ctx, channel, modelName, keyIDs, CheckOptions{Mode: mode})
}

type CheckOptions struct {
	Mode       CheckMode
	Capability model.GroupCapability
}

func CheckChannelKeysWithOptions(ctx context.Context, channel model.Channel, modelName string, keyIDs []int, options CheckOptions) []ChannelKeyCheckResult {
	selected := selectCheckKeys(channel.Keys, keyIDs)
	results := make([]ChannelKeyCheckResult, 0, len(selected))
	for _, key := range selected {
		result := CheckChannelKeyWithOptions(ctx, channel, key, modelName, options)
		results = append(results, result)
	}
	return results
}

func CheckChannelKey(ctx context.Context, channel model.Channel, key model.ChannelKey, modelName string) ChannelKeyCheckResult {
	return CheckChannelKeyWithMode(ctx, channel, key, modelName, CheckModeSmart)
}

func CheckChannelKeyWithMode(ctx context.Context, channel model.Channel, key model.ChannelKey, modelName string, mode CheckMode) ChannelKeyCheckResult {
	return CheckChannelKeyWithOptions(ctx, channel, key, modelName, CheckOptions{Mode: mode})
}

func CheckChannelKeyWithOptions(ctx context.Context, channel model.Channel, key model.ChannelKey, modelName string, options CheckOptions) ChannelKeyCheckResult {
	options.Mode = NormalizeCheckMode(options.Mode)
	options.Capability = model.NormalizeGroupCapability(options.Capability)
	strategy := SelectCheckStrategyForCapability(channel.Type, modelName, options.Mode, options.Capability)
	result := ChannelKeyCheckResult{ID: key.ID, Strategy: string(strategy)}
	if strategy == CheckStrategyImageAuthOnly {
		result.Note = "图片模型默认仅执行鉴权/模型列表检测，未真实生成图片"
	}
	if strings.TrimSpace(key.ChannelKey) == "" {
		result.Error = "key empty"
		return result
	}
	if strings.TrimSpace(modelName) == "" {
		result.Error = "model is required"
		return result
	}

	client, err := ChannelHttpClient(&channel)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	req, err := buildKeyCheckRequest(ctx, channel, key.ChannelKey, modelName, strategy)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	applyCustomHeaders(req, channel)

	if err := op.WaitChannelRateLimit(ctx, channel.ID, channel.RPM); err != nil {
		result.Error = err.Error()
		result.LastUseTimeStamp = saveCheckedKey(key, 0)
		return result
	}
	resp, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		result.LastUseTimeStamp = saveCheckedKey(key, 0)
		return result
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	result.StatusCode = resp.StatusCode
	result.OK = resp.StatusCode >= 200 && resp.StatusCode < 300
	if !result.OK {
		result.Error = resp.Status
	}
	result.LastUseTimeStamp = saveCheckedKey(key, resp.StatusCode)
	return result
}

func NormalizeCheckMode(mode CheckMode) CheckMode {
	switch mode {
	case CheckModeRealImageGeneration:
		return mode
	default:
		return CheckModeSmart
	}
}

func SelectCheckStrategy(channelType llm.APIFormat, modelName string, mode CheckMode) CheckStrategy {
	return SelectCheckStrategyForCapability(channelType, modelName, mode, model.GroupCapabilityAuto)
}

func SelectCheckStrategyForCapability(channelType llm.APIFormat, modelName string, mode CheckMode, capability model.GroupCapability) CheckStrategy {
	mode = NormalizeCheckMode(mode)
	if mode == CheckModeRealImageGeneration {
		return CheckStrategyImageGenerationReal
	}
	if IsImageGenerationCapability(capability) || IsImageChannelType(channelType) || IsImageGenerationModel(modelName) {
		return CheckStrategyImageAuthOnly
	}
	switch channelType {
	case llm.APIFormatAnthropicMessage:
		return CheckStrategyAnthropic
	case llm.APIFormatGeminiContents:
		return CheckStrategyGemini
	case llm.APIFormatOpenAIEmbedding:
		return CheckStrategyEmbedding
	case llm.APIFormatOpenAIResponse:
		return CheckStrategyResponses
	}
	if IsEmbeddingModel(modelName) {
		return CheckStrategyEmbedding
	}
	if IsResponsesCodexModel(modelName) {
		return CheckStrategyResponses
	}
	return CheckStrategyChat
}

func IsImageChannelType(channelType llm.APIFormat) bool {
	switch channelType {
	case llm.APIFormatOpenAIImageGeneration,
		llm.APIFormatOpenAIImageEdit,
		llm.APIFormatOpenAIImageVariation:
		return true
	default:
		return false
	}
}

func IsImageGenerationCapability(capability model.GroupCapability) bool {
	switch model.NormalizeGroupCapability(capability) {
	case model.GroupCapabilityImage:
		return true
	default:
		return false
	}
}

func IsImageGenerationModel(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if name == "" {
		return false
	}
	needles := []string{"gpt-image", "dall-e", "imagen", "image-generation", "image_generation", "flux", "midjourney", "stable-diffusion"}
	for _, needle := range needles {
		if strings.Contains(name, needle) {
			return true
		}
	}
	return strings.Contains(name, "image") && !strings.Contains(name, "vision")
}

func IsEmbeddingModel(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(name, "embedding") || strings.Contains(name, "embed")
}

func IsResponsesCodexModel(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(name, "codex") || strings.Contains(name, "responses")
}

func selectCheckKeys(keys []model.ChannelKey, ids []int) []model.ChannelKey {
	if len(ids) == 0 {
		selected := make([]model.ChannelKey, len(keys))
		copy(selected, keys)
		return selected
	}
	allowed := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		allowed[id] = struct{}{}
	}
	selected := make([]model.ChannelKey, 0, len(ids))
	for _, key := range keys {
		if _, ok := allowed[key.ID]; ok {
			selected = append(selected, key)
		}
	}
	return selected
}

// ResolveCheckModel 在用户选定的检测模型（desired）可能已不在上游模型列表中时，
// 解析出实际应使用的检测模型。遍历候选 key（遵守渠道 RPM、复用 FetchModels 内置的
// 禁用/429 冷却过滤），逐 key 拉取模型列表：
//   - desired 命中任一 key 的列表 → 原样返回 desired（note 为空）。
//   - 没有列表包含 desired，但至少拉到一个非空列表 → 返回首个非空列表的首个模型作为兜底，
//     并附带说明 note。
//   - 所有 key 都拉取列表失败 → 返回 desired（沿用原模型，后续 key 检测会自然反映失败），note 为空。
//
// 该函数不负责持久化，由调用方在模型发生切换时持久化 CheckModel。
func ResolveCheckModel(ctx context.Context, channel model.Channel, desired string, keyIDs []int) (resolved string, note string) {
	desired = strings.TrimSpace(desired)
	if desired == "" {
		return "", ""
	}
	selected := selectCheckKeys(channel.Keys, keyIDs)
	if len(selected) == 0 {
		return desired, ""
	}
	var fallback string
	fetched := false
	for _, key := range selected {
		if ctx.Err() != nil {
			break
		}
		if err := op.WaitChannelRateLimit(ctx, channel.ID, channel.RPM); err != nil {
			continue
		}
		single := channel
		single.Keys = []model.ChannelKey{key}
		models, err := FetchModels(ctx, single)
		if err != nil || len(models) == 0 {
			continue
		}
		fetched = true
		if strings.TrimSpace(fallback) == "" {
			fallback = strings.TrimSpace(models[0])
		}
		for _, m := range models {
			if strings.EqualFold(strings.TrimSpace(m), desired) {
				return desired, ""
			}
		}
	}
	if fetched && strings.TrimSpace(fallback) != "" {
		return fallback, fmt.Sprintf("检测模型 %s 不在可用模型列表中，已自动切换为 %s", desired, fallback)
	}
	return desired, ""
}

func buildKeyCheckRequest(ctx context.Context, channel model.Channel, key, modelName string, strategy CheckStrategy) (*http.Request, error) {
	baseURL := channel.GetBaseUrl()
	if strings.TrimSpace(baseURL) == "" {
		return nil, fmt.Errorf("base url is required")
	}
	switch strategy {
	case CheckStrategyAnthropic:
		return buildAnthropicKeyCheckRequest(ctx, baseURL, key, modelName)
	case CheckStrategyGemini:
		return buildGeminiKeyCheckRequest(ctx, baseURL, key, modelName)
	case CheckStrategyEmbedding:
		return buildOpenAIEmbeddingKeyCheckRequest(ctx, baseURL, key, modelName)
	case CheckStrategyResponses:
		return buildOpenAIResponseKeyCheckRequest(ctx, baseURL, key, modelName)
	case CheckStrategyImageAuthOnly:
		return buildModelAuthCheckRequest(ctx, channel.Type, baseURL, key, modelName)
	case CheckStrategyImageGenerationReal:
		return buildImageGenerationCheckRequest(ctx, channel.Type, baseURL, key, modelName)
	default:
		return buildOpenAIChatKeyCheckRequest(ctx, channel.Type, baseURL, key, modelName)
	}
}

func buildOpenAIChatKeyCheckRequest(ctx context.Context, channelType llm.APIFormat, baseURL, key, modelName string) (*http.Request, error) {
	version := "v1"
	if channelType == model.ChannelTypeDoubao {
		version = "v3"
	}
	url := transformer.NormalizeBaseURL(baseURL, version) + "/chat/completions"
	// 不传 temperature：部分上游（如 kimi-for-coding）强制 temperature=1，
	// 硬编码 0 会直接 400 invalid temperature。检测只需验证 key/鉴权可用性。
	body, _ := json.Marshal(map[string]any{
		"model":      modelName,
		"messages":   []map[string]string{{"role": "user", "content": "ping"}},
		"max_tokens": 1,
		"stream":     false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildModelAuthCheckRequest(ctx context.Context, channelType llm.APIFormat, baseURL, key, modelName string) (*http.Request, error) {
	switch channelType {
	case llm.APIFormatGeminiContents:
		return buildGeminiModelAuthCheckRequest(ctx, baseURL, key)
	case llm.APIFormatAnthropicMessage:
		return buildAnthropicModelAuthCheckRequest(ctx, baseURL, key)
	default:
		return buildOpenAIModelAuthCheckRequest(ctx, channelType, baseURL, key)
	}
}

func buildOpenAIModelAuthCheckRequest(ctx context.Context, channelType llm.APIFormat, baseURL, key string) (*http.Request, error) {
	version := "v1"
	if channelType == model.ChannelTypeDoubao {
		version = "v3"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, transformer.NormalizeBaseURL(baseURL, version)+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildGeminiModelAuthCheckRequest(ctx context.Context, baseURL, key string) (*http.Request, error) {
	normalized := transformer.NormalizeBaseURL(baseURL, "v1beta")
	if strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v1") {
		normalized = transformer.NormalizeBaseURL(baseURL, "")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalized+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildAnthropicModelAuthCheckRequest(ctx context.Context, baseURL, key string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, transformer.NormalizeBaseURL(baseURL, "v1")+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", key)
	req.Header.Set("Anthropic-Version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildImageGenerationCheckRequest(ctx context.Context, channelType llm.APIFormat, baseURL, key, modelName string) (*http.Request, error) {
	switch channelType {
	case llm.APIFormatOpenAIChatCompletion,
		llm.APIFormatOpenAIResponse,
		llm.APIFormatOpenAIImageGeneration,
		llm.APIFormatOpenAIImageEdit,
		llm.APIFormatOpenAIImageVariation:
		return buildOpenAIImageGenerationCheckRequest(ctx, baseURL, key, modelName)
	default:
		return nil, fmt.Errorf("real image generation check is not supported for channel type %s; use default auth check", channelType)
	}
}

func buildOpenAIImageGenerationCheckRequest(ctx context.Context, baseURL, key, modelName string) (*http.Request, error) {
	body, _ := json.Marshal(map[string]any{
		"model":  modelName,
		"prompt": "A simple small blue square on a white background.",
		"n":      1,
		"size":   "256x256",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, transformer.NormalizeBaseURL(baseURL, "v1")+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildOpenAIResponseKeyCheckRequest(ctx context.Context, baseURL, key, modelName string) (*http.Request, error) {
	body, _ := json.Marshal(map[string]any{
		"model":             modelName,
		"input":             "ping",
		"max_output_tokens": 1,
		"stream":            false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, transformer.NormalizeBaseURL(baseURL, "v1")+"/responses", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildOpenAIEmbeddingKeyCheckRequest(ctx context.Context, baseURL, key, modelName string) (*http.Request, error) {
	body, _ := json.Marshal(map[string]any{
		"model": modelName,
		"input": "ping",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, transformer.NormalizeBaseURL(baseURL, "v1")+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildAnthropicKeyCheckRequest(ctx context.Context, baseURL, key, modelName string) (*http.Request, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      modelName,
		"messages":   []map[string]string{{"role": "user", "content": "ping"}},
		"max_tokens": 1,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, transformer.NormalizeBaseURL(baseURL, "v1")+"/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", key)
	req.Header.Set("Anthropic-Version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func buildGeminiKeyCheckRequest(ctx context.Context, baseURL, key, modelName string) (*http.Request, error) {
	normalized := transformer.NormalizeBaseURL(baseURL, "v1beta")
	if strings.HasSuffix(strings.TrimRight(baseURL, "/"), "/v1") {
		normalized = transformer.NormalizeBaseURL(baseURL, "")
	}
	url := fmt.Sprintf("%s/models/%s:generateContent", normalized, modelName)
	body, _ := json.Marshal(map[string]any{
		"contents": []map[string]any{
			{"parts": []map[string]string{{"text": "ping"}}},
		},
		"generationConfig": map[string]any{
			"maxOutputTokens": 1,
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func saveCheckedKey(key model.ChannelKey, statusCode int) int64 {
	if key.ID == 0 || key.ChannelID == 0 {
		return 0
	}
	now := time.Now().Unix()
	key.StatusCode = statusCode
	key.LastUseTimeStamp = now
	_ = op.ChannelKeyUpdate(key)
	return now
}
