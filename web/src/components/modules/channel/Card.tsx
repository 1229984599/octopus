import {
    MorphingDialog,
    MorphingDialogTrigger,
    MorphingDialogContainer,
    MorphingDialogContent,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { AlertTriangle, Check, CheckCircle2, Clock, KeyRound, MessageSquare, ShieldAlert, XCircle } from 'lucide-react';
import { type StatsMetricsFormatted } from '@/api/endpoints/stats';
import { type Channel, useEnableChannel } from '@/api/endpoints/channel';
import { CardContent } from './CardContent';
import { useTranslations } from '@/lib/translations';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/animate-ui/components/animate/tooltip';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getChannelHealth } from './health';

function deferStateUpdate(update: () => void) {
    queueMicrotask(update);
}

export function Card({
    channel,
    stats,
    layout = 'grid',
    selectionMode = false,
    selected = false,
    onToggleSelect,
    autoOpenEdit = false,
    onAutoOpenEdit,
    onAutoClose,
    ungrouped = false,
}: {
    channel: Channel;
    stats: StatsMetricsFormatted;
    layout?: 'grid' | 'list';
    selectionMode?: boolean;
    selected?: boolean;
    ungrouped?: boolean;
    onToggleSelect?: (id: number) => void;
    autoOpenEdit?: boolean;
    onAutoOpenEdit?: (id: number) => void;
    onAutoClose?: () => void;
}) {
    const t = useTranslations('channel.card');
    const tMetrics = useTranslations('channel.detail.metrics');
    const enableChannel = useEnableChannel();
    const isListLayout = layout === 'list';

    const health = getChannelHealth(channel);
    const visibleTags = channel.tags.slice(0, isListLayout ? 4 : 3);
    const hiddenTagCount = Math.max(0, channel.tags.length - visibleTags.length);
    const checkedAtLabel = health.lastCheckedAt > 0 ? formatCompactDate(health.lastCheckedAt) : '';
    const checkedAtTitle = health.lastCheckedAt > 0 ? new Date(health.lastCheckedAt * 1000).toLocaleString() : '';
    const riskKeyCount = health.abnormalKeys + health.invalidKeys;
    const riskTitle = [
        health.abnormalKeys > 0 ? t('abnormalKeys', { count: health.abnormalKeys }) : '',
        health.invalidKeys > 0 ? t('invalidKeys', { count: health.invalidKeys }) : '',
    ].filter(Boolean).join(' / ');

    const handleEnableChange = (checked: boolean) => {
        enableChannel.mutate(
            { id: channel.id, enabled: checked },
            {
                onSuccess: () => {
                    toast.success(checked ? t('toast.enabled') : t('toast.disabled'));
                },
                onError: (error) => {
                    toast.error(error.message);
                },
            }
        );
    };

    const cardBody = (
        <article
            className={cn(
                'relative flex h-full min-h-60 flex-col gap-4 rounded-3xl border bg-card text-card-foreground p-4 transition-all duration-200',
                selected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                selectionMode && 'cursor-pointer'
            )}
            onClick={selectionMode ? () => onToggleSelect?.(channel.id) : undefined}
        >
            {selectionMode && (
                <button
                    type="button"
                    aria-pressed={selected}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleSelect?.(channel.id);
                    }}
                    className={cn(
                        'absolute left-3 top-3 z-10 flex size-7 items-center justify-center rounded-lg border shadow-sm',
                        selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground'
                    )}
                >
                    <Check className="size-4" />
                </button>
            )}

            <header className="relative flex items-center justify-between gap-2">
                <Tooltip side="top" sideOffset={10} align="center">
                    <TooltipTrigger asChild>
                        <h3 className={cn('min-w-0 truncate text-lg font-bold', selectionMode && 'pl-9')}>
                            {channel.name}
                        </h3>
                    </TooltipTrigger>
                    <TooltipContent key={channel.name}>{channel.name}</TooltipContent>
                </Tooltip>
                <Switch
                    checked={channel.enabled}
                    onCheckedChange={handleEnableChange}
                    disabled={enableChannel.isPending || selectionMode}
                    onClick={(e) => e.stopPropagation()}
                />
            </header>

            {channel.tags.length > 0 && (
                <div className="flex min-h-6 flex-wrap gap-1">
                    {visibleTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="max-w-full rounded-md px-1.5 py-0 text-[10px] font-normal">
                            <span className="truncate">{tag}</span>
                        </Badge>
                    ))}
                    {hiddenTagCount > 0 && (
                        <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[10px] font-normal">
                            +{hiddenTagCount}
                        </Badge>
                    )}
                    {ungrouped && (
                        <Badge variant="secondary" className="rounded-md bg-amber-500/15 px-1.5 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-400">
                            {t('ungrouped')}
                        </Badge>
                    )}
                </div>
            )}
            {ungrouped && channel.tags.length === 0 && (
                <div className="flex min-h-6">
                    <Badge variant="secondary" className="rounded-md bg-amber-500/15 px-1.5 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-400">
                        {t('ungrouped')}
                    </Badge>
                </div>
            )}

            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-background/60 p-2 text-xs">
                {(health.totalKeys > 0 || health.abnormalKeys > 0 || health.invalidKeys > 0 || health.lastCheckedAt > 0) ? (
                    <>
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <HealthPill
                            icon={<KeyRound className="size-3.5" />}
                            tone={health.availableKeys > 0 ? 'neutral' : 'danger'}
                            label={`${health.availableKeys}/${health.totalKeys}`}
                            title={t('availableKeys', { available: health.availableKeys, total: health.totalKeys })}
                        />
                        {riskKeyCount > 0 && (
                            <HealthPill
                                icon={health.invalidKeys > 0 ? <ShieldAlert className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                                tone={health.invalidKeys > 0 ? 'danger' : 'warn'}
                                label={`异常 ${riskKeyCount}`}
                                title={riskTitle}
                            />
                        )}
                    </div>
                    {health.lastCheckedAt > 0 && (
                        <div className="flex min-w-fit items-center gap-1.5 text-muted-foreground" title={checkedAtTitle}>
                            <Clock className="size-3.5 shrink-0" />
                            <span className="whitespace-nowrap">{checkedAtLabel}</span>
                        </div>
                    )}
                    </>
                ) : (
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <KeyRound className="size-3.5 shrink-0" />
                        <span>{t('availableKeys', { available: 0, total: 0 })}</span>
                    </div>
                )}
            </div>

            {isListLayout ? (
                <dl className="mt-auto grid grid-cols-2 gap-2 lg:grid-cols-3">
                    <ChannelMetric icon={<MessageSquare className="size-3.5 text-primary" />} label={t('requestCount')}>
                        {stats.request_count.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.request_count.formatted.unit}</span>
                    </ChannelMetric>
                    <ChannelMetric icon={<CheckCircle2 className="size-3.5 text-emerald-500" />} label={tMetrics('successRequests')}>
                        {stats.request_success.formatted.value}
                    </ChannelMetric>
                    <ChannelMetric icon={<XCircle className="size-3.5 text-destructive" />} label={tMetrics('failedRequests')}>
                        {stats.request_failed.formatted.value}
                    </ChannelMetric>
                </dl>
            ) : (
                <dl className="mt-auto grid grid-cols-1 gap-3">
                    <SummaryMetric icon={<MessageSquare className="h-5 w-5" />} label={t('requestCount')}>
                        {stats.request_count.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.request_count.formatted.unit}</span>
                    </SummaryMetric>
                </dl>
            )}
        </article>
    );

    if (selectionMode) {
        return cardBody;
    }

    return (
        <MorphingDialog>
            <CardDialog
                cardBody={cardBody}
                channel={channel}
                stats={stats}
                autoOpenEdit={autoOpenEdit}
                onAutoOpenEdit={onAutoOpenEdit}
                onAutoClose={onAutoClose}
            />
        </MorphingDialog>
    );
}

function CardDialog({
    cardBody,
    channel,
    stats,
    autoOpenEdit,
    onAutoOpenEdit,
    onAutoClose,
}: {
    cardBody: ReactNode;
    channel: Channel;
    stats: StatsMetricsFormatted;
    autoOpenEdit: boolean;
    onAutoOpenEdit?: (id: number) => void;
    onAutoClose?: () => void;
}) {
    const { isOpen, setIsOpen } = useMorphingDialog();
    const [openInEditMode, setOpenInEditMode] = useState(false);
    const openedRef = useRef(false);
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (!autoOpenEdit) {
            openedRef.current = false;
            return;
        }
        if (openedRef.current) return;
        openedRef.current = true;
        deferStateUpdate(() => {
            setOpenInEditMode(true);
            setIsOpen(true);
        });
        onAutoOpenEdit?.(channel.id);
    }, [autoOpenEdit, channel.id, onAutoOpenEdit, setIsOpen]);

    useEffect(() => {
        if (isOpen) {
            wasOpenRef.current = true;
            return;
        }
        deferStateUpdate(() => setOpenInEditMode(false));
        if (autoOpenEdit && wasOpenRef.current) {
            wasOpenRef.current = false;
            onAutoClose?.();
        }
    }, [autoOpenEdit, isOpen, onAutoClose]);

    return (
        <>
            <MorphingDialogTrigger className="h-full w-full">
                {cardBody}
            </MorphingDialogTrigger>

            <MorphingDialogContainer>
                <MorphingDialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] md:max-w-4xl xl:max-w-5xl bg-card text-card-foreground px-3 py-2 sm:px-5 rounded-3xl max-h-[92vh] overflow-y-auto">
                    <CardContent channel={channel} stats={stats} initialEditing={openInEditMode} />
                </MorphingDialogContent>
            </MorphingDialogContainer>
        </>
    );
}

function formatCompactDate(timestamp: number) {
    const date = new Date(timestamp * 1000);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function HealthPill({ icon, label, tone, title }: { icon: React.ReactNode; label: string; tone: 'warn' | 'danger' | 'neutral'; title?: string }) {
    return (
        <div
            title={title ?? label}
            className={cn(
                'inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]',
                tone === 'warn' && 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                tone === 'danger' && 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
                tone === 'neutral' && 'border-border bg-muted/40 text-muted-foreground'
            )}
        >
            <span className="shrink-0">{icon}</span>
            <span className="min-w-0 truncate">{label}</span>
        </div>
    );
}

function ChannelMetric({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-border/70 bg-background/80 p-2">
            <dt className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {icon}
                {label}
            </dt>
            <dd className="text-sm font-semibold">{children}</dd>
        </div>
    );
}

function SummaryMetric({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 p-2">
            <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {icon}
                </span>
                <dt className="text-sm text-muted-foreground">{label}</dt>
            </div>
            <dd className="text-base">{children}</dd>
        </div>
    );
}
