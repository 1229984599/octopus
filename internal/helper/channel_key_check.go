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

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/looplj/axonhub/llm"
	"github.com/looplj/axonhub/llm/transformer"
)

type ChannelKeyCheckResult struct {
	ID         int    `json:"id"`
	StatusCode int    `json:"status_code"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

func CheckChannelKeys(ctx context.Context, channel model.Channel, modelName string, keyIDs []int) []ChannelKeyCheckResult {
	selected := selectCheckKeys(channel.Keys, keyIDs)
	results := make([]ChannelKeyCheckResult, 0, len(selected))
	for _, key := range selected {
		result := CheckChannelKey(ctx, channel, key, modelName)
		results = append(results, result)
	}
	return results
}

func CheckChannelKey(ctx context.Context, channel model.Channel, key model.ChannelKey, modelName string) ChannelKeyCheckResult {
	result := ChannelKeyCheckResult{ID: key.ID}
	if !key.Enabled || strings.TrimSpace(key.ChannelKey) == "" {
		result.Error = "key disabled or empty"
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

	req, err := buildKeyCheckRequest(ctx, channel, key.ChannelKey, modelName)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	applyCustomHeaders(req, channel)

	resp, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		saveCheckedKey(key, 0)
		return result
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	result.StatusCode = resp.StatusCode
	result.OK = resp.StatusCode >= 200 && resp.StatusCode < 300
	if !result.OK {
		result.Error = resp.Status
	}
	saveCheckedKey(key, resp.StatusCode)
	return result
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

func buildKeyCheckRequest(ctx context.Context, channel model.Channel, key, modelName string) (*http.Request, error) {
	baseURL := channel.GetBaseUrl()
	if strings.TrimSpace(baseURL) == "" {
		return nil, fmt.Errorf("base url is required")
	}
	switch channel.Type {
	case llm.APIFormatAnthropicMessage:
		return buildAnthropicKeyCheckRequest(ctx, baseURL, key, modelName)
	case llm.APIFormatGeminiContents:
		return buildGeminiKeyCheckRequest(ctx, baseURL, key, modelName)
	default:
		return buildOpenAICompatibleKeyCheckRequest(ctx, channel.Type, baseURL, key, modelName)
	}
}

func buildOpenAICompatibleKeyCheckRequest(ctx context.Context, channelType llm.APIFormat, baseURL, key, modelName string) (*http.Request, error) {
	version := "v1"
	if channelType == model.ChannelTypeDoubao {
		version = "v3"
	}
	if channelType == llm.APIFormatOpenAIEmbedding {
		return buildOpenAIEmbeddingKeyCheckRequest(ctx, baseURL, key, modelName)
	}
	if channelType == llm.APIFormatOpenAIResponse {
		return buildOpenAIResponseKeyCheckRequest(ctx, baseURL, key, modelName)
	}
	url := transformer.NormalizeBaseURL(baseURL, version) + "/chat/completions"
	body, _ := json.Marshal(map[string]any{
		"model":       modelName,
		"messages":    []map[string]string{{"role": "user", "content": "ping"}},
		"max_tokens":  1,
		"temperature": 0,
		"stream":      false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
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

func saveCheckedKey(key model.ChannelKey, statusCode int) {
	if key.ID == 0 || key.ChannelID == 0 {
		return
	}
	key.StatusCode = statusCode
	key.LastUseTimeStamp = time.Now().Unix()
	_ = op.ChannelKeyUpdate(key)
}
