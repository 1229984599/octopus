import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, API_BASE_URL } from '../client';
import { logger } from '@/lib/logger';
import { useAuthStore } from './user';

/**
 * Setting 数据
 */
export interface Setting {
    key: string;
    value: string;
}

export const SettingKey = {
    ProxyURL: 'proxy_url',
    StatsSaveInterval: 'stats_save_interval',
    ModelInfoUpdateInterval: 'model_info_update_interval',
    SyncLLMCron: 'sync_llm_cron',
    RelayLogKeepEnabled: 'relay_log_keep_enabled',
    RelayLogKeepPeriod: 'relay_log_keep_period',
    CORSAllowOrigins: 'cors_allow_origins',
    CircuitBreakerThreshold: 'circuit_breaker_threshold',
    CircuitBreakerCooldown: 'circuit_breaker_cooldown',
    CircuitBreakerMaxCooldown: 'circuit_breaker_max_cooldown',
    AutoCheckEnabled: 'auto_check_enabled',
    AutoCheckCron: 'auto_check_cron',
    AutoCheckDingTalkWebhook: 'auto_check_dingtalk_webhook',
    AutoCheckDingTalkSecret: 'auto_check_dingtalk_secret',
} as const;

export const TaskName = {
    SyncLLM: 'sync_llm',
    AutoCheck: 'auto_check',
} as const;

export interface TaskStatus {
    name: string;
    type: 'cron' | 'interval';
    spec: string;
    last_run: string;
    next_run: string;
}

export interface AutoHealthCheckSummary {
    started_at: string;
    finished_at: string;
    checked_channels: number;
    skipped_channels: number;
    checked_keys: number;
    deleted_keys: number;
    disabled_channels: number;
    checked_groups: number;
    skipped_groups: number;
    checked_group_items: number;
    skipped_group_items: number;
    deleted_group_items: number;
    deleted_key_details: string[];
    disabled_details: string[];
    deleted_item_details: string[];
    errors: string[];
}

export interface AutoHealthCheckLog {
    time: string;
    level: 'info' | 'warn' | 'error' | string;
    message: string;
    detail?: string;
}

export interface AutoHealthCheckStatus {
    running: boolean;
    canceling: boolean;
    trigger: string;
    phase: string;
    message: string;
    current: string;
    started_at: string;
    finished_at: string;
    logs: AutoHealthCheckLog[];
    summary: AutoHealthCheckSummary;
}

/**
 * 获取 Setting 列表 Hook
 * 
 * @example
 * const { data: settings, isLoading, error } = useSettingList();
 * 
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 * 
 * settings?.forEach(setting => console.log(setting.key, setting.value));
 */
export function useSettingList() {
    return useQuery({
        queryKey: ['settings', 'list'],
        queryFn: async () => {
            return apiClient.get<Setting[]>('/api/v1/setting/list');
        },
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

/**
 * 设置 Setting Hook
 * 
 * @example
 * const setSetting = useSetSetting();
 * 
 * setSetting.mutate({
 *   key: 'theme',
 *   value: 'dark',
 * });
 */
export function useSetSetting() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Setting) => {
            return apiClient.post<Setting>('/api/v1/setting/set', data);
        },
        onSuccess: (data) => {
            logger.log('Setting 设置成功:', data);
            queryClient.invalidateQueries({ queryKey: ['settings', 'list'] });
        },
        onError: (error) => {
            logger.error('Setting 设置失败:', error);
        },
    });
}

export function useTaskStatus(name: string) {
    return useQuery({
        queryKey: ['settings', 'task-status', name],
        queryFn: async () => {
            return apiClient.get<TaskStatus>('/api/v1/setting/task-status', { name });
        },
        refetchInterval: 30000,
    });
}

export function useAutoCheckStatus() {
    return useQuery({
        queryKey: ['settings', 'auto-check-status'],
        queryFn: async () => {
            return apiClient.get<AutoHealthCheckStatus>('/api/v1/setting/auto-check/status');
        },
        refetchInterval: (query) => query.state.data?.running ? 2000 : 10000,
        refetchOnMount: 'always',
    });
}

export function useRunAutoCheck() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            return apiClient.post<null>('/api/v1/setting/auto-check/run');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings', 'auto-check-status'] });
            queryClient.invalidateQueries({ queryKey: ['settings', 'task-status', TaskName.AutoCheck] });
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['groups', 'list'] });
        },
        onError: (error) => {
            logger.error('自动检测失败:', error);
        },
    });
}

export function useCancelAutoCheck() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            return apiClient.post<null>('/api/v1/setting/auto-check/cancel');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings', 'auto-check-status'] });
        },
        onError: (error) => {
            logger.error('取消自动检测失败:', error);
        },
    });
}

export function useTestAutoCheckDingTalk() {
    return useMutation({
        mutationFn: async (data: { webhook: string; secret: string }) => {
            return apiClient.post<null>('/api/v1/setting/auto-check/test-dingtalk', data);
        },
        onError: (error) => {
            logger.error('测试钉钉 Webhook 失败:', error);
        },
    });
}

export interface ProxyTestResult {
    status_code: number;
    elapsed_ms: number;
    test_url: string;
    proxy_scheme: string;
}

export function useTestProxy() {
    return useMutation({
        mutationFn: async (data: { proxy_url: string }) => {
            return apiClient.post<ProxyTestResult>('/api/v1/setting/test-proxy', data);
        },
        onError: (error) => {
            logger.error('测试代理失败:', error);
        },
    });
}

/**
 * 数据库导入/导出
 */
export interface DBImportResult {
    rows_affected: Record<string, number>;
}

export interface DBImportPreviewTable {
    table: string;
    count: number;
    action: string;
    warning?: string;
}

export interface DBImportPreview {
    version: number;
    include_logs: boolean;
    include_stats: boolean;
    tables: DBImportPreviewTable[];
    warnings: string[];
    total_rows: number;
    skipped_tables: string[];
}

export interface DBExportOptions {
    include_logs?: boolean;
    include_stats?: boolean;
}

type ApiResponse<T> = {
    code?: number;
    message?: string;
    data?: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getMessageField(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;
    const msg = value.message;
    return typeof msg === 'string' ? msg : undefined;
}

function getDataField<T>(value: unknown): T | undefined {
    if (!isRecord(value)) return undefined;
    return (value as ApiResponse<T>).data;
}

function getAuthHeader(): string {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');
    return `Bearer ${token}`;
}

function parseFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    // e.g. attachment; filename="octopus-export-20250101120000.json"
    const match = contentDisposition.match(/filename="([^"]+)"/i);
    return match?.[1] ?? null;
}

function exportFallbackFilename() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `octopus-export-${ts}.json`;
}

async function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * 导出数据库（下载 JSON 文件）
 */
export function useExportDB() {
    return useMutation({
        mutationFn: async (options: DBExportOptions = {}) => {
            const params = new URLSearchParams();
            params.set('include_logs', String(!!options.include_logs));
            params.set('include_stats', String(!!options.include_stats));

            const res = await fetch(`${API_BASE_URL}/api/v1/setting/export?${params.toString()}`, {
                method: 'GET',
                headers: {
                    Authorization: getAuthHeader(),
                },
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || res.statusText);
            }

            const blob = await res.blob();
            const filename = parseFilename(res.headers.get('content-disposition')) || exportFallbackFilename();
            await downloadBlob(blob, filename);
            return { filename };
        },
        onError: (error) => {
            logger.error('导出数据库失败:', error);
        },
    });
}

/**
 * 导入数据库（上传 JSON 文件，增量导入）
 */
export function useImportDB() {
    return useMutation({
        mutationFn: async (file: File) => {
            const form = new FormData();
            form.append('file', file);

            const res = await fetch(`${API_BASE_URL}/api/v1/setting/import`, {
                method: 'POST',
                headers: {
                    Authorization: getAuthHeader(),
                },
                body: form,
            });

            const contentType = res.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');
            const data = isJson ? await res.json() : await res.text();

            if (!res.ok) {
                const message = getMessageField(data) ?? (typeof data === 'string' ? data : res.statusText);
                throw new Error(message);
            }

            // 支持后端标准 ApiResponse：{code,message,data:{...}}
            const nested = getDataField<DBImportResult>(data);
            return nested ?? (data as DBImportResult);
        },
        onError: (error) => {
            logger.error('导入数据库失败:', error);
        },
    });
}

export function usePreviewImportDB() {
    return useMutation({
        mutationFn: async (file: File) => {
            const form = new FormData();
            form.append('file', file);

            const res = await fetch(`${API_BASE_URL}/api/v1/setting/import/preview`, {
                method: 'POST',
                headers: {
                    Authorization: getAuthHeader(),
                },
                body: form,
            });

            const contentType = res.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');
            const data = isJson ? await res.json() : await res.text();

            if (!res.ok) {
                const message = getMessageField(data) ?? (typeof data === 'string' ? data : res.statusText);
                throw new Error(message || '导入预览失败');
            }

            const nested = getDataField<DBImportPreview>(data);
            return nested ?? (data as DBImportPreview);
        },
        onError: (error) => {
            logger.error('导入预览失败:', error);
        },
    });
}

