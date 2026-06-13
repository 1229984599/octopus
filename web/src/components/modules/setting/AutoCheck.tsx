'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from '@/lib/translations';
import { Activity, Bell, CalendarClock, ExternalLink, HelpCircle, KeyRound, Play, Send, ShieldCheck, Square } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAutoCheckStatus, useCancelAutoCheck, useRunAutoCheck, useSettingList, useSetSetting, SettingKey, TaskName, useTaskStatus, useTestAutoCheckDingTalk } from '@/api/endpoints/setting';
import { toast } from '@/components/common/Toast';
import type { ApiError } from '@/api/types';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { openChannelEditor } from '@/components/modules/channel/navigation-store';

type AutoCheckLogLevelFilter = 'all' | 'error' | 'warn' | 'info';

export function SettingAutoCheck() {
    const t = useTranslations('setting');
    const { data: settings } = useSettingList();
    const setSetting = useSetSetting();
    const runAutoCheck = useRunAutoCheck();
    const cancelAutoCheck = useCancelAutoCheck();
    const testDingTalk = useTestAutoCheckDingTalk();
    const { data: autoCheckStatus } = useTaskStatus(TaskName.AutoCheck);
    const { data: checkStatus } = useAutoCheckStatus();

    const [enabled, setEnabled] = useState(true);
    const [cron, setCron] = useState('0 2 * * *');
    const [webhook, setWebhook] = useState('');
    const [dingTalkSecret, setDingTalkSecret] = useState('');
    const [logLevelFilter, setLogLevelFilter] = useState<AutoCheckLogLevelFilter>('all');

    const initialEnabled = useRef(true);
    const initialCron = useRef('0 2 * * *');
    const initialWebhook = useRef('');
    const initialDingTalkSecret = useRef('');

    useEffect(() => {
        if (!settings) return;
        const enabledSetting = settings.find(s => s.key === SettingKey.AutoCheckEnabled);
        const cronSetting = settings.find(s => s.key === SettingKey.AutoCheckCron);
        const webhookSetting = settings.find(s => s.key === SettingKey.AutoCheckDingTalkWebhook);
        const secretSetting = settings.find(s => s.key === SettingKey.AutoCheckDingTalkSecret);

        if (enabledSetting) {
            const nextEnabled = enabledSetting.value === 'true';
            queueMicrotask(() => setEnabled(nextEnabled));
            initialEnabled.current = nextEnabled;
        }
        if (cronSetting) {
            queueMicrotask(() => setCron(cronSetting.value));
            initialCron.current = cronSetting.value;
        }
        if (webhookSetting) {
            queueMicrotask(() => setWebhook(webhookSetting.value));
            initialWebhook.current = webhookSetting.value;
        }
        if (secretSetting) {
            queueMicrotask(() => setDingTalkSecret(secretSetting.value));
            initialDingTalkSecret.current = secretSetting.value;
        }
    }, [settings]);

    const saveSetting = (key: string, value: string, onSaved: () => void) => {
        setSetting.mutate(
            { key, value },
            {
                onSuccess: () => {
                    toast.success(t('saved'));
                    onSaved();
                },
                onError: (error) => {
                    toast.error(getErrorMessage(error, t('autoCheck.saveFailed')));
                },
            }
        );
    };

    const handleEnabledChange = (checked: boolean) => {
        setEnabled(checked);
        saveSetting(SettingKey.AutoCheckEnabled, checked ? 'true' : 'false', () => {
            initialEnabled.current = checked;
        });
    };

    const handleCronSave = () => {
        const nextCron = cron.trim();
        if (nextCron === initialCron.current) return;
        setCron(nextCron);
        saveSetting(SettingKey.AutoCheckCron, nextCron, () => {
            initialCron.current = nextCron;
        });
    };

    const handleWebhookSave = () => {
        const nextWebhook = webhook.trim();
        if (nextWebhook === initialWebhook.current) return;
        setWebhook(nextWebhook);
        saveSetting(SettingKey.AutoCheckDingTalkWebhook, nextWebhook, () => {
            initialWebhook.current = nextWebhook;
        });
    };

    const handleDingTalkSecretSave = () => {
        const nextSecret = dingTalkSecret.trim();
        if (nextSecret === initialDingTalkSecret.current) return;
        setDingTalkSecret(nextSecret);
        saveSetting(SettingKey.AutoCheckDingTalkSecret, nextSecret, () => {
            initialDingTalkSecret.current = nextSecret;
        });
    };

    const formatTaskTime = (timeStr: string | undefined, emptyText: string) => {
        if (!timeStr) return emptyText;
        const date = new Date(timeStr);
        if (date.getFullYear() === 1) return emptyText;
        return date.toLocaleString();
    };

    const getErrorMessage = (error: unknown, fallback: string) => {
        const msg = (error as ApiError | undefined)?.message;
        return msg || fallback;
    };

    const handleManualRun = () => {
        runAutoCheck.mutate(undefined, {
            onSuccess: () => {
                toast.success(t('autoCheck.manualRun.started'));
            },
            onError: (error) => {
                toast.error(getErrorMessage(error, t('autoCheck.manualRun.failed')));
            },
        });
    };

    const handleCancel = () => {
        cancelAutoCheck.mutate(undefined, {
            onSuccess: () => {
                toast.success(t('autoCheck.cancel.requested'));
            },
            onError: (error) => {
                toast.error(getErrorMessage(error, t('autoCheck.cancel.failed')));
            },
        });
    };

    const handleTestDingTalk = () => {
        testDingTalk.mutate({ webhook: webhook.trim(), secret: dingTalkSecret.trim() }, {
            onSuccess: () => {
                toast.success(t('autoCheck.dingTalkWebhook.testSuccess'));
            },
            onError: (error) => {
                toast.error(getErrorMessage(error, t('autoCheck.dingTalkWebhook.testFailed')));
            },
        });
    };

    const isRunning = !!checkStatus?.running;
    const isCanceling = !!checkStatus?.canceling;
    const summary = checkStatus?.summary;
    const logs = (checkStatus?.logs ?? []).slice(-80).reverse();
    const pendingItems = [
        ...((summary?.disabled_key_details ?? summary?.deleted_key_details) ?? []).map(item => ({ type: t('autoCheck.status.disabledKey'), text: item, channelId: extractChannelID(item) })),
        ...(summary?.disabled_details ?? []).map(item => ({ type: t('autoCheck.status.disabled'), text: item, channelId: extractChannelID(item) })),
        ...(summary?.deleted_item_details ?? []).map(item => ({ type: t('autoCheck.status.manualItem'), text: item, channelId: extractChannelID(item) })),
    ].slice(-8).reverse();
    const detailItems = [
        ...pendingItems,
        ...(summary?.errors ?? []).map(item => ({ type: t('autoCheck.status.error'), text: item, channelId: null })),
    ].slice(-8).reverse();
    const pendingGroups = new Map<string, { channelId: number | null; title: string; items: typeof pendingItems }>();
    pendingItems.forEach((item) => {
        const key = item.channelId ? `channel-${item.channelId}` : `misc-${item.text}`;
        const existing = pendingGroups.get(key);
        if (existing) {
            existing.items.push(item);
            return;
        }
        pendingGroups.set(key, {
            channelId: item.channelId,
            title: item.channelId ? `${t('autoCheck.pending.channel')} #${item.channelId}` : t('autoCheck.pending.other'),
            items: [item],
        });
    });
    const groupedPendingItems = Array.from(pendingGroups.values());
    const filteredLogs = logLevelFilter === 'all'
        ? logs
        : logs.filter((entry) => {
            const normalized = entry.level === 'error' || entry.level === 'warn' ? entry.level : 'info';
            return normalized === logLevelFilter;
        });
    const logFilters: Array<{ value: AutoCheckLogLevelFilter; label: string }> = [
        { value: 'all', label: t('autoCheck.logs.all') },
        { value: 'error', label: t('autoCheck.logs.error') },
        { value: 'warn', label: t('autoCheck.logs.warn') },
        { value: 'info', label: t('autoCheck.logs.info') },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-card p-5">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold text-card-foreground">{t('autoCheck.title')}</h2>
                        <p className="text-xs text-muted-foreground">{checkStatus?.message || t('autoCheck.status.idle')}</p>
                    </div>
                </div>
                <Badge variant={isRunning ? 'default' : 'outline'} className="rounded-lg">
                    {isRunning ? t('autoCheck.status.running') : t('autoCheck.status.idle')}
                </Badge>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="space-y-4">
                    <div className="rounded-3xl border border-border bg-card p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <Activity className={cn('size-4 text-muted-foreground', isRunning && 'text-primary')} />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                                {checkStatus?.message || t('autoCheck.status.idle')}
                            </div>
                            {checkStatus?.current && (
                                <div className="truncate text-xs text-muted-foreground">
                                    {t('autoCheck.status.current')}: {checkStatus.current}
                                </div>
                            )}
                        </div>
                    </div>
                    <Badge variant={isRunning ? 'default' : 'outline'} className="rounded-lg">
                        {isRunning ? t('autoCheck.status.running') : t('autoCheck.status.idle')}
                    </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <StatusMetric label={t('autoCheck.status.checkedChannels')} value={summary?.checked_channels ?? 0} />
                    <StatusMetric label={t('autoCheck.status.checkedKeys')} value={summary?.checked_keys ?? 0} />
                    <StatusMetric label={t('autoCheck.status.disabledKeys')} value={summary?.disabled_keys ?? summary?.deleted_keys ?? 0} />
                    <StatusMetric label={t('autoCheck.status.disabledChannels')} value={summary?.disabled_channels ?? 0} />
                </div>

                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>{t('autoCheck.status.startedAt')}: {formatTaskTime(checkStatus?.started_at, t('autoCheck.neverRun'))}</span>
                    <span>{t('autoCheck.status.finishedAt')}: {formatTaskTime(checkStatus?.finished_at, t('autoCheck.noSchedule'))}</span>
                </div>

                {groupedPendingItems.length > 0 && (
                    <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                            <KeyRound className="size-3.5" />
                            {t('autoCheck.pending.title')}
                        </div>
                        <div className="max-h-52 space-y-2 overflow-y-auto">
                            {groupedPendingItems.map((group) => (
                                <div key={`${group.title}-${group.items[0]?.text ?? ''}`} className="rounded-xl bg-background/70 p-2 text-xs">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="font-medium text-foreground">{group.title}</span>
                                        {group.channelId && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 rounded-lg px-2 text-xs"
                                                onClick={() => openChannelEditor(group.channelId!)}
                                        >
                                            <ExternalLink className="size-3.5" />
                                            {t('autoCheck.pending.open')}
                                        </Button>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        {group.items.map((item, index) => (
                                            <div key={`${item.type}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-2">
                                                <span className="text-muted-foreground">{item.type}</span>
                                                <span className="break-all text-foreground/90">{item.text}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {detailItems.length > 0 && (
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl bg-background/70 p-2">
                        {detailItems.map((item, index) => (
                            <div key={`${item.type}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs">
                                <span className="text-muted-foreground">{item.type}</span>
                                <span className="break-all text-foreground/90">{item.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">{t('autoCheck.logs.title')}</span>
                        <div className="flex flex-wrap items-center gap-1">
                            {logFilters.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => setLogLevelFilter(item.value)}
                                    className={cn(
                                        'h-6 rounded-lg border px-2 text-[11px] transition-colors',
                                        logLevelFilter === item.value
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {item.label}
                                </button>
                            ))}
                            <span className="ml-1 text-[11px] text-muted-foreground">{t('autoCheck.logs.recent')}</span>
                        </div>
                    </div>
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl bg-background/70 p-2">
                        {filteredLogs.length > 0 ? (
                            filteredLogs.map((entry, index) => (
                                <div key={`${entry.time}-${index}`} className="grid grid-cols-[4.2rem_3.5rem_1fr] gap-2 text-xs">
                                    <span className="text-muted-foreground tabular-nums">{formatLogTime(entry.time)}</span>
                                    <span className={cn(
                                        'font-medium',
                                        entry.level === 'error' && 'text-destructive',
                                        entry.level === 'warn' && 'text-orange-600 dark:text-orange-400',
                                        entry.level !== 'error' && entry.level !== 'warn' && 'text-primary'
                                    )}>
                                        {t(`autoCheck.logs.${entry.level === 'error' || entry.level === 'warn' ? entry.level : 'info'}`)}
                                    </span>
                                    <span className="min-w-0 break-words text-foreground/90">
                                        {entry.message}
                                        {entry.detail && (
                                            <span className="ml-1 text-muted-foreground">{entry.detail}</span>
                                        )}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="py-4 text-center text-xs text-muted-foreground">{t('autoCheck.logs.empty')}</div>
                        )}
                    </div>
                </div>
            </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-3xl border border-border bg-card p-4 space-y-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                                <span className="text-sm font-medium">{t('autoCheck.enabled.label')}</span>
                            </div>
                            <Switch
                                checked={enabled}
                                onCheckedChange={handleEnabledChange}
                                disabled={setSetting.isPending}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <CalendarClock className="h-5 w-5 text-muted-foreground" />
                                <span className="text-sm font-medium">{t('autoCheck.cron.label')}</span>
                            </div>
                            <Input
                                value={cron}
                                onChange={(e) => setCron(e.target.value)}
                                onBlur={handleCronSave}
                                placeholder={t('autoCheck.cron.placeholder')}
                                className="rounded-xl font-mono"
                                disabled={!enabled}
                            />
                            <div className="grid gap-1 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                <span>{t('autoCheck.lastRun')}: {formatTaskTime(autoCheckStatus?.last_run, t('autoCheck.neverRun'))}</span>
                                <span>{t('autoCheck.nextRun')}: {formatTaskTime(autoCheckStatus?.next_run, t('autoCheck.noSchedule'))}</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <Play className="h-5 w-5 text-muted-foreground" />
                            <span className="text-sm font-medium">{t('autoCheck.manualRun.label')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('autoCheck.manualRun.hint')}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleManualRun}
                                disabled={runAutoCheck.isPending || isRunning}
                                className="rounded-xl"
                            >
                                <Play className="size-4" />
                                {isRunning ? t('autoCheck.manualRun.running') : t('autoCheck.manualRun.button')}
                            </Button>
                            {isRunning && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleCancel}
                                    disabled={cancelAutoCheck.isPending || isCanceling}
                                    className="rounded-xl"
                                >
                                    <Square className="size-4" />
                                    {isCanceling ? t('autoCheck.cancel.canceling') : t('autoCheck.cancel.button')}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <Bell className="h-5 w-5 text-muted-foreground" />
                            <span className="text-sm font-medium">{t('autoCheck.dingTalkWebhook.label')}</span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t('autoCheck.dingTalkWebhook.hint')}
                                        <br />
                                        {t('autoCheck.dingTalkWebhook.example')}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                            <Input
                                value={webhook}
                                onChange={(e) => setWebhook(e.target.value)}
                                onBlur={handleWebhookSave}
                                placeholder={t('autoCheck.dingTalkWebhook.placeholder')}
                                className="rounded-xl"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleTestDingTalk}
                                disabled={testDingTalk.isPending}
                                className="h-9 rounded-xl sm:w-24 xl:w-full"
                            >
                                <Send className="size-4" />
                                {testDingTalk.isPending ? t('autoCheck.dingTalkWebhook.testing') : t('autoCheck.dingTalkWebhook.test')}
                            </Button>
                        </div>
                        <Input
                            value={dingTalkSecret}
                            onChange={(e) => setDingTalkSecret(e.target.value)}
                            onBlur={handleDingTalkSecretSave}
                            placeholder={t('autoCheck.dingTalkSecret.placeholder')}
                            className="rounded-xl"
                            type="password"
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('autoCheck.dingTalkSecret.hint')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function extractChannelID(text: string) {
    const match = text.match(/\((\d+)\)/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function formatLogTime(timeStr: string | undefined) {
    if (!timeStr) return '--:--:--';
    const date = new Date(timeStr);
    if (date.getFullYear() === 1) return '--:--:--';
    return date.toLocaleTimeString();
}

function StatusMetric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-border/50 bg-background/70 px-2 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
        </div>
    );
}
