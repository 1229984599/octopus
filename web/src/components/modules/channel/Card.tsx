import {
    MorphingDialog,
    MorphingDialogTrigger,
    MorphingDialogContainer,
    MorphingDialogContent,
} from '@/components/ui/morphing-dialog';
import { Check, CheckCircle2, DollarSign, Key, Layers, MessageSquare, XCircle } from 'lucide-react';
import { type StatsMetricsFormatted } from '@/api/endpoints/stats';
import { type Channel, useEnableChannel } from '@/api/endpoints/channel';
import { CardContent } from './CardContent';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/animate-ui/components/animate/tooltip';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';

export function Card({
    channel,
    stats,
    layout = 'grid',
    selectionMode = false,
    selected = false,
    onToggleSelect,
}: {
    channel: Channel;
    stats: StatsMetricsFormatted;
    layout?: 'grid' | 'list';
    selectionMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (id: number) => void;
}) {
    const t = useTranslations('channel.card');
    const tForm = useTranslations('channel.form');
    const tSections = useTranslations('channel.detail.sections');
    const tMetrics = useTranslations('channel.detail.metrics');
    const enableChannel = useEnableChannel();
    const isListLayout = layout === 'list';

    const splitModels = (models: string) =>
        models
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

    const modelCount = new Set([
        ...splitModels(channel.model),
        ...splitModels(channel.custom_model),
    ]).size;
    const enabledKeyCount = channel.keys.filter((item) => item.enabled).length;

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
                'relative flex flex-col gap-4 rounded-3xl border bg-card text-card-foreground p-4 transition-all duration-200',
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

            {isListLayout ? (
                <dl className="grid grid-cols-2 gap-2 lg:grid-cols-6">
                    <ChannelMetric icon={<MessageSquare className="size-3.5 text-primary" />} label={t('requestCount')}>
                        {stats.request_count.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.request_count.formatted.unit}</span>
                    </ChannelMetric>
                    <ChannelMetric icon={<Layers className="size-3.5 text-primary" />} label={tForm('model')}>
                        {modelCount}
                    </ChannelMetric>
                    <ChannelMetric icon={<Key className="size-3.5 text-primary" />} label={tSections('keys')}>
                        {enabledKeyCount}/{channel.keys.length}
                    </ChannelMetric>
                    <ChannelMetric icon={<CheckCircle2 className="size-3.5 text-emerald-500" />} label={tMetrics('successRequests')}>
                        {stats.request_success.formatted.value}
                    </ChannelMetric>
                    <ChannelMetric icon={<XCircle className="size-3.5 text-destructive" />} label={tMetrics('failedRequests')}>
                        {stats.request_failed.formatted.value}
                    </ChannelMetric>
                    <ChannelMetric icon={<DollarSign className="size-3.5 text-primary" />} label={t('totalCost')}>
                        {stats.total_cost.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.total_cost.formatted.unit}</span>
                    </ChannelMetric>
                </dl>
            ) : (
                <dl className="grid grid-cols-1 gap-3">
                    <SummaryMetric icon={<MessageSquare className="h-5 w-5" />} label={t('requestCount')}>
                        {stats.request_count.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.request_count.formatted.unit}</span>
                    </SummaryMetric>
                    <SummaryMetric icon={<DollarSign className="h-5 w-5" />} label={t('totalCost')}>
                        {stats.total_cost.formatted.value}
                        <span className="ml-1 text-xs text-muted-foreground">{stats.total_cost.formatted.unit}</span>
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
            <MorphingDialogTrigger className="w-full">
                {cardBody}
            </MorphingDialogTrigger>

            <MorphingDialogContainer>
                <MorphingDialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] md:max-w-4xl xl:max-w-5xl bg-card text-card-foreground px-3 py-2 sm:px-5 rounded-3xl max-h-[92vh] overflow-y-auto">
                    <CardContent channel={channel} stats={stats} />
                </MorphingDialogContent>
            </MorphingDialogContainer>
        </MorphingDialog>
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
