package relay

import (
	"strings"

	"github.com/google/uuid"
)

// inboundContext 提供对入站请求头与查询参数的只读访问，便于占位符渲染与单元测试。
// *gin.Context 天然满足该接口（GetHeader / Query 均为其方法）。
type inboundContext interface {
	GetHeader(key string) string
	Query(key string) string
}

// renderHeaderValue 将 custom_header 的值模板按占位符语义渲染。
//
// 支持的占位符（{{ ... }} 包裹，可嵌套）：
//   - {{uuid}}        生成新 UUID（每次调用不同）
//   - {{inbound.header.NAME}}  透传入站请求头 NAME
//   - {{inbound.query.NAME}}    透传入站查询参数 NAME
//   - {{platform}} / {{sdk_package_version}} / {{runtime_version}}
//     运行环境元数据（octopus 未跟踪，恒为空，用于触发回退）
//
// 回退语法 {{A|B|C...}}：自左向右取首个渲染为非空串的备选；备选可为上述占位符、
// 嵌套占位符或字面量。例：
//   - {{inbound.header.session_id|{{uuid}}}}      优先透传入站 session_id，缺失则回退新 UUID
//   - {{inbound.header.anthropic-beta|}}          透传，缺失则空串（调用方可据此跳过该头）
//   - {{platform|unknown}}                        platform 为空时回退字面量 "unknown"
//
// 不含占位符的模板原样返回；未知变量名按字面量处理。
func renderHeaderValue(template string, ctx inboundContext) string {
	return render(template, ctx)
}

// render 递归渲染模板中的 {{...}} 占位符。
func render(s string, ctx inboundContext) string {
	var b strings.Builder
	i := 0
	n := len(s)
	for i < n {
		if i+1 < n && s[i] == '{' && s[i+1] == '{' {
			end := findPlaceholderEnd(s, i+2)
			if end < 0 {
				// 未闭合的 {{ ，原样输出剩余字符
				b.WriteString(s[i:])
				break
			}
			inner := s[i+2 : end]
			b.WriteString(resolvePlaceholder(inner, ctx))
			i = end + 2
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// findPlaceholderEnd 从 start 开始查找与起始 {{ 配对的 }}，支持嵌套占位符。
// 返回配对 }} 中第一个 } 的下标（即 s[end:end+2] == "}}"），未找到返回 -1。
func findPlaceholderEnd(s string, start int) int {
	depth := 1
	i := start
	n := len(s)
	for i < n {
		if i+1 < n && s[i] == '{' && s[i+1] == '{' {
			depth++
			i += 2
			continue
		}
		if i+1 < n && s[i] == '}' && s[i+1] == '}' {
			depth--
			if depth == 0 {
				return i
			}
			i += 2
			continue
		}
		i++
	}
	return -1
}

// resolvePlaceholder 解析占位符内部表达式（已去除外层 {{}}），按 | 拆分备选，取首个非空。
func resolvePlaceholder(inner string, ctx inboundContext) string {
	for _, alt := range splitTopLevel(inner) {
		val := resolveAlternative(strings.TrimSpace(alt), ctx)
		if val != "" {
			return val
		}
	}
	return ""
}

// splitTopLevel 按 | 拆分，但不拆分位于嵌套 {{...}} 内部的 |。
func splitTopLevel(s string) []string {
	var parts []string
	depth := 0
	start := 0
	i := 0
	n := len(s)
	for i < n {
		if i+1 < n && s[i] == '{' && s[i+1] == '{' {
			depth++
			i += 2
			continue
		}
		if i+1 < n && s[i] == '}' && s[i+1] == '}' {
			if depth > 0 {
				depth--
			}
			i += 2
			continue
		}
		if s[i] == '|' && depth == 0 {
			parts = append(parts, s[start:i])
			start = i + 1
			i++
			continue
		}
		i++
	}
	parts = append(parts, s[start:])
	return parts
}

// resolveAlternative 渲染单个备选：含占位符则递归渲染，否则按变量/字面量解析。
func resolveAlternative(alt string, ctx inboundContext) string {
	if strings.Contains(alt, "{{") {
		return render(alt, ctx)
	}
	return resolveVarOrLiteral(alt, ctx)
}

// resolveVarOrLiteral 解析裸变量名；未识别则按字面量返回。
func resolveVarOrLiteral(token string, ctx inboundContext) string {
	switch {
	case token == "uuid":
		return uuid.NewString()
	case strings.HasPrefix(token, "inbound.header."):
		return ctx.GetHeader(token[len("inbound.header."):])
	case strings.HasPrefix(token, "inbound.query."):
		return ctx.Query(token[len("inbound.query."):])
	case token == "platform" || token == "sdk_package_version" || token == "runtime_version":
		// octopus 未跟踪客户端运行环境元数据，恒为空，触发回退。
		return ""
	default:
		// 字面量（如 unknown）
		return token
	}
}
