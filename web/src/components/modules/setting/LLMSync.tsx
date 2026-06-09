'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from '@/lib/translations';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSettingList, useSetSetting, SettingKey, TaskName, useTaskStatus } from '@/api/endpoints/setting';
import { useLastSyncTime, useSyncChannel } from '@/api/endpoints/channel';
import { toast } from '@/components/common/Toast';

export function SettingLLMSync() {
    const t = useTranslations('setting');
    const { data: settings } = useSettingList();
    const setSetting = useSetSetting();
    const syncChannel = useSyncChannel();
    const { data: lastSyncTime } = useLastSyncTime();
    const { data: syncTaskStatus } = useTaskStatus(TaskName.SyncLLM);

    const [syncCron, setSyncCron] = useState('0 2 * * *');
    const initialSyncCron = useRef('0 2 * * *');

    useEffect(() => {
        if (settings) {
            const cron = settings.find(s => s.key === SettingKey.SyncLLMCron);
            if (cron) {
                queueMicrotask(() => setSyncCron(cron.value));
                initialSyncCron.current = cron.value;
            }
        }
    }, [settings]);

    const handleSave = (key: string, value: string, initialValue: string) => {
        if (value === initialValue) return;

        setSetting.mutate({ key, value }, {
            onSuccess: () => {
                toast.success(t('saved'));
                initialSyncCron.current = value;
            }
        });
    };

    const handleManualSync = () => {
        syncChannel.mutate(undefined, {
            onSuccess: () => {
                toast.success(t('llmSync.syncSuccess'));
            },
            onError: () => {
                toast.error(t('llmSync.syncFailed'));
            }
        });
    };

    const formatLastSyncTime = (timeStr: string | undefined) => {
        if (!timeStr) return t('llmSync.neverSynced');
        const date = new Date(timeStr);
        if (date.getFullYear() === 1) return t('llmSync.neverSynced');
        return date.toLocaleString();
    };

    const formatNextRunTime = (timeStr: string | undefined) => {
        if (!timeStr) return t('llmSync.noSchedule');
        const date = new Date(timeStr);
        if (date.getFullYear() === 1) return t('llmSync.noSchedule');
        return date.toLocaleString();
    };

    return (
        <div className="rounded-3xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                {t('llmSync.title')}
            </h2>

            {/* 同步计划 */}
            <div className="space-y-2">
                <div className="flex items-center gap-3">
                    <CalendarClock className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('llmSync.syncCron.label')}</span>
                </div>
                <Input
                    value={syncCron}
                    onChange={(e) => setSyncCron(e.target.value)}
                    onBlur={() => handleSave(SettingKey.SyncLLMCron, syncCron.trim(), initialSyncCron.current)}
                    placeholder={t('llmSync.syncCron.placeholder')}
                    className="rounded-xl font-mono"
                />
                <div className="grid gap-1 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>{t('llmSync.lastSync')}: {formatLastSyncTime(syncTaskStatus?.last_run ?? lastSyncTime)}</span>
                    <span>{t('llmSync.nextSync')}: {formatNextRunTime(syncTaskStatus?.next_run)}</span>
                </div>
            </div>

            {/* 手动同步 */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                        <RefreshCw className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium">{t('llmSync.manualSync.label')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground ml-8">
                        {t('llmSync.manualSync.hint')}
                    </span>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualSync}
                    disabled={syncChannel.isPending}
                    className="rounded-xl"
                >
                    {syncChannel.isPending ? t('llmSync.manualSync.syncing') : t('llmSync.manualSync.button')}
                </Button>
            </div>
        </div>
    );
}

