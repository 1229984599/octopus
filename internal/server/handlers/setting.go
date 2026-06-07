package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/bestruirui/octopus/internal/task"
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
			router.NewRoute("/export", http.MethodGet).
				Handle(exportDB),
		).
		AddRoute(
			router.NewRoute("/import", http.MethodPost).
				Handle(importDB),
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

func exportDB(c *gin.Context) {
	includeLogs, _ := strconv.ParseBool(c.DefaultQuery("include_logs", "false"))
	includeStats, _ := strconv.ParseBool(c.DefaultQuery("include_stats", "false"))

	dump, err := op.DBExportAll(c.Request.Context(), includeLogs, includeStats)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=\"octopus-export-"+time.Now().Format("20060102150405")+".json\"")
	c.JSON(http.StatusOK, dump)
}

func importDB(c *gin.Context) {
	var dump model.DBDump

	contentType := c.GetHeader("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		fh, err := c.FormFile("file")
		if err != nil {
			resp.Error(c, http.StatusBadRequest, "missing upload file field 'file'")
			return
		}
		f, err := fh.Open()
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		defer f.Close()
		body, err := io.ReadAll(f)
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		if err := decodeDBDump(body, &dump); err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		if err := decodeDBDump(body, &dump); err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}

	result, err := op.DBImportIncremental(c.Request.Context(), &dump)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	_ = op.InitCache()

	resp.Success(c, result)
}

func decodeDBDump(body []byte, dump *model.DBDump) error {
	if dump == nil {
		return json.Unmarshal(body, &struct{}{})
	}

	if err := json.Unmarshal(body, dump); err != nil {
		return err
	}

	if dump.Version == 0 &&
		len(dump.Channels) == 0 &&
		len(dump.Groups) == 0 &&
		len(dump.GroupItems) == 0 &&
		len(dump.Settings) == 0 &&
		len(dump.APIKeys) == 0 &&
		len(dump.LLMInfos) == 0 &&
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
			return json.Unmarshal(wrapper.Data, dump)
		}
	}

	return nil
}
