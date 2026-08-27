package helper

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/1229984599/octopus/internal/client"
	"github.com/1229984599/octopus/internal/model"
	"github.com/1229984599/octopus/internal/op"
	"github.com/1229984599/octopus/internal/utils/log"
	"github.com/1229984599/octopus/internal/utils/xstrings"
	"github.com/dlclark/regexp2"
)

func ChannelHttpClient(channel *model.Channel) (*http.Client, error) {
	if channel == nil {
		return nil, errors.New("channel is nil")
	}
	if !channel.Proxy {
		return client.GetHTTPClientSystemProxy(false)
	} else if channel.ChannelProxy == nil || strings.TrimSpace(*channel.ChannelProxy) == "" {
		return client.GetHTTPClientSystemProxy(true)
	} else {
		return client.GetHTTPClientCustomProxy(strings.TrimSpace(*channel.ChannelProxy))
	}
}

func ChannelBaseUrlDelayUpdate(channel *model.Channel, ctx context.Context) {
	if channel == nil {
		return
	}
	newBaseUrls := make([]model.BaseUrl, 0, len(channel.BaseUrls))
	for _, baseUrl := range channel.BaseUrls {
		if baseUrl.URL == "" {
			continue
		}
		httpClient, err := ChannelHttpClient(channel)
		if err != nil {
			log.Warnf("failed to get http client (channel=%d): %v", channel.ID, err)
			continue
		}
		delay, err := GetUrlDelay(httpClient, baseUrl.URL, ctx)
		if err != nil {
			log.Warnf("failed to get url delay (channel=%d): %v", channel.ID, err)
			continue
		}
		newBaseUrls = append(newBaseUrls, model.BaseUrl{
			URL:   baseUrl.URL,
			Delay: delay,
		})
	}
	if len(newBaseUrls) > 0 {
		op.ChannelBaseUrlUpdate(channel.ID, newBaseUrls)
	}
}

func matchAutoGroupModels(autoGroup model.AutoGroupType, group model.Group, channelID int, channelModelNames []string, excludedKeys map[string]struct{}) []string {
	matchedModelNames := make([]string, 0, len(channelModelNames))
	appendIfAllowed := func(modelName string) {
		if _, excluded := excludedKeys[fmt.Sprintf("%d|%s", channelID, modelName)]; excluded {
			return
		}
		matchedModelNames = append(matchedModelNames, modelName)
	}

	switch autoGroup {
	case model.AutoGroupTypeExact:
		for _, modelName := range channelModelNames {
			if strings.EqualFold(modelName, group.Name) {
				appendIfAllowed(modelName)
			}
		}
	case model.AutoGroupTypeFuzzy:
		groupNameLower := strings.ToLower(strings.TrimSpace(group.Name))
		if groupNameLower == "" {
			return matchedModelNames
		}
		for _, modelName := range channelModelNames {
			if strings.Contains(strings.ToLower(modelName), groupNameLower) {
				appendIfAllowed(modelName)
			}
		}
	case model.AutoGroupTypeRegex:
		if group.MatchRegex == "" {
			for _, modelName := range channelModelNames {
				if strings.EqualFold(modelName, group.Name) {
					appendIfAllowed(modelName)
				}
			}
			return matchedModelNames
		}
		// IgnoreCase：模型名大小写因上游而异（MiniMax-M2.7 vs minimax-m2.7），
		// 分组正则按大小写敏感匹配会让这类渠道永远匹配不上分组。
		re, err := regexp2.Compile(group.MatchRegex, regexp2.ECMAScript|regexp2.IgnoreCase)
		if err != nil {
			log.Warnf("compile regex failed (channel=%d group=%d regex=%q): %v", channelID, group.ID, group.MatchRegex, err)
			return matchedModelNames
		}
		for _, modelName := range channelModelNames {
			matched, err := re.MatchString(modelName)
			if err != nil {
				log.Warnf("match regex failed (channel=%d group=%d regex=%q model=%q): %v", channelID, group.ID, group.MatchRegex, modelName, err)
				continue
			}
			if matched {
				appendIfAllowed(modelName)
			}
		}
	}
	return matchedModelNames
}
func ChannelAutoGroup(channel *model.Channel, ctx context.Context) {
	if channel == nil {
		return
	}
	if channel.AutoGroup == model.AutoGroupTypeNone {
		return
	}
	groups, err := op.GroupList(ctx)
	if err != nil {
		log.Warnf("get group list failed: %v", err)
		return
	}

	channelModelNames := xstrings.SplitTrimCompact(",", channel.Model, channel.CustomModel)
	if len(channelModelNames) == 0 {
		return
	}

	for _, group := range groups {
		excludedKeys, err := op.GroupAutoExcludedItemKeys(group.ID, ctx)
		if err != nil {
			log.Warnf("get group auto excluded items failed (channel=%d group=%d): %v", channel.ID, group.ID, err)
			continue
		}
		matchedModelNames := matchAutoGroupModels(channel.AutoGroup, group, channel.ID, channelModelNames, excludedKeys)
		if len(matchedModelNames) == 0 {
			continue
		}

		items := make([]model.GroupIDAndLLMName, 0, len(matchedModelNames))
		for _, modelName := range matchedModelNames {
			items = append(items, model.GroupIDAndLLMName{
				ChannelID: channel.ID,
				ModelName: modelName,
			})
		}
		if err := op.GroupItemBatchAdd(group.ID, items, ctx); err != nil {
			log.Warnf("group item batch add failed (channel=%d group=%d): %v", channel.ID, group.ID, err)
		}
	}
}
