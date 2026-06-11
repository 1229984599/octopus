'use client';

import { useState, useMemo, useCallback, type ButtonHTMLAttributes } from 'react';
import { GripVertical, Trash2, X, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { type Group, useDeleteGroup, useUpdateGroup } from '@/api/endpoints/group';
import { useModelChannelList } from '@/api/endpoints/model';
import { useChannelList } from '@/api/endpoints/channel';
import { useTranslations } from '@/lib/translations';
import { cn } from '@/lib/utils';
import { toast } from '@/components/common/Toast';
import { CopyIconButton } from '@/components/common/CopyButton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import type { SelectedMember } from './ItemList';
import { GroupEditor, type GroupEditorValues } from './Editor';
import { buildChannelNameByModelKey, modelChannelKey, MODE_LABELS } from './utils';
import { GroupCapability, GroupMode, type GroupUpdateRequest } from '@/api/endpoints/group';
import { openChannelEditor } from '@/components/modules/channel/navigation-store';
import {
    MorphingDialog,
    MorphingDialogClose,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogDescription,
    MorphingDialogTitle,
    MorphingDialogTrigger,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';

interface EditDialogContentProps {
    group: Group;
    displayMembers: SelectedMember[];
    isSubmitting: boolean;
    onSubmit: (values: GroupEditorValues, onDone?: () => void) => void;
    onOpenMemberChannel: (member: SelectedMember) => void;
}

function EditDialogContent({ group, displayMembers, isSubmitting, onSubmit, onOpenMemberChannel }: EditDialogContentProps) {
    const { setIsOpen } = useMorphingDialog();
    const t = useTranslations('group');
    return (
        <>
            <MorphingDialogTitle className="shrink-0">
                <header className="mb-3 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-card-foreground">
                        {t('detail.actions.edit')}
                    </h2>
                    <MorphingDialogClose className="relative right-0 top-0" />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription className="min-h-0 flex-1 overflow-hidden">
                <GroupEditor
                    key={`edit-group-${group.id}`}
                    groupId={group.id}
                    initial={{
                        name: group.name,
                        match_regex: group.match_regex ?? '',
                        mode: group.mode,
                        capability: group.capability ?? GroupCapability.Auto,
                        first_token_time_out: group.first_token_time_out ?? 0,
                        session_keep_time: group.session_keep_time ?? 0,
                        auto_check: group.auto_check ?? true,
                        members: displayMembers,
                        excludedItems: group.excluded_items ?? [],
                    }}
                    submitText={t('detail.actions.save')}
                    submittingText={t('create.submitting')}
                    isSubmitting={isSubmitting}
                    onCancel={() => setIsOpen(false)}
                    onSubmit={(v) => onSubmit(v, () => setIsOpen(false))}
                    onOpenMemberChannel={(member) => {
                        setIsOpen(false);
                        onOpenMemberChannel(member);
                    }}
                />
            </MorphingDialogDescription>
        </>
    );
}

export function GroupCard({
    group,
    dragHandleProps,
    dragDisabled = false,
}: {
    group: Group;
    dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement> | null;
    dragDisabled?: boolean;
}) {
    const t = useTranslations('group');
    const updateGroup = useUpdateGroup();
    const deleteGroup = useDeleteGroup();
    const { data: modelChannels = [] } = useModelChannelList();
    const { data: channelsData = [] } = useChannelList();

    const [confirmDelete, setConfirmDelete] = useState(false);
    const channelNameByKey = useMemo(() => buildChannelNameByModelKey(modelChannels), [modelChannels]);
    const channelNameById = useMemo(() => {
        const map = new Map<number, string>();
        channelsData.forEach((item) => map.set(item.raw.id, item.raw.name));
        return map;
    }, [channelsData]);
    const enabledByKey = useMemo(() => {
        const map = new Map<string, boolean>();
        modelChannels.forEach((mc) => {
            map.set(modelChannelKey(mc.channel_id, mc.name), mc.enabled);
        });
        return map;
    }, [modelChannels]);

    const displayMembers = useMemo((): SelectedMember[] =>
        [...(group.items || [])]
            .sort((a, b) => a.priority - b.priority)
            .map((item) => ({
                id: modelChannelKey(item.channel_id, item.model_name),
                name: item.model_name,
                enabled: enabledByKey.get(modelChannelKey(item.channel_id, item.model_name)) ?? true,
                channel_id: item.channel_id,
                channel_name: channelNameByKey.get(modelChannelKey(item.channel_id, item.model_name))
                    ?? channelNameById.get(item.channel_id)
                    ?? `Channel ${item.channel_id}`,
                item_id: item.id,
                weight: item.weight,
                retry_count: item.retry_count ?? 0,
                check_ok: item.last_check_ok,
                check_message: item.last_check_message,
            })),
        [group.items, channelNameById, channelNameByKey, enabledByKey]
    );

    const onSuccess = useCallback(() => toast.success(t('toast.updated')), [t]);
    const onError = useCallback((error: Error) => toast.error(t('toast.updateFailed'), { description: error.message }), [t]);

    // Avoid UI flicker: drag-reorder also uses the same mutation, so only "mode switch" should lock mode buttons.
    const isUpdatingMode = (() => {
        if (!updateGroup.isPending) return false;
        const v = updateGroup.variables;
        if (typeof v !== 'object' || v === null) return false;
        return 'mode' in v && typeof (v as { mode?: unknown }).mode === 'number';
    })();

    const handleOpenMemberChannel = useCallback((member: SelectedMember) => {
        openChannelEditor(member.channel_id);
    }, []);

    const handleSubmitEdit = useCallback((values: GroupEditorValues, onDone?: () => void) => {
        if (!group.id) return;

        const originalItems = [...(group.items || [])].sort((a, b) => a.priority - b.priority);
        const originalById = new Map<number, { priority: number; weight: number; retry_count: number }>();
        const originalIds = new Set<number>();
        originalItems.forEach((it) => {
            if (typeof it.id === 'number') {
                originalIds.add(it.id);
                originalById.set(it.id, { priority: it.priority, weight: it.weight, retry_count: it.retry_count ?? 0 });
            }
        });

        const newIds = new Set<number>();
        values.members.forEach((m) => { if (typeof m.item_id === 'number') newIds.add(m.item_id); });

        const items_to_delete = Array.from(originalIds).filter((id) => !newIds.has(id));

        const items_to_add = values.members
            .map((m, idx) => ({ m, priority: idx + 1 }))
            .filter(({ m }) => typeof m.item_id !== 'number')
            .map(({ m, priority }) => ({
                channel_id: m.channel_id,
                model_name: m.name,
                priority,
                weight: m.weight ?? 1,
                retry_count: m.retry_count ?? 0,
            }));

        const items_to_update = values.members
            .map((m, idx) => ({ m, priority: idx + 1 }))
            .filter(({ m }) => typeof m.item_id === 'number')
            .map(({ m, priority }) => {
                const id = m.item_id!;
                const orig = originalById.get(id);
                const weight = m.weight ?? 1;
                const retry_count = m.retry_count ?? 0;
                if (!orig) return null;
                if (orig.priority === priority && orig.weight === weight && orig.retry_count === retry_count) return null;
                return { id, priority, weight, retry_count };
            })
            .filter((x): x is { id: number; priority: number; weight: number; retry_count: number } => x !== null);

        const payload: GroupUpdateRequest = { id: group.id };
        const nextName = values.name.trim();
        const nextRegex = (values.match_regex ?? '').trim();
        const nextFirstTokenTimeOut = values.first_token_time_out ?? 0;
        const nextSessionKeepTime = values.session_keep_time ?? 0;

        if (nextName && nextName !== group.name) payload.name = nextName;
        if (values.mode !== group.mode) payload.mode = values.mode;
        if (values.capability !== (group.capability ?? GroupCapability.Auto)) payload.capability = values.capability;
        if (nextRegex !== (group.match_regex ?? '')) payload.match_regex = nextRegex;
        if (nextFirstTokenTimeOut !== (group.first_token_time_out ?? 0)) payload.first_token_time_out = nextFirstTokenTimeOut;
        if (nextSessionKeepTime !== (group.session_keep_time ?? 0)) payload.session_keep_time = nextSessionKeepTime;
        if (values.auto_check !== (group.auto_check ?? true)) payload.auto_check = values.auto_check;
        if (items_to_add.length) payload.items_to_add = items_to_add;
        if (items_to_update.length) payload.items_to_update = items_to_update;
        if (items_to_delete.length) payload.items_to_delete = items_to_delete;

        if (Object.keys(payload).length === 1) {
            onDone?.();
            return;
        }

        updateGroup.mutate(payload, {
            onSuccess: () => {
                onSuccess();
                onDone?.();
            },
            onError,
        });
    }, [group.auto_check, group.capability, group.first_token_time_out, group.session_keep_time, group.id, group.items, group.match_regex, group.mode, group.name, onSuccess, onError, updateGroup]);

    const capabilityLabel = {
        [GroupCapability.Auto]: '自动',
        [GroupCapability.Chat]: '文本',
        [GroupCapability.ResponsesCodex]: 'Responses/Codex',
        [GroupCapability.Embedding]: 'Embedding',
        [GroupCapability.Image]: '图片',
    }[group.capability ?? GroupCapability.Auto];

    const memberCount = group.items?.length ?? 0;
    const excludedCount = group.excluded_items?.length ?? 0;
    const failedCheckCount = (group.items ?? []).filter((item) => item.last_check_ok === false).length;
    const disabledCount = displayMembers.filter((member) => member.enabled === false).length;

    return (
        <article data-group-card className="flex flex-col rounded-3xl border border-border bg-card text-card-foreground p-4 custom-shadow">
            <header className="flex items-start justify-between mb-3 relative overflow-visible rounded-xl -mx-1 px-1 -my-1 py-1">
                <div className="relative flex flex-1 items-start gap-1.5 mr-2 min-w-0 group/title">
                    <button
                        type="button"
                        disabled={dragDisabled || !dragHandleProps}
                        className={cn(
                            'mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors',
                            dragDisabled || !dragHandleProps ? 'cursor-not-allowed opacity-40' : 'cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing'
                        )}
                        title={t('detail.actions.dragSort')}
                        {...(dragHandleProps ?? {})}
                    >
                        <GripVertical className="size-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                        <Tooltip side="top" sideOffset={10} align="center">
                            <TooltipTrigger asChild>
                                <h3 className="text-lg font-bold truncate">{group.name}</h3>
                            </TooltipTrigger>
                            <TooltipContent key={group.name}>{group.name}</TooltipContent>
                        </Tooltip>
                        <span className="mt-1 inline-flex max-w-full rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {capabilityLabel}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <MorphingDialog>
                        <MorphingDialogTrigger className="p-1.5 rounded-lg transition-colors hover:bg-muted text-muted-foreground hover:text-foreground">
                            <Tooltip side="top" sideOffset={10} align="center">
                                <TooltipTrigger asChild>
                                    <Pencil className="size-4" />
                                </TooltipTrigger>
                                <TooltipContent>{t('detail.actions.edit')}</TooltipContent>
                            </Tooltip>
                        </MorphingDialogTrigger>

                        <MorphingDialogContainer>
                            <MorphingDialogContent className="relative flex h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-full flex-col overflow-hidden rounded-3xl bg-card px-4 py-4 text-card-foreground sm:px-6 md:w-screen md:max-w-4xl">
                                <EditDialogContent
                                    group={group}
                                    displayMembers={displayMembers}
                                    isSubmitting={updateGroup.isPending}
                                    onSubmit={handleSubmitEdit}
                                    onOpenMemberChannel={handleOpenMemberChannel}
                                />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>

                    <Tooltip side="top" sideOffset={10} align="center">
                        <TooltipTrigger>
                            <CopyIconButton
                                text={group.name}
                                className="p-1.5 rounded-lg transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
                                copyIconClassName="size-4"
                                checkIconClassName="size-4 text-primary"
                            />
                        </TooltipTrigger>
                        <TooltipContent>{t('detail.actions.copyName')}</TooltipContent>
                    </Tooltip>
                    {!confirmDelete && (
                        <Tooltip side="top" sideOffset={10} align="center">
                            <TooltipTrigger>
                                <motion.button layoutId={`delete-btn-group-${group.id}`} type="button" onClick={() => setConfirmDelete(true)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 className="size-4" />
                                </motion.button>
                            </TooltipTrigger>
                            <TooltipContent>{t('detail.actions.delete')}</TooltipContent>
                        </Tooltip>
                    )}
                </div>

                <AnimatePresence>
                    {confirmDelete && (
                        <motion.div layoutId={`delete-btn-group-${group.id}`} className="absolute inset-0 flex items-center justify-center gap-2 bg-destructive p-2 rounded-xl" transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                            <button type="button" onClick={() => setConfirmDelete(false)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive-foreground/20 text-destructive-foreground transition-all hover:bg-destructive-foreground/30 active:scale-95">
                                <X className="size-4" />
                            </button>
                            <button type="button" onClick={() => group.id && deleteGroup.mutate(group.id, { onSuccess: () => toast.success(t('toast.deleted')) })} disabled={deleteGroup.isPending} className="flex-1 h-7 flex items-center justify-center gap-2 rounded-lg bg-destructive-foreground text-destructive text-sm font-semibold transition-all hover:bg-destructive-foreground/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
                                <Trash2 className="size-3.5" />
                                {t('detail.actions.confirmDelete')}
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </header>

            {/* Mode: quick switch (no need to enter Edit) */}
            <div className="flex gap-1 mb-3">
                {([GroupMode.RoundRobin, GroupMode.Random, GroupMode.Failover, GroupMode.Weighted] as const).map((m) => (
                    <button
                        key={m}
                        type="button"
                        aria-disabled={isUpdatingMode || !group.id}
                        onClick={() => {
                            if (isUpdatingMode || !group.id) return;
                            if (m === group.mode) return;
                            updateGroup.mutate({ id: group.id!, mode: m }, { onSuccess, onError });
                        }}
                        className={cn(
                            'flex-1 py-1 text-xs rounded-lg transition-colors',
                            group.mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80',
                            // Keep visuals stable (no opacity/disabled flicker) while still preventing double-submit via onClick guard.
                            (!group.id) && 'cursor-not-allowed opacity-50'
                        )}
                    >
                        {t(`mode.${MODE_LABELS[m]}`)}
                    </button>
                ))}
            </div>

            <section className="grid grid-cols-2 gap-2 rounded-xl border border-border/50 bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-background/70 px-2.5 py-2">
                    <div className="text-[10px] text-muted-foreground">{t('card.modelCount')}</div>
                    <div className="mt-1 text-base font-semibold text-foreground">{memberCount}</div>
                </div>
                <div className="rounded-lg bg-background/70 px-2.5 py-2">
                    <div className="text-[10px] text-muted-foreground">{t('card.excludedCount')}</div>
                    <div className="mt-1 text-base font-semibold text-foreground">{excludedCount}</div>
                </div>
                <div className="rounded-lg bg-background/70 px-2.5 py-2">
                    <div className="text-[10px] text-muted-foreground">{t('card.failedCount')}</div>
                    <div className={cn('mt-1 text-base font-semibold', failedCheckCount > 0 ? 'text-destructive' : 'text-foreground')}>
                        {failedCheckCount}
                    </div>
                </div>
                <div className="rounded-lg bg-background/70 px-2.5 py-2">
                    <div className="text-[10px] text-muted-foreground">{t('card.disabledCount')}</div>
                    <div className={cn('mt-1 text-base font-semibold', disabledCount > 0 ? 'text-destructive' : 'text-foreground')}>
                        {disabledCount}
                    </div>
                </div>
            </section>
        </article >
    );
}

