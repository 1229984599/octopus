'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Check, ChevronDownIcon, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { useModelChannelList, type LLMChannel } from '@/api/endpoints/model';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { getModelIcon } from '@/lib/model-icons';
import { GroupCapability, useCheckGroupItem, type GroupMode } from '@/api/endpoints/group';
import type { MemberCheckState, SelectedMember } from './ItemList';
import { MemberList } from './ItemList';
import { matchesGroupName, memberKey, normalizeKey, MODE_LABELS } from './utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { HelpCircle } from 'lucide-react';
import { toast } from '@/components/common/Toast';



export type GroupEditorValues = {
    name: string;
    match_regex: string;
    mode: GroupMode;
    capability: GroupCapability;
    first_token_time_out: number;
    session_keep_time: number;
    auto_check: boolean;
    members: SelectedMember[];
};

function ModelPickerSection({
    modelChannels,
    selectedMembers,
    onAdd,
    onAutoAdd,
    autoAddDisabled,
}: {
    modelChannels: LLMChannel[];
    selectedMembers: SelectedMember[];
    onAdd: (channel: LLMChannel) => void;
    onAutoAdd: () => void;
    autoAddDisabled: boolean;
}) {
    const t = useTranslations('group');
    const [searchKeyword, setSearchKeyword] = useState('');

    const selectedKeys = useMemo(() => new Set(selectedMembers.map(memberKey)), [selectedMembers]);
    const normalizedSearch = searchKeyword.trim().toLowerCase();

    const channels = useMemo(() => {
        const byId = new Map<number, { id: number; name: string; models: LLMChannel[] }>();
        modelChannels.forEach((mc) => {
            const existing = byId.get(mc.channel_id);
            if (existing) existing.models.push(mc);
            else byId.set(mc.channel_id, { id: mc.channel_id, name: mc.channel_name, models: [mc] });
        });

        return Array.from(byId.values())
            .map((c) => ({ ...c, models: [...c.models].sort((a, b) => a.name.localeCompare(b.name)) }))
            .sort((a, b) => a.id - b.id);
    }, [modelChannels]);

    const filteredChannels = useMemo(() => {
        if (!normalizedSearch) return channels;
        return channels.reduce<typeof channels>((acc, channel) => {
            if (channel.name.toLowerCase().includes(normalizedSearch)) {
                acc.push(channel);
                return acc;
            }

            const models = channel.models.filter((model) => model.name.toLowerCase().includes(normalizedSearch));
            if (models.length > 0) acc.push({ ...channel, models });
            return acc;
        }, []);
    }, [channels, normalizedSearch]);

    return (
        <div className="flex min-h-[14rem] max-h-[18rem] flex-col rounded-xl border border-border/50 bg-muted/30 md:min-h-0 md:max-h-none">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/50">
                <span className="min-w-0 justify-self-start text-sm font-medium text-foreground">
                    {t('form.addItem')}
                </span>

                <div className="relative justify-self-center w-30">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchKeyword}
                        onChange={(event) => setSearchKeyword(event.target.value)}
                        className="h-6 rounded-lg border-border/60 bg-background/70 pl-7 pr-2 text-xs shadow-none focus-visible:border-border/60 focus-visible:ring-0"
                        aria-label="search"
                    />
                </div>

                <button
                    type="button"
                    onClick={onAutoAdd}
                    className={cn(
                        'justify-self-end shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                        autoAddDisabled
                            ? 'text-muted-foreground/50 cursor-not-allowed'
                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    )}
                    disabled={autoAddDisabled}
                    title={t('form.autoAdd')}
                >
                    <Sparkles className="size-3.5" />
                    <span>{t('form.autoAdd')}</span>
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2">
                <Accordion type="multiple" className="w-full space-y-2">
                    {filteredChannels.map((channel) => {
                        const total = channel.models.length;
                        const selectedCount = channel.models.reduce(
                            (acc, m) => acc + (selectedKeys.has(memberKey(m)) ? 1 : 0),
                            0
                        );
                        const available = total - selectedCount;

                        return (
                            <AccordionItem key={channel.id} value={`channel-${channel.id}`}>
                                <AccordionPrimitive.Header className="rounded-lg bg-muted sticky top-0 z-10 flex px-2 overflow-hidden">
                                    <AccordionPrimitive.Trigger className="flex flex-1 min-w-0 items-center gap-4 py-4 text-left text-sm transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180">
                                        <span className="truncate">{channel.name}</span>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {available}/{total}
                                        </span>
                                        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 transition-transform duration-200" />
                                    </AccordionPrimitive.Trigger>
                                </AccordionPrimitive.Header>
                                <AccordionContent className="px-2 pt-2">
                                    <div className="flex flex-col gap-1.5">
                                        {channel.models.map((m) => {
                                            const isSelected = selectedKeys.has(memberKey(m));
                                            const { Avatar } = getModelIcon(m.name);
                                            return (
                                                <button
                                                    key={memberKey(m)}
                                                    type="button"
                                                    onClick={() => !isSelected && onAdd(m)}
                                                    disabled={isSelected}
                                                    className={cn(
                                                        'w-full flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-left transition-colors',
                                                        isSelected ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted'
                                                    )}
                                                >
                                                    <span className="flex items-center gap-2 min-w-0">
                                                        <Avatar size={16} />
                                                        <span className="text-sm font-medium truncate">{m.name}</span>
                                                    </span>

                                                    <span className="shrink-0 text-muted-foreground">
                                                        {isSelected ? (
                                                            <Check className="size-4 text-primary" />
                                                        ) : (
                                                            <Plus className="size-4" />
                                                        )}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        );
                    })}
                </Accordion>
            </div>
        </div>
    );
}

function SortSection({
    members,
    onReorder,
    onRemove,
    onWeightChange,
    onRetryCountChange,
    onCheck,
    onCheckAll,
    onDeleteFailed,
    checkingMemberId,
    checkingAll,
    checkResults,
    removingIds,
    showWeight,
    onClear,
}: {
    members: SelectedMember[];
    onReorder: (members: SelectedMember[]) => void;
    onRemove: (id: string) => void;
    onWeightChange: (id: string, weight: number) => void;
    onRetryCountChange: (id: string, retryCount: number) => void;
    onCheck?: (member: SelectedMember) => void;
    onCheckAll?: () => void;
    onDeleteFailed?: () => void;
    checkingMemberId?: string | null;
    checkingAll?: boolean;
    checkResults?: Record<string, MemberCheckState>;
    removingIds: Set<string>;
    showWeight: boolean;
    onClear: () => void;
}) {
    const t = useTranslations('group');
    const failedCount = Object.values(checkResults ?? {}).filter((result) => !result.ok).length;
    const checkableCount = members.filter((member) => member.item_id).length;

    return (
        <div className="flex min-h-[14rem] max-h-[18rem] flex-col rounded-xl border border-border/50 bg-muted/30 md:min-h-0 md:max-h-none">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/30 bg-muted/50">
                <span className="text-sm font-medium text-foreground">
                    {t('form.items')}
                    {members.length > 0 && (
                        <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                            ({members.length})
                        </span>
                    )}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                    {onCheckAll && (
                        <button
                            type="button"
                            onClick={onCheckAll}
                            disabled={checkingAll || checkableCount === 0}
                            className={cn(
                                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                checkingAll || checkableCount === 0
                                    ? 'text-muted-foreground/50 cursor-not-allowed'
                                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                            )}
                            title={t('form.checkAll')}
                        >
                            <RefreshCw className={cn('size-3.5', checkingAll && 'animate-spin')} />
                            <span>{t('form.checkAll')}</span>
                        </button>
                    )}
                    {onDeleteFailed && (
                        <button
                            type="button"
                            onClick={onDeleteFailed}
                            disabled={failedCount === 0}
                            className={cn(
                                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                                failedCount === 0
                                    ? 'text-muted-foreground/50 cursor-not-allowed'
                                    : 'hover:bg-destructive/10 text-destructive'
                            )}
                            title={t('form.deleteFailed')}
                        >
                            <Trash2 className="size-3.5" />
                            <span>{t('form.deleteFailed')}</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={members.length === 0}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                            members.length === 0
                                ? 'text-muted-foreground/50 cursor-not-allowed'
                                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                        )}
                        title={t('form.clear')}
                    >
                        <Trash2 className="size-3.5" />
                        <span>{t('form.clear')}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0">
                <MemberList
                    members={members}
                    onReorder={onReorder}
                    onRemove={onRemove}
                    onWeightChange={onWeightChange}
                    onRetryCountChange={onRetryCountChange}
                    onCheck={onCheck}
                    checkingMemberId={checkingMemberId}
                    checkResults={checkResults}
                    removingIds={removingIds}
                    showWeight={showWeight}
                    showConfirmDelete={false}
                />
            </div>
        </div>
    );
}

export function GroupEditor({
    groupId,
    initial,
    submitText,
    submittingText,
    isSubmitting,
    onSubmit,
    onCancel,
}: {
    groupId?: number;
    initial?: Partial<GroupEditorValues>;
    submitText: string;
    submittingText: string;
    isSubmitting: boolean;
    onSubmit: (values: GroupEditorValues) => void;
    onCancel?: () => void;
}) {
    const t = useTranslations('group');
    const { data: modelChannels = [] } = useModelChannelList();
    const checkGroupItem = useCheckGroupItem();

    const [groupName, setGroupName] = useState(initial?.name ?? '');
    const [matchRegex, setMatchRegex] = useState(initial?.match_regex ?? '');
    const [mode, setMode] = useState<GroupMode>((initial?.mode ?? 1) as GroupMode);
    const [capability, setCapability] = useState<GroupCapability>(initial?.capability ?? GroupCapability.Auto);
    const [firstTokenTimeOut, setFirstTokenTimeOut] = useState<number>(initial?.first_token_time_out ?? 0);
    const [sessionKeepTime, setSessionKeepTime] = useState<number>(initial?.session_keep_time ?? 0);
    const [autoCheck, setAutoCheck] = useState<boolean>(initial?.auto_check ?? true);
    const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>(initial?.members ?? []);
    const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
    const [checkingMemberId, setCheckingMemberId] = useState<string | null>(null);
    const [checkingAll, setCheckingAll] = useState(false);
    const [checkResults, setCheckResults] = useState<Record<string, MemberCheckState>>({});

    const groupKey = normalizeKey(groupName);
    const regexKey = matchRegex.trim();

    const { matchedModelChannels, regexError } = useMemo(() => {
        const parseRegex = (input: string): RegExp => {
            const inlineMatch = input.match(/^\(\?([ism]+)\)(.+)$/);
            if (inlineMatch) {
                const flagMap: Record<string, string> = { i: 'i', s: 's', m: 'm' };
                const flags = inlineMatch[1].split('').map(f => flagMap[f] || '').join('');
                return new RegExp(inlineMatch[2], flags);
            }

            return new RegExp(input);
        };

        if (regexKey) {
            try {
                const re = parseRegex(regexKey);
                return { matchedModelChannels: modelChannels.filter((mc) => re.test(mc.name)), regexError: '' };
            } catch (e) {
                return { matchedModelChannels: [], regexError: (e as Error)?.message ?? 'Invalid regex' };
            }
        }
        if (!groupKey) return { matchedModelChannels: [], regexError: '' };
        return { matchedModelChannels: modelChannels.filter((mc) => matchesGroupName(mc.name, groupKey)), regexError: '' };
    }, [groupKey, regexKey, modelChannels]);

    const handleAddMember = useCallback((channel: LLMChannel) => {
        const key = memberKey(channel);
        setSelectedMembers((prev) => {
            if (prev.some((m) => m.id === key)) return prev;
            return [...prev, { ...channel, id: key, weight: 1, retry_count: 0 }];
        });
    }, []);

    const autoAddDisabled = useMemo(() => {
        if ((!regexKey && !groupKey) || regexError || matchedModelChannels.length === 0) return true;
        const existing = new Set(selectedMembers.map((m) => m.id));
        return matchedModelChannels.every((mc) => existing.has(memberKey(mc)));
    }, [groupKey, regexKey, regexError, matchedModelChannels, selectedMembers]);

    const handleAutoAdd = useCallback(() => {
        if (matchedModelChannels.length === 0) return;
        setSelectedMembers((prev) => {
            const existing = new Set(prev.map((m) => m.id));
            const toAdd = matchedModelChannels
                .filter((mc) => !existing.has(memberKey(mc)))
                .map((mc) => ({ ...mc, id: memberKey(mc), weight: 1, retry_count: 0 }));
            return toAdd.length ? [...prev, ...toAdd] : prev;
        });
    }, [matchedModelChannels]);

    const handleWeightChange = useCallback((id: string, weight: number) => {
        setSelectedMembers((prev) => prev.map((m) => m.id === id ? { ...m, weight } : m));
    }, []);

    const handleRetryCountChange = useCallback((id: string, retryCount: number) => {
        setSelectedMembers((prev) => prev.map((m) => m.id === id ? { ...m, retry_count: retryCount } : m));
    }, []);

    const handleRemoveMember = useCallback((id: string) => {
        setRemovingIds((prev) => new Set(prev).add(id));
        setCheckResults((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setTimeout(() => {
            setSelectedMembers((prev) => prev.filter((m) => m.id !== id));
            setRemovingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        }, 200);
    }, []);

    const handleClearMembers = useCallback(() => {
        setSelectedMembers([]);
        setRemovingIds(new Set());
        setCheckResults({});
    }, []);

    const runMemberCheck = useCallback(async (member: SelectedMember): Promise<MemberCheckState> => {
        if (!groupId || !member.item_id) {
            return { ok: false, message: t('form.checkUnavailable') };
        }
        const results = await checkGroupItem.mutateAsync({
            group_id: groupId,
            item_id: member.item_id,
            model: member.name,
            capability,
        });
        const okCount = results.filter((result) => result.ok).length;
        const detail = results.length > 0
            ? results.map((result, index) => {
                const status = result.status_code > 0 ? `HTTP ${result.status_code}` : '无 HTTP 状态';
                const error = result.error ? ` - ${result.error}` : '';
                return `Key ${index + 1}: ${result.ok ? '正常' : '异常'}（${status}${error}）`;
            }).join('\n')
            : t('form.checkNoResult');
        return {
            ok: okCount > 0,
            message: `${okCount}/${results.length}`,
            detail,
        };
    }, [capability, checkGroupItem, groupId, t]);

    const handleCheckMember = useCallback(async (member: SelectedMember) => {
        setCheckingMemberId(member.id);
        try {
            const result = await runMemberCheck(member);
            setCheckResults((prev) => ({ ...prev, [member.id]: result }));
            toast.success(result.ok ? t('toast.checkDone') : t('toast.checkFailed'), { description: result.message });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setCheckResults((prev) => ({ ...prev, [member.id]: { ok: false, message, detail: message } }));
            toast.error(t('toast.checkFailed'), { description: message });
        } finally {
            setCheckingMemberId(null);
        }
    }, [runMemberCheck, t]);

    const handleCheckAllMembers = useCallback(async () => {
        const checkableMembers = selectedMembers.filter((member) => member.item_id);
        if (checkableMembers.length === 0) return;
        setCheckingAll(true);
        const nextResults: Record<string, MemberCheckState> = {};
        try {
            for (const member of checkableMembers) {
                setCheckingMemberId(member.id);
                try {
                    nextResults[member.id] = await runMemberCheck(member);
                } catch (error) {
                    nextResults[member.id] = {
                        ok: false,
                        message: error instanceof Error ? error.message : String(error),
                        detail: error instanceof Error ? error.message : String(error),
                    };
                }
            }
            setCheckResults((prev) => ({ ...prev, ...nextResults }));
            const okCount = Object.values(nextResults).filter((result) => result.ok).length;
            toast.success(t('toast.checkDone'), { description: `${okCount}/${checkableMembers.length}` });
        } finally {
            setCheckingMemberId(null);
            setCheckingAll(false);
        }
    }, [runMemberCheck, selectedMembers, t]);

    const handleDeleteFailedMembers = useCallback(() => {
        const failedIds = new Set(
            Object.entries(checkResults)
                .filter(([, result]) => !result.ok)
                .map(([id]) => id)
        );
        if (failedIds.size === 0) return;
        setSelectedMembers((prev) => prev.filter((member) => !failedIds.has(member.id)));
        setCheckResults((prev) => {
            const next = { ...prev };
            failedIds.forEach((id) => delete next[id]);
            return next;
        });
    }, [checkResults]);

    const isValid = groupKey.length > 0 && selectedMembers.length > 0 && !regexError;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isValid) return;
        onSubmit({
            name: groupName,
            match_regex: regexKey,
            mode,
            capability,
            first_token_time_out: firstTokenTimeOut,
            session_keep_time: sessionKeepTime,
            auto_check: autoCheck,
            members: selectedMembers,
        });
    };


    return (
        <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 md:overflow-hidden">
                <FieldGroup className="flex min-h-0 flex-col gap-4 md:h-full">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <Field>
                            <FieldLabel htmlFor="group-name">{t('form.name')}</FieldLabel>
                            <Input
                                id="group-name"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                className="rounded-xl"
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="group-match-regex">{t('form.matchRegex')}</FieldLabel>
                            <Input
                                id="group-match-regex"
                                value={matchRegex}
                                onChange={(e) => setMatchRegex(e.target.value)}
                                className="rounded-xl"
                                placeholder={t('form.matchRegexPlaceholder')}
                            />
                            {regexError && (
                                <p className="mt-1 text-xs text-destructive">
                                    {t('form.matchRegexInvalid')}: {regexError}
                                </p>
                            )}
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="group-first-token-time-out">
                                {t('form.firstTokenTimeOut')}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('form.firstTokenTimeOutHint')}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </FieldLabel>
                            <Input
                                id="group-first-token-time-out"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                value={String(firstTokenTimeOut)}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw.trim() === '') {
                                        setFirstTokenTimeOut(0);
                                        return;
                                    }
                                    const n = Number.parseInt(raw, 10);
                                    setFirstTokenTimeOut(Number.isFinite(n) && n > 0 ? n : 0);
                                }}
                                className="rounded-xl"
                            />
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="group-session-keep-time">
                                {t('form.sessionKeepTime')}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('form.sessionKeepTimeHint')}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </FieldLabel>
                            <Input
                                id="group-session-keep-time"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                value={String(sessionKeepTime)}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw.trim() === '') {
                                        setSessionKeepTime(0);
                                        return;
                                    }
                                    const n = Number.parseInt(raw, 10);
                                    setSessionKeepTime(Number.isFinite(n) && n > 0 ? n : 0);
                                }}
                                className="rounded-xl"
                            />
                        </Field>

                    </div>

                    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/50 bg-muted/30 p-1">
                        {[
                            [GroupCapability.Auto, '自动'],
                            [GroupCapability.Chat, '文本'],
                            [GroupCapability.ResponsesCodex, 'Responses/Codex'],
                            [GroupCapability.Embedding, 'Embedding'],
                            [GroupCapability.Image, '图片'],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setCapability(value as GroupCapability)}
                                className={cn(
                                    'h-7 rounded-lg px-2 text-xs transition-colors',
                                    capability === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="grid flex-1 grid-cols-4 gap-1">
                            {([1, 2, 3, 4] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMode(m)}
                                    className={cn(
                                        'h-7 rounded-lg px-2 text-xs transition-colors',
                                        mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                                    )}
                                >
                                    {t(`mode.${MODE_LABELS[m]}`)}
                                </button>
                            ))}
                        </div>

                        <label
                            htmlFor="group-auto-check"
                            className="flex h-7 shrink-0 items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/70 px-2.5 text-xs text-muted-foreground sm:w-auto"
                        >
                            <span className="whitespace-nowrap">{t('form.autoCheck')}</span>
                            <Switch
                                id="group-auto-check"
                                checked={autoCheck}
                                onCheckedChange={setAutoCheck}
                                className="scale-90"
                            />
                        </label>
                    </div>

                    <div className="min-h-0 md:flex-1">
                        <div className="grid min-h-0 grid-cols-1 gap-4 md:h-full md:grid-cols-2">
                            <ModelPickerSection
                                modelChannels={modelChannels}
                                selectedMembers={selectedMembers}
                                onAdd={handleAddMember}
                                onAutoAdd={handleAutoAdd}
                                autoAddDisabled={autoAddDisabled}
                            />
                            <SortSection
                                members={selectedMembers}
                                onReorder={setSelectedMembers}
                                onRemove={handleRemoveMember}
                                onWeightChange={handleWeightChange}
                                onRetryCountChange={handleRetryCountChange}
                                onCheck={groupId ? handleCheckMember : undefined}
                                onCheckAll={groupId ? handleCheckAllMembers : undefined}
                                onDeleteFailed={groupId ? handleDeleteFailedMembers : undefined}
                                checkingMemberId={checkingMemberId}
                                checkingAll={checkingAll}
                                checkResults={checkResults}
                                removingIds={removingIds}
                                showWeight={mode === 4}
                                onClear={handleClearMembers}
                            />
                        </div>
                    </div>
                </FieldGroup>
            </div>

            <div className="pt-4 mt-auto shrink-0">
                <div className="flex gap-2">
                    {onCancel && (
                        <Button type="button" variant="secondary" className="flex-1 rounded-xl h-11" onClick={onCancel}>
                            {t('detail.actions.cancel')}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        disabled={!isValid || isSubmitting}
                        className="flex-1 rounded-xl h-11"
                    >
                        {isSubmitting ? submittingText : submitText}
                    </Button>
                </div>
            </div>
        </form>
    );
}
