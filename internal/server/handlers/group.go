package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/1229984599/octopus/internal/helper"
	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/1229984599/octopus/internal/server/middleware"
	"github.com/1229984599/octopus/internal/server/resp"
	"github.com/1229984599/octopus/internal/server/router"
	"github.com/dlclark/regexp2"
	"github.com/gin-gonic/gin"
)

func init() {
	router.NewGroupRouter("/api/v1/group").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/list", http.MethodGet).
				Handle(getGroupList),
		).
		AddRoute(
			router.NewRoute("/create", http.MethodPost).
				Handle(createGroup),
		).
		AddRoute(
			router.NewRoute("/update", http.MethodPost).
				Handle(updateGroup),
		).
		AddRoute(
			router.NewRoute("/delete/:id", http.MethodDelete).
				Handle(deleteGroup),
		).
		AddRoute(
			router.NewRoute("/check-item", http.MethodPost).
				Handle(checkGroupItem),
		).
		AddRoute(
			router.NewRoute("/check-excluded-item", http.MethodPost).
				Handle(checkGroupExcludedItem),
		).
		AddRoute(
			router.NewRoute("/restore-excluded-item", http.MethodPost).
				Handle(restoreGroupExcludedItem),
		)
	// AddRoute(
	// 	router.NewRoute("/auto-add-item", http.MethodPost).
	// 		Handle(autoAddGroupItem),
	// )
}

func getGroupList(c *gin.Context) {
	groups, err := op.GroupList(c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, groups)
}

func createGroup(c *gin.Context) {
	var group model.Group
	if err := c.ShouldBindJSON(&group); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if group.MatchRegex != "" {
		_, err := regexp2.Compile(group.MatchRegex, regexp2.ECMAScript)
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := op.GroupCreate(&group, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, group)
}

func updateGroup(c *gin.Context) {
	var req model.GroupUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.MatchRegex != nil {
		_, err := regexp2.Compile(*req.MatchRegex, regexp2.ECMAScript)
		if err != nil {
			resp.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	group, err := op.GroupUpdate(&req, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, group)
}

func deleteGroup(c *gin.Context) {
	id := c.Param("id")
	idNum, err := strconv.Atoi(id)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.GroupDel(idNum, c.Request.Context()); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, "group deleted successfully")
}

func checkGroupItem(c *gin.Context) {
	var request struct {
		GroupID    int                   `json:"group_id" binding:"required"`
		ItemID     int                   `json:"item_id" binding:"required"`
		Model      string                `json:"model,omitempty"`
		Mode       string                `json:"mode,omitempty"`
		Capability model.GroupCapability `json:"capability,omitempty"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	ctx := c.Request.Context()
	group, err := op.GroupGet(request.GroupID, ctx)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	var item *model.GroupItem
	for i := range group.Items {
		if group.Items[i].ID == request.ItemID {
			item = &group.Items[i]
			break
		}
	}
	if item == nil {
		resp.Error(c, http.StatusNotFound, "group item not found")
		return
	}
	channel, err := op.ChannelGet(item.ChannelID, ctx)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	modelName := request.Model
	if modelName == "" {
		modelName = item.ModelName
	}
	checkChannel := activeCheckChannel(*channel)
	capability := group.Capability
	if request.Capability != "" {
		capability = request.Capability
	}
	results := helper.CheckChannelKeysWithOptions(ctx, checkChannel, modelName, nil, helper.CheckOptions{
		Mode:       helper.CheckMode(request.Mode),
		Capability: capability,
	})
	if err := op.ChannelKeySaveDBByIDs(ctx, channelKeyCheckResultIDs(results)); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok := channelKeyCheckAnyOK(results)
	if err := op.GroupItemSaveCheckResult(ctx, item.ID, ok, groupItemCheckResultMessage(results)); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if ok && !channel.Enabled {
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

func checkGroupExcludedItem(c *gin.Context) {
	var request struct {
		ExcludedItemID int                   `json:"excluded_item_id" binding:"required"`
		Mode           string                `json:"mode,omitempty"`
		Capability     model.GroupCapability `json:"capability,omitempty"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	ctx := c.Request.Context()
	excluded, err := op.GroupAutoExcludedItemGet(ctx, request.ExcludedItemID)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	group, err := op.GroupGet(excluded.GroupID, ctx)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	channel, err := op.ChannelGet(excluded.ChannelID, ctx)
	if err != nil {
		resp.Error(c, http.StatusNotFound, err.Error())
		return
	}
	checkChannel := activeCheckChannel(*channel)
	capability := group.Capability
	if request.Capability != "" {
		capability = request.Capability
	}
	results := helper.CheckChannelKeysWithOptions(ctx, checkChannel, excluded.ModelName, nil, helper.CheckOptions{
		Mode:       helper.CheckMode(request.Mode),
		Capability: capability,
	})
	if err := op.ChannelKeySaveDBByIDs(ctx, channelKeyCheckResultIDs(results)); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok := channelKeyCheckAnyOK(results)
	if err := op.GroupAutoExcludedItemSaveCheckResult(ctx, excluded, ok, groupItemCheckResultMessage(results)); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, results)
}

func restoreGroupExcludedItem(c *gin.Context) {
	var request struct {
		ExcludedItemID int `json:"excluded_item_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := op.GroupAutoExcludedItemRestore(c.Request.Context(), request.ExcludedItemID); err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	resp.Success(c, nil)
}
func activeCheckChannel(channel model.Channel) model.Channel {
	keys := make([]model.ChannelKey, 0, len(channel.Keys))
	for _, key := range channel.Keys {
		if !key.Enabled || strings.TrimSpace(key.ChannelKey) == "" {
			continue
		}
		keys = append(keys, key)
	}
	channel.Keys = keys
	return channel
}

// func autoAddGroupItem(c *gin.Context) {
// 	var req struct {
// 		ID int `json:"id"`
// 	}
// 	if err := c.ShouldBindJSON(&req); err != nil {
// 		resp.Error(c, http.StatusBadRequest, err.Error())
// 		return
// 	}
// 	if req.ID <= 0 {
// 		resp.Error(c, http.StatusBadRequest, "invalid id")
// 		return
// 	}
// 	err := worker.AutoAddGroupItem(req.ID, c.Request.Context())
// 	if err != nil {
// 		resp.Error(c, http.StatusInternalServerError, err.Error())
// 		return
// 	}
// 	resp.Success(c, nil)
// }

func groupItemCheckResultMessage(results []helper.ChannelKeyCheckResult) string {
	if len(results) == 0 {
		return "没有返回检测结果"
	}
	okCount := 0
	for _, result := range results {
		if result.OK {
			okCount++
		}
	}
	return fmt.Sprintf("正常 %d / 异常 %d / 总计 %d", okCount, len(results)-okCount, len(results))
}
