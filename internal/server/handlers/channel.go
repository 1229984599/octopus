package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/1229984599/octopus/internal/helper"
	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/1229984599/octopus/internal/server/middleware"
	"github.com/1229984599/octopus/internal/server/resp"
	"github.com/1229984599/octopus/internal/server/router"
	"github.com/1229984599/octopus/internal/task"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/channel").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(listChannel),
		).
		AddRoute(
			router.NewRoute("/create", http.MethodPost).
				Handle(createChannel),
		).
		AddRoute(
			router.NewRoute("/update", http.MethodPost).
				Handle(updateChannel),
		).
		AddRoute(
			router.NewRoute("/enable", http.MethodPost).
				Handle(enableChannel),
		).
		AddRoute(
			router.NewRoute("/batch-delete", http.MethodPost).
				Handle(batchDeleteChannel),
		).
		AddRoute(
			router.NewRoute("/batch-update", http.MethodPost).
				Handle(batchUpdateChannel),
		).
		AddRoute(
			router.NewRoute("/delete/:id", http.MethodDelete).
				Handle(deleteChannel),
		).
		AddRoute(
			router.NewRoute("/fetch-model", http.MethodPost).
				Handle(fetchModel),
		).
		AddRoute(
			router.NewRoute("/check-keys", http.MethodPost).
				Handle(checkChannelKeys),
		)
	router.NewGroupRouter("/api/v1/channel").
		Use(middleware.Auth()).
		AddRoute(
			router.NewRoute("/sync", http.MethodPost).
				Handle(syncChannel),
		).
		AddRoute(
			router.NewRoute("/last-sync-time", http.MethodGet).
				Handle(getLastSyncTime),
		)
}

func listChannel(c *gin.Context) {
	channels, err := op.ChannelList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	for i, channel := range channels {
		stats := op.StatsChannelGet(channel.ID)
		channels[i].Stats = &stats
	}
	resp.Success(c, channels)
}

func createChannel(c *gin.Context) {
	var req model.ChannelCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	channel := req.Channel
	if err := op.ChannelCreate(&channel, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	stats := op.StatsChannelGet(channel.ID)
	channel.Stats = &stats
	go func(channel *model.Channel) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		modelStr := channel.Model + "," + channel.CustomModel
		modelArray := strings.Split(modelStr, ",")
		helper.LLMPriceAddToDB(modelArray, ctx)
		helper.ChannelBaseUrlDelayUpdate(channel, ctx)
		helper.ChannelAutoGroup(channel, ctx)
	}(&channel)
	resp.Success(c, channel)
}

func updateChannel(c *gin.Context) {
	var req model.ChannelUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	channel, err := op.ChannelUpdate(&req, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	stats := op.StatsChannelGet(channel.ID)
	channel.Stats = &stats
	go func(channel *model.Channel) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		modelStr := channel.Model + "," + channel.CustomModel
		modelArray := strings.Split(modelStr, ",")
		helper.LLMPriceAddToDB(modelArray, ctx)
		helper.ChannelBaseUrlDelayUpdate(channel, ctx)
		helper.ChannelAutoGroup(channel, ctx)
	}(channel)
	resp.Success(c, channel)
}

func enableChannel(c *gin.Context) {
	var request struct {
		ID      int  `json:"id"`
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	if err := op.ChannelEnabled(request.ID, request.Enabled, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func deleteChannel(c *gin.Context) {
	id := c.Param("id")
	idNum, err := strconv.Atoi(id)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidParam)
		return
	}
	if err := op.ChannelDel(idNum, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func batchDeleteChannel(c *gin.Context) {
	var req model.ChannelBatchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	ids, err := normalizeChannelIDs(req.IDs)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	for _, id := range ids {
		if err := op.ChannelDel(id, c.Request.Context()); err != nil {
			resp.Error(c, http.StatusInternalServerError, "delete channel "+strconv.Itoa(id)+": "+err.Error())
			return
		}
	}
	resp.Success(c, nil)
}

func batchUpdateChannel(c *gin.Context) {
	var req model.ChannelBatchUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	ids, err := normalizeChannelIDs(req.IDs)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if !channelBatchUpdateHasFields(&req) {
		resp.Error(c, http.StatusBadRequest, "missing fields to update")
		return
	}

	updated := make([]model.Channel, 0, len(ids))
	for _, id := range ids {
		updateReq := model.ChannelUpdateRequest{
			ID:        id,
			Enabled:   req.Enabled,
			Tags:      req.Tags,
			KeyMode:   req.KeyMode,
			RPM:       req.RPM,
			Proxy:     req.Proxy,
			AutoSync:  req.AutoSync,
			AutoCheck: req.AutoCheck,
			AutoGroup: req.AutoGroup,
		}
		channel, err := op.ChannelUpdate(&updateReq, c.Request.Context())
		if err != nil {
			resp.Error(c, http.StatusInternalServerError, "update channel "+strconv.Itoa(id)+": "+err.Error())
			return
		}
		stats := op.StatsChannelGet(channel.ID)
		channel.Stats = &stats
		updated = append(updated, *channel)
		go func(channel *model.Channel) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			modelStr := channel.Model + "," + channel.CustomModel
			modelArray := strings.Split(modelStr, ",")
			helper.LLMPriceAddToDB(modelArray, ctx)
			helper.ChannelBaseUrlDelayUpdate(channel, ctx)
			helper.ChannelAutoGroup(channel, ctx)
		}(channel)
	}
	resp.Success(c, updated)
}

func normalizeChannelIDs(ids []int) ([]int, error) {
	if len(ids) == 0 {
		return nil, errors.New("missing channel ids")
	}
	seen := make(map[int]struct{}, len(ids))
	result := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errors.New("invalid channel id")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

func channelBatchUpdateHasFields(req *model.ChannelBatchUpdateRequest) bool {
	return req.Enabled != nil ||
		req.Tags != nil ||
		req.KeyMode != nil ||
		req.RPM != nil ||
		req.Proxy != nil ||
		req.AutoSync != nil ||
		req.AutoCheck != nil ||
		req.AutoGroup != nil
}
func fetchModel(c *gin.Context) {
	var request model.Channel
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	models, err := helper.FetchModels(c.Request.Context(), request)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, models)
}

func checkChannelKeys(c *gin.Context) {
	var request struct {
		ID     int    `json:"id" binding:"required"`
		Model  string `json:"model" binding:"required"`
		KeyIDs []int  `json:"key_ids,omitempty"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, resp.ErrInvalidJSON)
		return
	}
	ctx := c.Request.Context()
	channel, err := op.ChannelGet(request.ID, ctx)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	results := helper.CheckChannelKeys(ctx, *channel, request.Model, request.KeyIDs)
	if err := op.ChannelKeySaveDBByIDs(ctx, channelKeyCheckResultIDs(results)); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if channelKeyCheckAnyOK(results) && !channel.Enabled {
		if err := op.ChannelEnabled(channel.ID, true, ctx); err != nil {
			resp.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := op.ChannelRefreshCacheByID(channel.ID, ctx); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, results)
}

func channelKeyCheckResultIDs(results []helper.ChannelKeyCheckResult) []int {
	ids := make([]int, 0, len(results))
	for _, result := range results {
		if result.ID != 0 {
			ids = append(ids, result.ID)
		}
	}
	return ids
}

func channelKeyCheckAnyOK(results []helper.ChannelKeyCheckResult) bool {
	for _, result := range results {
		if result.OK {
			return true
		}
	}
	return false
}

func syncChannel(c *gin.Context) {
	if err := task.RunNow(task.TaskSyncLLM); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}

func getLastSyncTime(c *gin.Context) {
	status, ok := task.GetStatus(task.TaskSyncLLM)
	if !ok {
		resp.Error(c, http.StatusNotFound, "task not found")
		return
	}
	resp.Success(c, status.LastRun)
}
