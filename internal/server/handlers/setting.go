package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/1229984599/octopus/internal/client"
	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/1229984599/octopus/internal/server/middleware"
	"github.com/1229984599/octopus/internal/server/resp"
	"github.com/1229984599/octopus/internal/server/router"
	"github.com/1229984599/octopus/internal/task"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/setting").
		Use(middleware.Auth()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(getSettingList),
		).
		AddRoute(
			router.NewRoute("/set", http.MethodPost).
				Use(middleware.RequireJSON()).
				Handle(setSetting),
		).
		AddRoute(
			router.NewRoute("/task-status", http.MethodGet).
				Handle(getTaskStatus),
		).
		AddRoute(
			router.NewRoute("/auto-check/run", http.MethodPost).
				Handle(runAutoCheck),
		).
		AddRoute(
			router.NewRoute("/auto-check/status", http.MethodGet).
				Handle(getAutoCheckStatus),
		).
		AddRoute(
			router.NewRoute("/auto-check/cancel", http.MethodPost).
				Handle(cancelAutoCheck),
		).
		AddRoute(
			router.NewRoute("/auto-check/test-dingtalk", http.MethodPost).
				Use(middleware.RequireJSON()).
				Handle(testAutoCheckDingTalk),
		).
		AddRoute(
			router.NewRoute("/test-proxy", http.MethodPost).
				Use(middleware.RequireJSON()).
				Handle(testProxy),
		).
		AddRoute(
			router.NewRoute("/export", http.MethodPost).
				Use(middleware.RequireJSON()).
				Handle(exportDB),
		).
		AddRoute(
			router.NewRoute("/export/preview", http.MethodGet).
				Handle(previewExportDB),
		).
		AddRoute(
			router.NewRoute("/import", http.MethodPost).
				Handle(importDB),
		).
		AddRoute(
			router.NewRoute("/import/preview", http.MethodPost).
				Handle(previewImportDB),
		)
}

func getSettingList(c *gin.Context) {
	settings, err := op.SettingList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, settings)
}

func setSetting(c *gin.Context) {
	var setting model.Setting
	if err := c.ShouldBindJSON(&setting); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := setting.Validate(); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.SettingSetString(setting.Key, setting.Value); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	switch setting.Key {
	case model.SettingKeyModelInfoUpdateInterval:
		hours, err := strconv.Atoi(setting.Value)
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		task.Update(string(setting.Key), time.Duration(hours)*time.Hour)
	case model.SettingKeySyncLLMCron:
		if err := task.UpdateCron(task.TaskSyncLLM, setting.Value); err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	case model.SettingKeyAutoCheckCron:
		task.UpdateAutoHealthCheckTask()
	}
	resp.Success(c, setting)
}

func getTaskStatus(c *gin.Context) {
	name := c.Query("name")
	if strings.TrimSpace(name) == "" {
		resp.Error(c, http.StatusBadRequest, "missing task name")
		return
	}
	status, ok := task.GetStatus(name)
	if !ok {
		resp.Error(c, http.StatusNotFound, "task not found")
		return
	}
	resp.Success(c, status)
}

func runAutoCheck(c *gin.Context) {
	if err := task.StartAutoHealthCheckTask("手动检测"); err != nil {
		if errors.Is(err, task.ErrAutoHealthCheckRunning) {
			resp.Error(c, http.StatusConflict, "自动检测任务正在运行")
			return
		}
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := task.MarkRunNow(task.TaskAutoCheck); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func getAutoCheckStatus(c *gin.Context) {
	resp.Success(c, task.GetAutoHealthCheckStatus())
}

func cancelAutoCheck(c *gin.Context) {
	if err := task.CancelAutoHealthCheckTask(); err != nil {
		if errors.Is(err, task.ErrAutoHealthCheckNotRunning) {
			resp.Error(c, http.StatusConflict, "当前没有正在运行的自动检测任务")
			return
		}
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func testAutoCheckDingTalk(c *gin.Context) {
	var request struct {
		Webhook string `json:"webhook"`
		Secret  string `json:"secret"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	if err := task.TestAutoHealthCheckDingTalk(c.Request.Context(), request.Webhook, request.Secret); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	resp.Success(c, nil)
}

func testProxy(c *gin.Context) {
	var request struct {
		ProxyURL string `json:"proxy_url"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	proxyURL := strings.TrimSpace(request.ProxyURL)
	if proxyURL == "" {
		resp.Error(c, http.StatusBadRequest, "代理地址不能为空")
		return
	}
	setting := model.Setting{Key: model.SettingKeyProxyURL, Value: proxyURL}
	if err := setting.Validate(); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	startedAt := time.Now()
	testCtx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()

	httpClient, err := client.GetHTTPClientCustomProxy(proxyURL)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	httpClient.Timeout = 12 * time.Second
	req, err := http.NewRequestWithContext(testCtx, http.MethodGet, "https://www.gstatic.com/generate_204", nil)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	res, err := httpClient.Do(req)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, "代理测试失败: "+err.Error())
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1024))

	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusBadRequest {
		resp.Error(c, http.StatusBadRequest, "代理测试失败: HTTP "+strconv.Itoa(res.StatusCode))
		return
	}

	resp.Success(c, gin.H{
		"status_code":  res.StatusCode,
		"elapsed_ms":   time.Since(startedAt).Milliseconds(),
		"test_url":     "https://www.gstatic.com/generate_204",
		"proxy_scheme": strings.SplitN(proxyURL, ":", 2)[0],
	})
}

type dbBackupRequest struct {
	IncludeLogs  bool                    `json:"include_logs"`
	IncludeStats bool                    `json:"include_stats"`
	Selection    model.DBBackupSelection `json:"selection"`
}

func exportDB(c *gin.Context) {
	var request dbBackupRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	dump, err := op.DBExportAll(c.Request.Context(), request.IncludeLogs, request.IncludeStats, &request.Selection)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=\"octopus-export-"+time.Now().Format("20060102150405")+".json\"")
	c.JSON(http.StatusOK, dump)
}

func previewExportDB(c *gin.Context) {
	dump, err := op.DBExportAll(c.Request.Context(), false, false, nil)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, buildDBImportPreview(dump))
}

func importDB(c *gin.Context) {
	var dump model.DBDump

	if err := readDBDumpFromRequest(c, &dump); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	selection := readDBBackupSelection(c)

	result, err := op.DBImportIncremental(c.Request.Context(), &dump, selection)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	_ = op.InitCache()

	resp.Success(c, result)
}

func previewImportDB(c *gin.Context) {
	var dump model.DBDump

	if err := readDBDumpFromRequest(c, &dump); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	resp.Success(c, buildDBImportPreview(&dump))
}

func readDBBackupSelection(c *gin.Context) *model.DBBackupSelection {
	raw := strings.TrimSpace(c.PostForm("selection"))
	if raw == "" {
		return nil
	}
	var selection model.DBBackupSelection
	if err := json.Unmarshal([]byte(raw), &selection); err != nil {
		return nil
	}
	return &selection
}
func readDBDumpFromRequest(c *gin.Context, dump *model.DBDump) error {
	contentType := c.GetHeader("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		fh, err := c.FormFile("file")
		if err != nil {
			return errors.New("missing upload file field 'file'")
		}
		f, err := fh.Open()
		if err != nil {
			return err
		}
		defer f.Close()
		body, err := io.ReadAll(f)
		if err != nil {
			return err
		}
		return decodeDBDump(body, dump)
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return err
	}
	return decodeDBDump(body, dump)
}

func buildDBImportPreview(dump *model.DBDump) model.DBImportPreview {
	preview := model.DBImportPreview{}
	if dump == nil {
		preview.Warnings = append(preview.Warnings, "导入文件为空")
		return preview
	}

	preview.Version = dump.Version
	preview.IncludeLogs = dump.IncludeLogs
	preview.IncludeStats = dump.IncludeStats

	preview.Channels = buildChannelSelectableItems(dump.Channels, dump.ChannelKeys)
	preview.Groups = buildGroupSelectableItems(dump.Groups, dump.GroupItems)
	preview.Settings = buildSettingSelectableItems(dump.Settings)
	addTable := func(table string, count int, action string, warning string) {
		if count <= 0 {
			return
		}
		preview.Tables = append(preview.Tables, model.DBImportPreviewTable{
			Table:   table,
			Count:   count,
			Action:  action,
			Warning: warning,
		})
		preview.TotalRows += count
		if warning != "" {
			preview.Warnings = append(preview.Warnings, warning)
		}
	}

	addTable("channels", len(dump.Channels), "insert_skip_existing", "")
	addTable("channel_keys", len(dump.ChannelKeys), "insert_skip_existing", "")
	if len(dump.ProxyConfigurations) > 0 {
		warning := "proxy_configurations 当前版本仅兼容识别，不会导入"
		addTable("proxy_configurations", len(dump.ProxyConfigurations), "skip_compatibility", warning)
		preview.SkippedTables = append(preview.SkippedTables, "proxy_configurations")
	}
	addTable("groups", len(dump.Groups), "insert_skip_existing", "")
	addTable("group_items", len(dump.GroupItems), "insert_skip_existing", "")
	addTable("api_keys", len(dump.APIKeys), "insert_skip_existing", "")
	addTable("settings", len(dump.Settings), "upsert_by_key", "settings 会覆盖同名配置，请确认后导入")

	if dump.IncludeStats {
		addTable("stats_total", len(dump.StatsTotal), "upsert", "")
		addTable("stats_daily", len(dump.StatsDaily), "upsert", "")
		addTable("stats_hourly", len(dump.StatsHourly), "upsert", "")
		addTable("stats_model", len(dump.StatsModel), "upsert", "")
		addTable("stats_channel", len(dump.StatsChannel), "upsert", "")
		addTable("stats_api_key", len(dump.StatsAPIKey), "upsert", "")
	}

	if dump.IncludeLogs {
		addTable("relay_logs", len(dump.RelayLogs), "insert_skip_existing", "")
	}

	return preview
}

func buildChannelSelectableItems(channels []model.Channel, keys []model.ChannelKey) []model.DBBackupSelectableItem {
	keyCount := make(map[int]int, len(channels))
	for _, key := range keys {
		keyCount[key.ChannelID]++
	}
	items := make([]model.DBBackupSelectableItem, 0, len(channels))
	for _, channel := range channels {
		items = append(items, model.DBBackupSelectableItem{
			ID:        channel.ID,
			Name:      channel.Name,
			SubCount:  keyCount[channel.ID],
			Secondary: strings.Join(append([]string{string(channel.Type)}, channelBaseURLStrings(channel.BaseUrls)...), " "),
		})
	}
	return items
}

func channelBaseURLStrings(baseURLs []model.BaseUrl) []string {
	values := make([]string, 0, len(baseURLs))
	for _, baseURL := range baseURLs {
		if strings.TrimSpace(baseURL.URL) != "" {
			values = append(values, baseURL.URL)
		}
	}
	return values
}
func buildGroupSelectableItems(groups []model.Group, groupItems []model.GroupItem) []model.DBBackupSelectableItem {
	itemCount := make(map[int]int, len(groups))
	for _, item := range groupItems {
		itemCount[item.GroupID]++
	}
	items := make([]model.DBBackupSelectableItem, 0, len(groups))
	for _, group := range groups {
		items = append(items, model.DBBackupSelectableItem{
			ID:        group.ID,
			Name:      group.Name,
			SubCount:  itemCount[group.ID],
			Secondary: string(group.Capability),
		})
	}
	return items
}

func buildSettingSelectableItems(settings []model.Setting) []model.DBBackupSelectableItem {
	items := make([]model.DBBackupSelectableItem, 0, len(settings))
	for _, setting := range settings {
		items = append(items, model.DBBackupSelectableItem{
			Key:       string(setting.Key),
			Name:      string(setting.Key),
			SubCount:  0,
			Secondary: setting.Value,
		})
	}
	return items
}
func decodeDBDump(body []byte, dump *model.DBDump) error {
	if dump == nil {
		return json.Unmarshal(body, &struct{}{})
	}

	if err := json.Unmarshal(body, dump); err != nil {
		return err
	}
	source := body

	if dump.Version == 0 &&
		len(dump.Channels) == 0 &&
		len(dump.Groups) == 0 &&
		len(dump.GroupItems) == 0 &&
		len(dump.Settings) == 0 &&
		len(dump.APIKeys) == 0 &&
		len(dump.RelayLogs) == 0 &&
		len(dump.StatsDaily) == 0 &&
		len(dump.StatsHourly) == 0 &&
		len(dump.StatsTotal) == 0 &&
		len(dump.StatsChannel) == 0 &&
		len(dump.StatsModel) == 0 &&
		len(dump.StatsAPIKey) == 0 {
		var wrapper struct {
			Code    int             `json:"code"`
			Message string          `json:"message"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(body, &wrapper); err == nil && len(wrapper.Data) > 0 {
			if err := json.Unmarshal(wrapper.Data, dump); err != nil {
				return err
			}
			return applyDBDumpImportDefaults(wrapper.Data, dump)
		}
	}

	return applyDBDumpImportDefaults(source, dump)
}

func applyDBDumpImportDefaults(body []byte, dump *model.DBDump) error {
	var raw struct {
		Channels []json.RawMessage `json:"channels"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return err
	}
	if len(raw.Channels) == 0 {
		return nil
	}
	for i, rawChannel := range raw.Channels {
		if i >= len(dump.Channels) {
			break
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(rawChannel, &fields); err != nil {
			return err
		}
		if _, ok := fields["rpm"]; !ok {
			dump.Channels[i].RPM = model.DefaultChannelRPM
		}
		if _, ok := fields["auto_group"]; !ok {
			dump.Channels[i].AutoGroup = model.DefaultChannelAutoGroup
		}
	}
	return nil
}
