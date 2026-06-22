import type { CustomHeader } from '@/api/endpoints/channel';

/**
 * 伪装预设：选中后将预设头一次性填充到 custom_header。
 *
 * 值的三种语义（由后端 header_template.go 占位符引擎渲染）：
 *  1. 固定具体值（如 User-Agent / originator / anthropic-version）：每次请求原样发送。
 *  2. {{inbound.header.X|{{uuid}}}}：优先透传客户端入站头 X；缺失时回退为本次请求新生成的 uuid（纯伪装，上游每次看到新会话）。
 *  3. {{inbound.header.X|}}：仅透传；客户端未携带则渲染为空 → 后端跳过不发送（条件头）。
 *
 * 鉴权头（Authorization / x-api-key）由 octopus 自身注入，不放入预设。
 */
export interface DisguisePreset {
    id: string;
    label: string;
    headers: CustomHeader[];
}

export const DISGUISE_PRESETS: DisguisePreset[] = [
    {
        id: 'codex',
        label: 'Codex CLI (codex_cli_rs)',
        headers: [
            { header_key: 'User-Agent', header_value: 'codex_cli_rs/0.0.0 (linux 6.8.0; x86_64) reqwest/0.12.22' },
            { header_key: 'originator', header_value: 'codex_cli_rs' },
            { header_key: 'session-id', header_value: '{{inbound.header.session-id|{{uuid}}}}' },
            { header_key: 'x-codex-installation-id', header_value: '{{inbound.header.x-codex-installation-id|{{uuid}}}}' },
            { header_key: 'OpenAI-Beta', header_value: '{{inbound.header.OpenAI-Beta|}}' },
            { header_key: 'x-codex-beta-features', header_value: '{{inbound.header.x-codex-beta-features|}}' },
            { header_key: 'x-codex-turn-state', header_value: '{{inbound.header.x-codex-turn-state|}}' },
        ],
    },
    {
        id: 'claude_code',
        label: 'Claude Code (claude-cli)',
        headers: [
            { header_key: 'User-Agent', header_value: 'claude-cli/2.1.185 (external, cli)' },
            { header_key: 'x-app', header_value: 'cli' },
            { header_key: 'anthropic-version', header_value: '2023-06-01' },
            { header_key: 'X-Claude-Code-Session-Id', header_value: '{{inbound.header.X-Claude-Code-Session-Id|{{uuid}}}}' },
            { header_key: 'anthropic-beta', header_value: '{{inbound.header.anthropic-beta|}}' },
            { header_key: 'x-client-app', header_value: '{{inbound.header.x-client-app|}}' },
            { header_key: 'x-claude-remote-container-id', header_value: '{{inbound.header.x-claude-remote-container-id|}}' },
        ],
    },
];

export function findDisguisePreset(id: string | null | undefined): DisguisePreset | undefined {
    if (!id) return undefined;
    return DISGUISE_PRESETS.find((p) => p.id === id);
}
