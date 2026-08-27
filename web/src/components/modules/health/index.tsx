'use client';

import { useMemo } from 'react';
import { useChannelList, useRegroupChannel, type Channel } from '@/api/endpoints/channel';
import { useGroupList, type Group } from '@/api/endpoints/group';
import { PageWrapper } from '@/components/common/PageWrapper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AlertTriangle, Ban, FolderTree, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslations } from '@/lib/translations';
import { useNavStore } from '@/components/modules/navbar/nav-store';
import { openChannelEditor } from '@/components/modules/channel/navigation-store';

interface ChannelHealthSummary {
    total: number;
    okKeys: number;
    invalidKeys: number; // 401/403
    cooldownKeys: number; // 402/429
    errorKeys: number; // 其他非 2xx
    uncheckedKeys: number;
}

function summarizeChannelKeys(channel: Channel): ChannelHealthSummary {
    const summary: ChannelHealthSummary = {
        total: 0,
        okKeys: 0,
        invalidKeys: 0,
        cooldownKeys: 0,
        errorKeys: 0,
        uncheckedKeys: 0,
    };
    for (const key of channel.keys ?? []) {
        if (!key.enabled) continue;
        summary.total++;
        if (key.status_code >= 200 && key.status_code < 300) summary.okKeys++;
        else if (key.status_code === 401 || key.status_code === 403) summary.invalidKeys++;
        else if (key.status_code === 402 || key.status_code === 429) summary.cooldownKeys++;
        else if (key.status_code !== 0) summary.errorKeys++;
        else summary.uncheckedKeys++;
    }
    return summary;
}

function channelModelCount(channel: Channel): number {
    const auto = (channel.model ?? '').split(',').map((m) => m.trim()).filter(Boolean);
    const custom = (channel.custom_model ?? '').split(',').map((m) => m.trim()).filter(Boolean);
    return new Set([...auto, ...custom]).size;
}

export function HealthOverview() {
    const t = useTranslations('health');
    const { data: channelsData, isLoading: channelsLoading } = useChannelList();
    const { data: groups, isLoading: groupsLoading } = useGroupList();
    const regroup = useRegroupChannel();
    const setActiveItem = useNavStore((s) => s.setActiveItem);

    const channels = channelsData?.map((d) => d.raw) ?? [];

    const analysis = useMemo(() => {
        const groupedChannelIDs = new Set<number>();
        const groupList = groups ?? [];
        for (const group of groupList) {
            for (const item of group.items ?? []) groupedChannelIDs.add(item.channel_id);
        }

        const enabled = channels.filter((c) => c.enabled);
        const ungrouped = enabled.filter((c) => !groupedChannelIDs.has(c.id) && channelModelCount(c) > 0);
        const noModels = enabled.filter((c) => channelModelCount(c) === 0);
        const duplicateUpstream = findDuplicateUpstreams(channels);

        const modelsWithoutChannels = groupList.filter((g) => {
            const items = (g.items ?? []).filter((item) => channels.find((c) => c.id === item.channel_id)?.enabled);
            return items.length === 0;
        });

        const invalidEnabledKeys = channels
            .map((c) => ({ channel: c, summary: summarizeChannelKeys(c) }))
            .filter(({ summary }) => summary.invalidKeys > 0);

        return {
            groupList,
            ungrouped,
            noModels,
            duplicateUpstream,
            modelsWithoutChannels,
            invalidEnabledKeys,
            totalInvalidKeys: invalidEnabledKeys.reduce((acc, { summary }) => acc + summary.invalidKeys, 0),
        };
    }, [channels, groups]);

    const loading = channelsLoading || groupsLoading;
    const healthy = analysis.ungrouped.length === 0
        && analysis.noModels.length === 0
        && analysis.modelsWithoutChannels.length === 0
        && analysis.totalInvalidKeys === 0;

    if (loading) {
        return (
            <div className="h-full min-h-0 overflow-y-auto overscroll-contain rounded-t-3xl">
                <PageWrapper className="pb-24 md:pb-4">
                    <p className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</p>
                </PageWrapper>
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto overscroll-contain rounded-t-3xl">
            <PageWrapper className="pb-24 md:pb-4">
                <div className="space-y-5">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="size-5 text-muted-foreground" />
                        <h1 className="text-lg font-semibold">{t('title')}</h1>
                    </div>

                    {healthy && (
                        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-700 dark:text-green-400">
                            {t('allHealthy')}
                        </div>
                    )}

                    <AlertCard
                        icon={<Ban className="size-4" />}
                        tone="red"
                        title={t('invalidKeysTitle', { count: analysis.totalInvalidKeys, channels: analysis.invalidEnabledKeys.length })}
                        visible={analysis.totalInvalidKeys > 0}
                    >
                        {analysis.invalidEnabledKeys.slice(0, 8).map(({ channel, summary }) => (
                            <li key={channel.id} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="text-left underline-offset-2 hover:underline"
                                    onClick={() => openChannelEditor(channel.id)}
                                >
                                    {channel.name}
                                </button>
                                <Badge variant="secondary" className="h-5 bg-red-500/15 px-1.5 text-[10px] text-red-700 dark:text-red-400">
                                    {summary.invalidKeys} 401/403
                                </Badge>
                            </li>
                        ))}
                        {analysis.invalidEnabledKeys.length > 8 && (
                            <li className="text-muted-foreground">
                                {t('moreItems', { count: analysis.invalidEnabledKeys.length - 8 })}
                            </li>
                        )}
                        <li className="pt-1 text-muted-foreground">{t('invalidKeysHint')}</li>
                    </AlertCard>

                    <AlertCard
                        icon={<FolderTree className="size-4" />}
                        tone="amber"
                        title={t('ungroupedTitle', { count: analysis.ungrouped.length })}
                        visible={analysis.ungrouped.length > 0}
                    >
                        {analysis.ungrouped.slice(0, 8).map((channel) => (
                            <li key={channel.id} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="text-left underline-offset-2 hover:underline"
                                    onClick={() => openChannelEditor(channel.id)}
                                >
                                    {channel.name}
                                </button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-6 rounded-lg px-2 text-[11px]"
                                    disabled={regroup.isPending}
                                    onClick={() =>
                                        regroup.mutate(channel.id, {
                                            onSuccess: () => toast.success(t('regroupDone'), { description: channel.name }),
                                            onError: (error) => toast.error(t('regroupFailed'), { description: error.message }),
                                        })
                                    }
                                >
                                    <RefreshCw className="size-3" />
                                    {t('regroupAction')}
                                </Button>
                            </li>
                        ))}
                        {analysis.ungrouped.length > 8 && (
                            <li className="text-muted-foreground">
                                {t('moreItems', { count: analysis.ungrouped.length - 8 })}
                            </li>
                        )}
                        <li className="pt-1 text-muted-foreground">{t('ungroupedHint')}</li>
                    </AlertCard>

                    <AlertCard
                        icon={<AlertTriangle className="size-4" />}
                        tone="red"
                        title={t('noRouteTitle', { count: analysis.modelsWithoutChannels.length })}
                        visible={analysis.modelsWithoutChannels.length > 0}
                    >
                        {analysis.modelsWithoutChannels.slice(0, 10).map((group: Group) => (
                            <li key={group.id} className="flex items-center gap-2">
                                <code className="rounded bg-muted px-1 text-xs">{group.name}</code>
                            </li>
                        ))}
                        {analysis.modelsWithoutChannels.length > 10 && (
                            <li className="text-muted-foreground">
                                {t('moreItems', { count: analysis.modelsWithoutChannels.length - 10 })}
                            </li>
                        )}
                        <li className="pt-1 text-muted-foreground">
                            <button
                                type="button"
                                className="underline-offset-2 hover:underline"
                                onClick={() => setActiveItem?.('group')}
                            >
                                {t('goGroupPage')}
                            </button>
                        </li>
                    </AlertCard>

                    <AlertCard
                        icon={<KeyRound className="size-4" />}
                        tone="slate"
                        title={t('noModelsTitle', { count: analysis.noModels.length })}
                        visible={analysis.noModels.length > 0}
                    >
                        {analysis.noModels.slice(0, 8).map((channel) => (
                            <li key={channel.id}>
                                <button
                                    type="button"
                                    className="text-left underline-offset-2 hover:underline"
                                    onClick={() => openChannelEditor(channel.id)}
                                >
                                    {channel.name}
                                </button>
                            </li>
                        ))}
                        {analysis.noModels.length > 8 && (
                            <li className="text-muted-foreground">
                                {t('moreItems', { count: analysis.noModels.length - 8 })}
                            </li>
                        )}
                        <li className="pt-1 text-muted-foreground">{t('noModelsHint')}</li>
                    </AlertCard>

                    {analysis.duplicateUpstream.length > 0 && (
                        <AlertCard
                            icon={<AlertTriangle className="size-4" />}
                            tone="amber"
                            title={t('duplicateTitle', { count: analysis.duplicateUpstream.length })}
                            visible
                        >
                            {analysis.duplicateUpstream.slice(0, 6).map((entry) => (
                                <li key={entry.url}>
                                    <code className="rounded bg-muted px-1 text-xs">{entry.url}</code>
                                    <span className="ml-2 text-muted-foreground">
                                        {entry.channels.map((c) => c.name).join(' / ')}
                                    </span>
                                </li>
                            ))}
                            <li className="pt-1 text-muted-foreground">{t('duplicateHint')}</li>
                        </AlertCard>
                    )}
                </div>
            </PageWrapper>
        </div>
    );
}

function AlertCard({
    icon,
    title,
    tone,
    visible,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    tone: 'red' | 'amber' | 'slate';
    visible: boolean;
    children: React.ReactNode;
}) {
    if (!visible) return null;
    const toneClass = tone === 'red'
        ? 'border-red-500/30 bg-red-500/5'
        : tone === 'amber'
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-border bg-muted/30';
    const iconClass = tone === 'red'
        ? 'text-red-600 dark:text-red-400'
        : tone === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground';
    return (
        <section className={`rounded-2xl border p-4 ${toneClass}`}>
            <h2 className="flex items-center gap-2 text-sm font-medium">
                <span className={iconClass}>{icon}</span>
                {title}
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
                {children}
            </ul>
        </section>
    );
}

interface DuplicateUpstream {
    url: string;
    channels: Channel[];
}

function findDuplicateUpstreams(channels: Channel[]): DuplicateUpstream[] {
    const byUrl = new Map<string, Channel[]>();
    for (const channel of channels) {
        const url = (channel.base_urls?.[0]?.url ?? '').trim().toLowerCase().replace(/\/+$/, '');
        if (!url) continue;
        const list = byUrl.get(url) ?? [];
        list.push(channel);
        byUrl.set(url, list);
    }
    const result: DuplicateUpstream[] = [];
    for (const [url, list] of byUrl) {
        if (list.length > 1) result.push({ url, channels: list });
    }
    return result.sort((a, b) => b.channels.length - a.channels.length);
}
