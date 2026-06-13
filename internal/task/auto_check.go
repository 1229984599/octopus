package task

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/1229984599/octopus/internal/helper"
	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/1229984599/octopus/internal/utils/log"
	"github.com/1229984599/octopus/internal/utils/xstrings"
)

const (
	autoHealthCheckTimeout            = 30 * time.Minute
	autoHealthCheckChannelConcurrency = 8
)

var (
	ErrAutoHealthCheckRunning    = errors.New("auto health check is already running")
	ErrAutoHealthCheckNotRunning = errors.New("auto health check is not running")

	autoHealthCheckMu      sync.Mutex
	autoHealthCheckRuntime = autoHealthCheckState{
		status: AutoHealthCheckStatus{
			Phase:   "idle",
			Message: "暂无检测任务",
		},
	}
)

type autoHealthCheckState struct {
	mu     sync.RWMutex
	status AutoHealthCheckStatus
	cancel context.CancelFunc
}

type AutoHealthCheckStatus struct {
	Running    bool                   `json:"running"`
	Canceling  bool                   `json:"canceling"`
	Trigger    string                 `json:"trigger"`
	Phase      string                 `json:"phase"`
	Message    string                 `json:"message"`
	Current    string                 `json:"current"`
	StartedAt  time.Time              `json:"started_at"`
	FinishedAt time.Time              `json:"finished_at"`
	Logs       []AutoHealthCheckLog   `json:"logs"`
	Summary    autoHealthCheckSummary `json:"summary"`
}

type AutoHealthCheckLog struct {
	Time    time.Time `json:"time"`
	Level   string    `json:"level"`
	Message string    `json:"message"`
	Detail  string    `json:"detail,omitempty"`
}

type autoHealthCheckSummary struct {
	StartedAt           time.Time `json:"started_at"`
	FinishedAt          time.Time `json:"finished_at"`
	CheckedChannels     int       `json:"checked_channels"`
	SkippedChannels     int       `json:"skipped_channels"`
	CheckedKeys         int       `json:"checked_keys"`
	DeletedKeys         int       `json:"deleted_keys"`
	DisabledKeys        int       `json:"disabled_keys"`
	DisabledChannels    int       `json:"disabled_channels"`
	CheckedGroups       int       `json:"checked_groups"`
	SkippedGroups       int       `json:"skipped_groups"`
	CheckedGroupItems   int       `json:"checked_group_items"`
	SkippedGroupItems   int       `json:"skipped_group_items"`
	DeletedGroupItems   int       `json:"deleted_group_items"`
	RecoveredGroupItems int       `json:"recovered_group_items"`
	RecoveryCheckItems  int       `json:"recovery_check_items"`
	DeletedKeyDetails   []string  `json:"deleted_key_details"`
	DisabledKeyDetails  []string  `json:"disabled_key_details"`
	DisabledDetails     []string  `json:"disabled_details"`
	DeletedItemDetails  []string  `json:"deleted_item_details"`
	Errors              []string  `json:"errors"`
}

func UpdateAutoHealthCheckTask() {
	cronSpec, err := op.SettingGetString(model.SettingKeyAutoCheckCron)
	if err != nil {
		log.Warnf("failed to get auto health check cron: %v", err)
		return
	}
	if err := UpdateCron(TaskAutoCheck, cronSpec); err != nil {
		log.Warnf("failed to update auto health check cron: %v", err)
	}
}

func AutoHealthCheckTask() {
	enabled, err := op.SettingGetBool(model.SettingKeyAutoCheckEnabled)
	if err != nil {
		log.Warnf("auto health check skipped: failed to get enabled setting: %v", err)
		return
	}
	if !enabled {
		return
	}
	if err := StartAutoHealthCheckTask("定时检测"); err != nil {
		log.Warnf("auto health check skipped: %v", err)
	}
}

func ManualAutoHealthCheckTask() {
	if err := StartAutoHealthCheckTask("手动检测"); err != nil {
		log.Warnf("manual auto health check skipped: %v", err)
	}
}

func StartAutoHealthCheckTask(trigger string) error {
	if !autoHealthCheckMu.TryLock() {
		return ErrAutoHealthCheckRunning
	}

	ctx, cancel := context.WithTimeout(context.Background(), autoHealthCheckTimeout)
	startAutoHealthCheckStatus(trigger, cancel)

	go runAutoHealthCheckWithNotify(ctx, cancel)
	return nil
}

func CancelAutoHealthCheckTask() error {
	autoHealthCheckRuntime.mu.Lock()
	defer autoHealthCheckRuntime.mu.Unlock()
	if !autoHealthCheckRuntime.status.Running || autoHealthCheckRuntime.cancel == nil {
		return ErrAutoHealthCheckNotRunning
	}
	autoHealthCheckRuntime.status.Canceling = true
	autoHealthCheckRuntime.status.Phase = "canceling"
	autoHealthCheckRuntime.status.Message = "正在取消检测任务..."
	autoHealthCheckRuntime.cancel()
	return nil
}

func GetAutoHealthCheckStatus() AutoHealthCheckStatus {
	autoHealthCheckRuntime.mu.RLock()
	defer autoHealthCheckRuntime.mu.RUnlock()
	status := autoHealthCheckRuntime.status
	status.Summary = cloneAutoHealthCheckSummary(status.Summary)
	status.Logs = append([]AutoHealthCheckLog(nil), status.Logs...)
	return status
}

func startAutoHealthCheckStatus(trigger string, cancel context.CancelFunc) {
	now := time.Now()
	autoHealthCheckRuntime.mu.Lock()
	defer autoHealthCheckRuntime.mu.Unlock()
	autoHealthCheckRuntime.cancel = cancel
	autoHealthCheckRuntime.status = AutoHealthCheckStatus{
		Running:   true,
		Trigger:   strings.TrimSpace(trigger),
		Phase:     "starting",
		Message:   "检测任务已启动",
		Current:   "",
		StartedAt: now,
		Logs: []AutoHealthCheckLog{{
			Time:    now,
			Level:   "info",
			Message: "检测任务已启动",
			Detail:  strings.TrimSpace(trigger),
		}},
		Summary: autoHealthCheckSummary{
			StartedAt: now,
		},
	}
	if autoHealthCheckRuntime.status.Trigger == "" {
		autoHealthCheckRuntime.status.Trigger = "自动检测"
	}
}

func updateAutoHealthCheckProgress(phase, message, current string, summary autoHealthCheckSummary) {
	autoHealthCheckRuntime.mu.Lock()
	defer autoHealthCheckRuntime.mu.Unlock()
	status := &autoHealthCheckRuntime.status
	status.Phase = phase
	status.Message = message
	status.Current = current
	status.Summary = cloneAutoHealthCheckSummary(summary)
	if !summary.StartedAt.IsZero() {
		status.StartedAt = summary.StartedAt
	}
	if !summary.FinishedAt.IsZero() {
		status.FinishedAt = summary.FinishedAt
	}
	status.Logs = appendLimitedAutoCheckLogs(status.Logs, AutoHealthCheckLog{
		Time:    time.Now(),
		Level:   logLevelForMessage(message),
		Message: message,
		Detail:  current,
	})
}

func finishAutoHealthCheckStatus(summary autoHealthCheckSummary, phase, message string) {
	autoHealthCheckRuntime.mu.Lock()
	defer autoHealthCheckRuntime.mu.Unlock()
	status := &autoHealthCheckRuntime.status
	status.Running = false
	status.Canceling = false
	status.Phase = phase
	status.Message = message
	status.Current = ""
	status.Summary = cloneAutoHealthCheckSummary(summary)
	status.StartedAt = summary.StartedAt
	status.FinishedAt = summary.FinishedAt
	status.Logs = appendLimitedAutoCheckLogs(status.Logs, AutoHealthCheckLog{
		Time:    time.Now(),
		Level:   logLevelForPhase(phase),
		Message: message,
	})
}

func cloneAutoHealthCheckSummary(summary autoHealthCheckSummary) autoHealthCheckSummary {
	summary.DeletedKeyDetails = append([]string(nil), summary.DeletedKeyDetails...)
	summary.DisabledKeyDetails = append([]string(nil), summary.DisabledKeyDetails...)
	summary.DisabledDetails = append([]string(nil), summary.DisabledDetails...)
	summary.DeletedItemDetails = append([]string(nil), summary.DeletedItemDetails...)
	summary.Errors = append([]string(nil), summary.Errors...)
	return summary
}

func appendAutoHealthCheckLog(level, message, detail string) {
	autoHealthCheckRuntime.mu.Lock()
	defer autoHealthCheckRuntime.mu.Unlock()
	autoHealthCheckRuntime.status.Logs = appendLimitedAutoCheckLogs(autoHealthCheckRuntime.status.Logs, AutoHealthCheckLog{
		Time:    time.Now(),
		Level:   level,
		Message: message,
		Detail:  detail,
	})
}

func appendLimitedAutoCheckLogs(logs []AutoHealthCheckLog, entry AutoHealthCheckLog) []AutoHealthCheckLog {
	const maxLogs = 500
	logs = append(logs, entry)
	if len(logs) <= maxLogs {
		return logs
	}
	return append([]AutoHealthCheckLog(nil), logs[len(logs)-maxLogs:]...)
}

func logLevelForPhase(phase string) string {
	switch phase {
	case "canceled":
		return "warn"
	default:
		return "info"
	}
}

func logLevelForMessage(message string) string {
	if strings.Contains(message, "异常") || strings.Contains(message, "失败") {
		return "error"
	}
	if strings.Contains(message, "跳过") || strings.Contains(message, "取消") || strings.Contains(message, "禁用") || strings.Contains(message, "删除") {
		return "warn"
	}
	return "info"
}

func TestAutoHealthCheckDingTalk(ctx context.Context, webhook string, secret string) error {
	webhook = strings.TrimSpace(webhook)
	if webhook == "" {
		savedWebhook, err := op.SettingGetString(model.SettingKeyAutoCheckDingTalkWebhook)
		if err != nil {
			return err
		}
		webhook = strings.TrimSpace(savedWebhook)
		if webhook == "" {
			return fmt.Errorf("dingtalk webhook is empty")
		}
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		savedSecret, err := op.SettingGetString(model.SettingKeyAutoCheckDingTalkSecret)
		if err != nil {
			return err
		}
		secret = strings.TrimSpace(savedSecret)
	}
	return sendDingTalkText(ctx, webhook, secret, "Octopus 自动检测钉钉机器人测试消息\n当前配置可用。")
}

func runAutoHealthCheckWithNotify(ctx context.Context, cancel context.CancelFunc) {
	defer func() {
		cancel()
		autoHealthCheckRuntime.mu.Lock()
		autoHealthCheckRuntime.cancel = nil
		autoHealthCheckRuntime.mu.Unlock()
		autoHealthCheckMu.Unlock()
	}()

	summary := runAutoHealthCheck(ctx)
	log.Infof("auto health check finished: channels=%d skipped_channels=%d keys=%d disabled_keys=%d disabled_channels=%d errors=%d",
		summary.CheckedChannels,
		summary.SkippedChannels,
		summary.CheckedKeys,
		summary.DisabledKeys,
		summary.DisabledChannels,
		len(summary.Errors),
	)

	if ctx.Err() != nil {
		finishAutoHealthCheckStatus(summary, "canceled", "检测任务已取消")
		return
	}

	updateAutoHealthCheckProgress("notifying", "正在发送钉钉通知...", "", summary)
	notifyCtx, notifyCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer notifyCancel()
	if err := sendAutoHealthCheckDingTalk(notifyCtx, summary); err != nil {
		log.Warnf("auto health check dingtalk notification failed: %v", err)
		summary.Errors = append(summary.Errors, fmt.Sprintf("send dingtalk notification: %v", err))
		appendAutoHealthCheckLog("error", "钉钉通知发送失败", err.Error())
	} else {
		appendAutoHealthCheckLog("info", "钉钉通知处理完成", "")
	}
	finishAutoHealthCheckStatus(summary, "finished", "检测任务已完成")
}

func runAutoHealthCheck(ctx context.Context) (summary autoHealthCheckSummary) {
	summary = autoHealthCheckSummary{StartedAt: time.Now()}
	defer func() {
		summary.FinishedAt = time.Now()
		updateAutoHealthCheckProgress("finishing", "正在整理检测结果...", "", summary)
	}()

	updateAutoHealthCheckProgress("loading_channels", "正在读取渠道列表...", "", summary)
	channels, err := op.ChannelList(ctx)
	if err != nil {
		summary.Errors = append(summary.Errors, fmt.Sprintf("list channels: %v", err))
		return summary
	}
	sort.Slice(channels, func(i, j int) bool { return channels[i].ID < channels[j].ID })

	workerCount := minInt(autoHealthCheckChannelConcurrency, len(channels))
	if workerCount <= 0 {
		return
	}

	jobs := make(chan model.Channel)
	results := make(chan autoHealthCheckSummary, len(channels))
	var wg sync.WaitGroup
	startedAt := summary.StartedAt

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for channel := range jobs {
				localSummary := autoHealthCheckSummary{StartedAt: startedAt}
				if ctx.Err() != nil {
					localSummary.Errors = append(localSummary.Errors, ctx.Err().Error())
					results <- localSummary
					continue
				}
				checkChannelKeys(ctx, channel, &localSummary)
				results <- localSummary
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, channel := range channels {
			select {
			case <-ctx.Done():
				return
			case jobs <- channel:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	for delta := range results {
		mergeAutoHealthCheckSummary(&summary, delta)
		current := fmt.Sprintf("%d/%d", summary.CheckedChannels+summary.SkippedChannels, len(channels))
		updateAutoHealthCheckProgress("checking_channel", "渠道 Key 检测进度已更新", current, summary)
	}

	if ctx.Err() == nil {
		checkRecoverableGroupItems(ctx, &summary)
	}

	if ctx.Err() != nil {
		summary.Errors = append(summary.Errors, ctx.Err().Error())
	}

	return
}

func checkRecoverableGroupItems(ctx context.Context, summary *autoHealthCheckSummary) {
	updateAutoHealthCheckProgress("checking_group_recovery", "正在检测可恢复的分组模型...", "", *summary)
	excludedItems, err := op.GroupAutoExcludedItemsDue(ctx, time.Now(), 100)
	if err != nil {
		errText := fmt.Sprintf("list recoverable group items: %v", err)
		summary.Errors = append(summary.Errors, errText)
		appendAutoHealthCheckLog("error", "读取可恢复分组模型失败", errText)
		return
	}
	if len(excludedItems) == 0 {
		return
	}
	for _, excluded := range excludedItems {
		if ctx.Err() != nil {
			summary.Errors = append(summary.Errors, ctx.Err().Error())
			return
		}
		current := fmt.Sprintf("分组 %d / %s / 渠道 %d", excluded.GroupID, excluded.ModelName, excluded.ChannelID)
		updateAutoHealthCheckProgress("checking_group_recovery", "正在探测可恢复的分组模型...", current, *summary)
		channel, err := op.ChannelGet(excluded.ChannelID, ctx)
		if err != nil {
			if recErr := op.GroupAutoExcludedItemRecordCheck(ctx, excluded, false, err.Error()); recErr != nil {
				summary.Errors = append(summary.Errors, fmt.Sprintf("record recovery failure for excluded item %d: %v", excluded.ID, recErr))
			}
			appendAutoHealthCheckLog("warn", "分组模型恢复探测跳过", fmt.Sprintf("%s\n错误: %v", current, err))
			continue
		}
		if !channel.AutoCheck || !channel.Enabled {
			message := "渠道未启用自动检测或已禁用"
			if recErr := op.GroupAutoExcludedItemRecordCheck(ctx, excluded, false, message); recErr != nil {
				summary.Errors = append(summary.Errors, fmt.Sprintf("record recovery skip for excluded item %d: %v", excluded.ID, recErr))
			}
			appendAutoHealthCheckLog("warn", "分组模型恢复探测跳过", current+"\n"+message)
			continue
		}
		checkChannel := activeKeyChannel(*channel)
		if len(checkChannel.Keys) == 0 {
			message := "渠道没有可用 Key"
			if recErr := op.GroupAutoExcludedItemRecordCheck(ctx, excluded, false, message); recErr != nil {
				summary.Errors = append(summary.Errors, fmt.Sprintf("record recovery no-key for excluded item %d: %v", excluded.ID, recErr))
			}
			appendAutoHealthCheckLog("warn", "分组模型恢复探测跳过", current+"\n"+message)
			continue
		}
		keyLabels := channelKeyLabels(checkChannel.Keys)
		results := helper.CheckChannelKeys(ctx, checkChannel, excluded.ModelName, nil)
		summary.RecoveryCheckItems++
		summary.CheckedKeys += len(results)
		ok := anyResultOK(results)
		message := checkResultSummary(results)
		if err := op.GroupAutoExcludedItemRecordCheck(ctx, excluded, ok, message); err != nil {
			errText := fmt.Sprintf("record recovery check for excluded item %d: %v", excluded.ID, err)
			summary.Errors = append(summary.Errors, errText)
			appendAutoHealthCheckLog("error", "保存分组模型恢复探测结果失败", errText)
			continue
		}
		if ok {
			summary.RecoveredGroupItems++
			appendAutoHealthCheckLog("info", "分组模型已恢复", strings.Join([]string{current, "模型: " + excluded.ModelName, checkResultsDetail(results, keyLabels)}, "\n"))
			continue
		}
		appendAutoHealthCheckLog("warn", "分组模型恢复探测未通过", strings.Join([]string{current, "模型: " + excluded.ModelName, checkResultsDetail(results, keyLabels)}, "\n"))
	}
}
func mergeAutoHealthCheckSummary(summary *autoHealthCheckSummary, delta autoHealthCheckSummary) {
	summary.CheckedChannels += delta.CheckedChannels
	summary.SkippedChannels += delta.SkippedChannels
	summary.CheckedKeys += delta.CheckedKeys
	summary.DeletedKeys += delta.DeletedKeys
	summary.DisabledKeys += delta.DisabledKeys
	summary.DisabledChannels += delta.DisabledChannels
	summary.CheckedGroups += delta.CheckedGroups
	summary.SkippedGroups += delta.SkippedGroups
	summary.CheckedGroupItems += delta.CheckedGroupItems
	summary.SkippedGroupItems += delta.SkippedGroupItems
	summary.DeletedGroupItems += delta.DeletedGroupItems
	summary.RecoveredGroupItems += delta.RecoveredGroupItems
	summary.RecoveryCheckItems += delta.RecoveryCheckItems
	summary.DeletedKeyDetails = append(summary.DeletedKeyDetails, delta.DeletedKeyDetails...)
	summary.DisabledKeyDetails = append(summary.DisabledKeyDetails, delta.DisabledKeyDetails...)
	summary.DisabledDetails = append(summary.DisabledDetails, delta.DisabledDetails...)
	summary.DeletedItemDetails = append(summary.DeletedItemDetails, delta.DeletedItemDetails...)
	summary.Errors = append(summary.Errors, delta.Errors...)
}

func checkChannelKeys(ctx context.Context, channel model.Channel, summary *autoHealthCheckSummary) {
	current := fmt.Sprintf("%s(%d)", channel.Name, channel.ID)
	updateAutoHealthCheckProgress("checking_channel", "正在检测渠道 Key...", current, *summary)
	if !channel.AutoCheck {
		summary.SkippedChannels++
		updateAutoHealthCheckProgress("checking_channel", "渠道未启用自动检测，已跳过", current, *summary)
		return
	}
	channel = activeKeyChannel(channel)
	if len(channel.Keys) == 0 {
		summary.SkippedChannels++
		updateAutoHealthCheckProgress("checking_channel", "渠道没有可用 Key，已跳过", current, *summary)
		return
	}

	modelName := defaultCheckModel(channel)
	if modelName == "" {
		summary.SkippedChannels++
		updateAutoHealthCheckProgress("checking_channel", "渠道没有可检测模型，已跳过", current, *summary)
		return
	}

	updateAutoHealthCheckProgress("checking_channel", fmt.Sprintf("正在使用模型 %s 检测渠道 Key...", modelName), current, *summary)
	keyLabels := channelKeyLabels(channel.Keys)
	results := helper.CheckChannelKeys(ctx, channel, modelName, nil)
	summary.CheckedChannels++
	summary.CheckedKeys += len(results)
	if err := op.ChannelKeySaveDBByIDs(ctx, checkResultKeyIDs(results)); err != nil {
		errText := fmt.Sprintf("save channel %d key status after check: %v", channel.ID, err)
		summary.Errors = append(summary.Errors, errText)
		appendAutoHealthCheckLog("error", "保存渠道 Key 状态失败", errText)
	} else if err := op.ChannelRefreshCacheByID(channel.ID, ctx); err != nil {
		errText := fmt.Sprintf("refresh channel %d after key status save: %v", channel.ID, err)
		summary.Errors = append(summary.Errors, errText)
		appendAutoHealthCheckLog("error", "刷新渠道 Key 状态失败", errText)
	}
	if anyResultOK(results) {
		enableChannel(ctx, channel, fmt.Sprintf("渠道 Key 检测通过（%s）", checkResultSummary(results)), summary)
		channel.Enabled = true
	}
	if ctx.Err() != nil {
		summary.Errors = append(summary.Errors, ctx.Err().Error())
		updateAutoHealthCheckProgress("checking_channel", "检测任务已取消", current, *summary)
		return
	}
	appendAutoHealthCheckLog(
		logLevelForCheckResults(results),
		fmt.Sprintf("渠道 Key 检测结果：%s", checkResultSummary(results)),
		strings.Join([]string{current, "模型: " + modelName, checkResultsDetail(results, keyLabels)}, "\n"),
	)

	invalidKeyIDs := invalidKeyIDs(results)
	if len(invalidKeyIDs) > 0 {
		if err := op.ChannelKeysEnabled(channel.ID, invalidKeyIDs, false, ctx); err != nil {
			errText := fmt.Sprintf("disable channel %d keys: %v", channel.ID, err)
			summary.Errors = append(summary.Errors, errText)
			appendAutoHealthCheckLog("error", "禁用失效 Key 失败", errText)
		} else {
			summary.DisabledKeys += len(invalidKeyIDs)
			summary.DisabledKeyDetails = append(summary.DisabledKeyDetails,
				fmt.Sprintf("%s(%d): %d key(s)", channel.Name, channel.ID, len(invalidKeyIDs)))
			appendAutoHealthCheckLog(
				"warn",
				fmt.Sprintf("已禁用 %d 个失效 Key", len(invalidKeyIDs)),
				strings.Join(append([]string{current}, invalidKeyDetails(results, keyLabels)...), "\n"),
			)
		}
	}

	if shouldDisableChannel(channel, results) {
		disableChannel(ctx, channel, fmt.Sprintf("渠道 Key 检测出现临时失败（%s）", checkResultSummary(results)), summary)
	}
	updateAutoHealthCheckProgress("checking_channel", "渠道 Key 检测完成", current, *summary)
}

func checkGroupItems(ctx context.Context, group model.Group, summary *autoHealthCheckSummary) {
	currentGroup := fmt.Sprintf("%s(%d)", group.Name, group.ID)
	updateAutoHealthCheckProgress("checking_group", "正在检测分组渠道...", currentGroup, *summary)
	if !group.AutoCheck {
		summary.SkippedGroups++
		updateAutoHealthCheckProgress("checking_group", "分组未启用自动检测，已跳过", currentGroup, *summary)
		return
	}
	summary.CheckedGroups++

	items := append([]model.GroupItem(nil), group.Items...)
	sort.Slice(items, func(i, j int) bool {
		left := items[i].Priority
		right := items[j].Priority
		if left == right {
			return items[i].ID < items[j].ID
		}
		return left < right
	})

	for _, item := range items {
		if ctx.Err() != nil {
			summary.Errors = append(summary.Errors, ctx.Err().Error())
			return
		}
		currentItem := fmt.Sprintf("%s(%d) / %s / 渠道 %d", group.Name, group.ID, item.ModelName, item.ChannelID)
		updateAutoHealthCheckProgress("checking_group_item", "正在检测分组渠道...", currentItem, *summary)
		if item.ID == 0 {
			summary.SkippedGroupItems++
			updateAutoHealthCheckProgress("checking_group_item", "分组渠道数据不完整，已跳过", currentItem, *summary)
			continue
		}
		channel, err := op.ChannelGet(item.ChannelID, ctx)
		if err != nil {
			summary.DeletedItemDetails = append(summary.DeletedItemDetails,
				fmt.Sprintf("%s(%d): missing channel %d，需要手动处理", group.Name, group.ID, item.ChannelID))
			appendAutoHealthCheckLog("warn", "分组渠道不存在，请手动处理", fmt.Sprintf("%s\n错误: %v", currentItem, err))
			updateAutoHealthCheckProgress("checking_group_item", "分组渠道不存在，请手动处理", currentItem, *summary)
			continue
		}
		if !channel.AutoCheck {
			summary.SkippedGroupItems++
			updateAutoHealthCheckProgress("checking_group_item", "渠道未启用自动检测，已跳过", currentItem, *summary)
			continue
		}
		if !channel.Enabled {
			summary.SkippedGroupItems++
			updateAutoHealthCheckProgress("checking_group_item", "渠道已禁用，已跳过", currentItem, *summary)
			continue
		}
		if strings.TrimSpace(item.ModelName) == "" {
			summary.SkippedGroupItems++
			updateAutoHealthCheckProgress("checking_group_item", "分组渠道未配置模型，已跳过", currentItem, *summary)
			continue
		}
		checkChannel := activeKeyChannel(*channel)
		if len(checkChannel.Keys) == 0 {
			summary.DeletedItemDetails = append(summary.DeletedItemDetails,
				fmt.Sprintf("%s(%d): %s via %s(%d) has no active keys，需要手动处理", group.Name, group.ID, item.ModelName, channel.Name, channel.ID))
			appendAutoHealthCheckLog("warn", "渠道没有可用 Key，请手动处理分组渠道", currentItem)
			updateAutoHealthCheckProgress("checking_group_item", "渠道没有可用 Key，请手动处理分组渠道", currentItem, *summary)
			continue
		}

		currentItem = fmt.Sprintf("%s(%d) / %s / %s(%d)", group.Name, group.ID, item.ModelName, channel.Name, channel.ID)
		updateAutoHealthCheckProgress("checking_group_item", "正在使用分组模型检测渠道 Key...", currentItem, *summary)
		keyLabels := channelKeyLabels(checkChannel.Keys)
		results := helper.CheckChannelKeys(ctx, checkChannel, item.ModelName, nil)
		summary.CheckedGroupItems++
		summary.CheckedKeys += len(results)
		if ctx.Err() != nil {
			summary.Errors = append(summary.Errors, ctx.Err().Error())
			updateAutoHealthCheckProgress("checking_group_item", "检测任务已取消", currentItem, *summary)
			return
		}
		appendAutoHealthCheckLog(
			logLevelForCheckResults(results),
			fmt.Sprintf("分组渠道检测结果：%s", checkResultSummary(results)),
			strings.Join([]string{currentItem, "模型: " + item.ModelName, checkResultsDetail(results, keyLabels)}, "\n"),
		)

		invalidKeyIDs := invalidKeyIDs(results)
		if len(invalidKeyIDs) > 0 {
			if err := op.ChannelKeysEnabled(channel.ID, invalidKeyIDs, false, ctx); err != nil {
				errText := fmt.Sprintf("disable channel %d keys from group %d check: %v", channel.ID, group.ID, err)
				summary.Errors = append(summary.Errors, errText)
				appendAutoHealthCheckLog("error", "禁用分组检测中的失效 Key 失败", errText)
			} else {
				summary.DisabledKeys += len(invalidKeyIDs)
				summary.DisabledKeyDetails = append(summary.DisabledKeyDetails,
					fmt.Sprintf("%s(%d) via %s/%s: %d key(s)", channel.Name, channel.ID, group.Name, item.ModelName, len(invalidKeyIDs)))
				appendAutoHealthCheckLog(
					"warn",
					fmt.Sprintf("已禁用分组检测中的 %d 个失效 Key", len(invalidKeyIDs)),
					strings.Join(append([]string{currentItem}, invalidKeyDetails(results, keyLabels)...), "\n"),
				)
			}
		}

		if anyResultOK(results) {
			updateAutoHealthCheckProgress("checking_group_item", "分组渠道检测通过", currentItem, *summary)
			continue
		}
		if hasTemporaryChannelFailure(results) {
			disableChannel(ctx, *channel, fmt.Sprintf("分组 %s 模型 %s 检测出现临时失败（%s）", group.Name, item.ModelName, checkResultSummary(results)), summary)
			updateAutoHealthCheckProgress("checking_group_item", "渠道临时失败，已禁用渠道", currentItem, *summary)
			continue
		}

		summary.DeletedItemDetails = append(summary.DeletedItemDetails,
			fmt.Sprintf("%s(%d): %s via %s(%d)，需要手动处理", group.Name, group.ID, item.ModelName, channel.Name, channel.ID))
		appendAutoHealthCheckLog("warn", "分组渠道不可用，请手动处理", strings.Join([]string{currentItem, checkResultsDetail(results, keyLabels)}, "\n"))
		updateAutoHealthCheckProgress("checking_group_item", "分组渠道不可用，请手动处理", currentItem, *summary)
	}
	updateAutoHealthCheckProgress("checking_group", "分组渠道检测完成", currentGroup, *summary)
}

func channelKeyLabels(keys []model.ChannelKey) map[int]string {
	labels := make(map[int]string, len(keys))
	for _, key := range keys {
		labels[key.ID] = channelKeyLabel(key)
	}
	return labels
}

func checkResultKeyIDs(results []helper.ChannelKeyCheckResult) []int {
	ids := make([]int, 0, len(results))
	for _, result := range results {
		if result.ID != 0 {
			ids = append(ids, result.ID)
		}
	}
	return ids
}

func channelKeyLabel(key model.ChannelKey) string {
	parts := []string{fmt.Sprintf("Key #%d", key.ID)}
	if remark := strings.TrimSpace(key.Remark); remark != "" {
		parts = append(parts, "备注: "+remark)
	}
	if masked := maskSecret(key.ChannelKey); masked != "" {
		parts = append(parts, "值: "+masked)
	}
	return strings.Join(parts, ", ")
}

func maskSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= 8 {
		return strings.Repeat("*", len(runes))
	}
	return string(runes[:4]) + "..." + string(runes[len(runes)-4:])
}

func checkResultSummary(results []helper.ChannelKeyCheckResult) string {
	okCount := 0
	for _, result := range results {
		if result.OK {
			okCount++
		}
	}
	return fmt.Sprintf("正常 %d / 异常 %d / 总计 %d", okCount, len(results)-okCount, len(results))
}

func logLevelForCheckResults(results []helper.ChannelKeyCheckResult) string {
	if len(results) == 0 {
		return "warn"
	}
	for _, result := range results {
		if !result.OK {
			return "warn"
		}
	}
	return "info"
}

func checkResultsDetail(results []helper.ChannelKeyCheckResult, labels map[int]string) string {
	if len(results) == 0 {
		return "没有返回检测结果"
	}
	const maxLines = 20
	lines := make([]string, 0, minInt(len(results), maxLines)+1)
	for i, result := range results {
		if i >= maxLines {
			lines = append(lines, fmt.Sprintf("还有 %d 个结果未显示", len(results)-maxLines))
			break
		}
		lines = append(lines, checkResultDetail(result, labels))
	}
	return strings.Join(lines, "\n")
}

func invalidKeyDetails(results []helper.ChannelKeyCheckResult, labels map[int]string) []string {
	details := make([]string, 0)
	for _, result := range results {
		if result.StatusCode == http.StatusUnauthorized || result.StatusCode == http.StatusForbidden {
			details = append(details, checkResultDetail(result, labels))
		}
	}
	return details
}

func checkResultDetail(result helper.ChannelKeyCheckResult, labels map[int]string) string {
	label := labels[result.ID]
	if label == "" {
		label = fmt.Sprintf("Key #%d", result.ID)
	}
	status := "无 HTTP 状态"
	if result.StatusCode > 0 {
		status = fmt.Sprintf("HTTP %d", result.StatusCode)
	}
	if result.Error != "" {
		status += " - " + result.Error
	}
	if result.OK {
		status += "，正常"
	} else {
		status += "，异常"
	}
	return fmt.Sprintf("%s: %s", label, status)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func activeKeyChannel(channel model.Channel) model.Channel {
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

func defaultCheckModel(channel model.Channel) string {
	if checkModel := strings.TrimSpace(channel.CheckModel); checkModel != "" {
		return checkModel
	}
	models := xstrings.SplitTrimCompact(",", channel.Model, channel.CustomModel)
	if len(models) == 0 {
		return ""
	}
	return models[0]
}

func anyResultOK(results []helper.ChannelKeyCheckResult) bool {
	for _, result := range results {
		if result.OK {
			return true
		}
	}
	return false
}

func invalidKeyIDs(results []helper.ChannelKeyCheckResult) []int {
	ids := make([]int, 0)
	for _, result := range results {
		if result.ID == 0 {
			continue
		}
		if result.StatusCode == http.StatusUnauthorized || result.StatusCode == http.StatusForbidden {
			ids = append(ids, result.ID)
		}
	}
	return ids
}

func hasTemporaryChannelFailure(results []helper.ChannelKeyCheckResult) bool {
	for _, result := range results {
		if result.StatusCode == 0 || result.StatusCode >= http.StatusInternalServerError {
			return true
		}
	}
	return false
}

func shouldDisableChannel(channel model.Channel, results []helper.ChannelKeyCheckResult) bool {
	return channel.Enabled && len(results) > 0 && !anyResultOK(results) && hasTemporaryChannelFailure(results)
}

func enableChannel(ctx context.Context, channel model.Channel, reason string, summary *autoHealthCheckSummary) {
	if channel.Enabled {
		return
	}
	if err := op.ChannelEnabled(channel.ID, true, ctx); err != nil {
		errText := fmt.Sprintf("enable channel %d: %v", channel.ID, err)
		summary.Errors = append(summary.Errors, errText)
		appendAutoHealthCheckLog("error", "启用渠道失败", errText)
		return
	}
	appendAutoHealthCheckLog("info", "检测通过，已启用渠道", fmt.Sprintf("%s(%d)\n原因: %s", channel.Name, channel.ID, reason))
}

func disableChannel(ctx context.Context, channel model.Channel, reason string, summary *autoHealthCheckSummary) {
	if !channel.Enabled {
		return
	}
	if err := op.ChannelEnabled(channel.ID, false, ctx); err != nil {
		errText := fmt.Sprintf("disable channel %d: %v", channel.ID, err)
		summary.Errors = append(summary.Errors, errText)
		appendAutoHealthCheckLog("error", "禁用渠道失败", errText)
		return
	}
	summary.DisabledChannels++
	summary.DisabledDetails = append(summary.DisabledDetails, fmt.Sprintf("%s(%d): %s", channel.Name, channel.ID, reason))
	appendAutoHealthCheckLog("warn", "已临时禁用渠道", fmt.Sprintf("%s(%d)\n原因: %s", channel.Name, channel.ID, reason))
}

func sendAutoHealthCheckDingTalk(ctx context.Context, summary autoHealthCheckSummary) error {
	return sendDingTalkTextFromSetting(ctx, summary.dingTalkContent())
}

func sendDingTalkTextFromSetting(ctx context.Context, content string) error {
	webhook, err := op.SettingGetString(model.SettingKeyAutoCheckDingTalkWebhook)
	if err != nil {
		return err
	}
	webhook = strings.TrimSpace(webhook)
	if webhook == "" {
		return nil
	}
	secret, err := op.SettingGetString(model.SettingKeyAutoCheckDingTalkSecret)
	if err != nil {
		return err
	}
	return sendDingTalkText(ctx, webhook, secret, content)
}

func sendDingTalkText(ctx context.Context, webhook string, secret string, content string) error {
	signedWebhook, err := signDingTalkWebhook(webhook, secret)
	if err != nil {
		return err
	}

	payload, err := json.Marshal(map[string]any{
		"msgtype": "text",
		"text": map[string]string{
			"content": content,
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, signedWebhook, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dingtalk webhook returned %s: %s", resp.Status, string(body))
	}

	var dingResp struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if len(body) > 0 && json.Unmarshal(body, &dingResp) == nil && dingResp.ErrCode != 0 {
		return fmt.Errorf("dingtalk webhook returned errcode=%d errmsg=%s", dingResp.ErrCode, dingResp.ErrMsg)
	}
	return nil
}

func signDingTalkWebhook(webhook string, secret string) (string, error) {
	webhook = strings.TrimSpace(webhook)
	secret = strings.TrimSpace(secret)
	if webhook == "" || secret == "" {
		return webhook, nil
	}

	parsedURL, err := url.Parse(webhook)
	if err != nil {
		return "", err
	}

	timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
	stringToSign := timestamp + "\n" + secret
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(stringToSign)); err != nil {
		return "", err
	}
	sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	query := parsedURL.Query()
	query.Set("timestamp", timestamp)
	query.Set("sign", sign)
	parsedURL.RawQuery = query.Encode()
	return parsedURL.String(), nil
}

func (s autoHealthCheckSummary) dingTalkContent() string {
	var b strings.Builder
	b.WriteString("Octopus 自动检测完成\n")
	b.WriteString(fmt.Sprintf("开始: %s\n", s.StartedAt.Format("2006-01-02 15:04:05")))
	if !s.FinishedAt.IsZero() {
		b.WriteString(fmt.Sprintf("耗时: %s\n", s.FinishedAt.Sub(s.StartedAt).Round(time.Second)))
	}
	b.WriteString(fmt.Sprintf("渠道: 检测 %d, 跳过 %d, 禁用 %d\n", s.CheckedChannels, s.SkippedChannels, s.DisabledChannels))
	b.WriteString(fmt.Sprintf("Key: 检测 %d, 禁用 %d\n", s.CheckedKeys, s.DisabledKeys))
	if s.RecoveryCheckItems > 0 || s.RecoveredGroupItems > 0 {
		b.WriteString(fmt.Sprintf("恢复探测: 检测 %d, 恢复 %d\n", s.RecoveryCheckItems, s.RecoveredGroupItems))
	}
	if len(s.DisabledDetails) > 0 {
		appendLimitedLines(&b, "禁用渠道", s.DisabledDetails)
	}
	if len(s.DisabledKeyDetails) > 0 {
		appendLimitedLines(&b, "禁用 Key", s.DisabledKeyDetails)
	}
	if len(s.Errors) > 0 {
		appendLimitedLines(&b, "异常", s.Errors)
	}
	content := b.String()
	if len([]rune(content)) <= 3500 {
		return content
	}
	runes := []rune(content)
	return string(runes[:3500]) + "\n...(已截断)"
}

func appendLimitedLines(b *strings.Builder, title string, lines []string) {
	b.WriteString(title)
	b.WriteString(":\n")
	limit := 10
	if len(lines) < limit {
		limit = len(lines)
	}
	for i := 0; i < limit; i++ {
		b.WriteString("- ")
		b.WriteString(lines[i])
		b.WriteByte('\n')
	}
	if len(lines) > limit {
		b.WriteString(fmt.Sprintf("- 还有 %d 条\n", len(lines)-limit))
	}
}
