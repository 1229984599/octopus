package model

import "github.com/looplj/axonhub/llm"

func NormalizeGroupCapability(capability GroupCapability) GroupCapability {
	if capability == "" {
		return GroupCapabilityAuto
	}
	switch capability {
	case GroupCapabilityAuto,
		GroupCapabilityChat,
		GroupCapabilityResponsesCodex,
		GroupCapabilityEmbedding,
		GroupCapabilityImage:
		return capability
	case GroupCapabilityImageGeneration,
		GroupCapabilityImageEdit,
		GroupCapabilityImageVariation:
		return GroupCapabilityImage
	default:
		return GroupCapabilityAuto
	}
}

func RequestCapability(requestType llm.RequestType, inboundFormat llm.APIFormat) GroupCapability {
	switch requestType {
	case llm.RequestTypeEmbedding:
		return GroupCapabilityEmbedding
	case llm.RequestTypeImage:
		switch inboundFormat {
		case llm.APIFormatOpenAIImageEdit:
			return GroupCapabilityImage
		case llm.APIFormatOpenAIImageVariation:
			return GroupCapabilityImage
		default:
			return GroupCapabilityImage
		}
	default:
		if inboundFormat == llm.APIFormatOpenAIResponse {
			return GroupCapabilityResponsesCodex
		}
		return GroupCapabilityChat
	}
}

func GroupCapabilityCompatible(groupCapability, requestCapability GroupCapability) bool {
	groupCapability = NormalizeGroupCapability(groupCapability)
	requestCapability = NormalizeGroupCapability(requestCapability)
	if groupCapability == GroupCapabilityAuto {
		return true
	}
	if groupCapability == requestCapability {
		return true
	}
	if groupCapability == GroupCapabilityResponsesCodex && requestCapability == GroupCapabilityChat {
		return true
	}
	return false
}
