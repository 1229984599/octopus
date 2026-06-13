'use client';

import { motion } from 'motion/react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Clock, MessageSquare, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import { useTranslations } from '@/lib/translations';
import { useStatsTotal } from '@/api/endpoints/stats';
import { AnimatedNumber } from '@/components/common/AnimatedNumber';
import { EASING } from '@/lib/animations/fluid-transitions';

export function Total() {
    const { data: statsTotalFormatted } = useStatsTotal();
    const t = useTranslations('home.total');
    const successRaw = statsTotalFormatted?.request_success.raw ?? 0;
    const failedRaw = statsTotalFormatted?.request_failed.raw ?? 0;
    const requestRaw = successRaw + failedRaw;
    const successRate = requestRaw > 0 ? (successRaw / requestRaw) * 100 : 0;

    const cards = [
        {
            label: t('requestCount'),
            value: statsTotalFormatted?.request_count.formatted.value,
            unit: statsTotalFormatted?.request_count.formatted.unit,
            icon: MessageSquare,
            tone: 'text-primary bg-primary/10',
        },
        {
            label: t('successRate'),
            value: successRate.toFixed(1),
            unit: '%',
            icon: ShieldCheck,
            tone: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
        },
        {
            label: t('failedRequests'),
            value: statsTotalFormatted?.request_failed.formatted.value,
            unit: statsTotalFormatted?.request_failed.formatted.unit,
            icon: TriangleAlert,
            tone: 'text-destructive bg-destructive/10',
        },
        {
            label: t('totalToken'),
            value: statsTotalFormatted?.total_token.formatted.value,
            unit: statsTotalFormatted?.total_token.formatted.unit,
            icon: Zap,
            tone: 'text-chart-3 bg-chart-3/10',
        },
        {
            label: t('inputTokens'),
            value: statsTotalFormatted?.input_token.formatted.value,
            unit: statsTotalFormatted?.input_token.formatted.unit,
            icon: ArrowDownToLine,
            tone: 'text-chart-2 bg-chart-2/10',
        },
        {
            label: t('outputTokens'),
            value: statsTotalFormatted?.output_token.formatted.value,
            unit: statsTotalFormatted?.output_token.formatted.unit,
            icon: ArrowUpFromLine,
            tone: 'text-chart-4 bg-chart-4/10',
        },
        {
            label: t('timeConsumed'),
            value: statsTotalFormatted?.wait_time.formatted.value,
            unit: statsTotalFormatted?.wait_time.formatted.unit,
            icon: Clock,
            tone: 'text-chart-5 bg-chart-5/10',
        },
    ];

    return (
        <section className="rounded-3xl border border-card-border bg-card p-4 text-card-foreground custom-shadow">
            <div className="mb-4 flex items-center gap-2">
                <Activity className="size-4 text-primary" />
                <h2 className="text-base font-semibold">{t('overview')}</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                {cards.map((card, index) => (
                    <motion.div
                        key={card.label}
                        className="min-w-0 rounded-2xl border border-border/70 bg-background/70 p-3"
                        initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ duration: 0.45, ease: EASING.easeOutExpo, delay: index * 0.04 }}
                    >
                        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${card.tone}`}>
                                <card.icon className="size-4" />
                            </span>
                            <span className="truncate">{card.label}</span>
                        </div>
                        <div className="flex min-w-0 items-baseline gap-1">
                            <span className="truncate text-xl font-semibold tabular-nums">
                                <AnimatedNumber value={card.value} />
                            </span>
                            {card.unit && <span className="shrink-0 text-xs text-muted-foreground">{card.unit}</span>}
                        </div>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
