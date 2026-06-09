'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    AutoGroupType,
    GroupMode,
    type BatchUpdateChannelRequest,
    type Channel as ChannelType,
    useBatchDeleteChannels,
    useBatchUpdateChannels,
    useChannelList,
    useDeleteChannelTag,
    useRenameChannelTag,
} from '@/api/endpoints/channel';
import { Card } from './Card';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { VirtualizedGrid } from '@/components/common/VirtualizedGrid';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, CheckSquare, Edit3, Plus, Search, Tags, Trash2, X } from 'lucide-react';
import { useTranslations } from '@/lib/translations';
import { useChannelNavigationStore } from './navigation-store';

type ChannelListItem = {
    raw: ChannelType;
    formatted: Parameters<typeof Card>[0]['stats'];
};

type BatchFieldState = {
    enabled: boolean;
    tags: boolean;
    key_mode: boolean;
    rpm: boolean;
    proxy: boolean;
    auto_sync: boolean;
    auto_check: boolean;
    auto_group: boolean;
};

const DEFAULT_BATCH_FIELDS: BatchFieldState = {
    enabled: false,
    tags: false,
    key_mode: false,
    rpm: false,
    proxy: false,
    auto_sync: false,
    auto_check: false,
    auto_group: false,
};

export function Channel() {
    const { data: channelsData } = useChannelList();
    const batchDeleteChannels = useBatchDeleteChannels();
    const pageKey = 'channel' as const;
    const searchTerm = useSearchStore((s) => s.getSearchTerm(pageKey));
    const layout = useToolbarViewOptionsStore((s) => s.getLayout(pageKey));
    const sortField = useToolbarViewOptionsStore((s) => s.getSortField(pageKey));
    const sortOrder = useToolbarViewOptionsStore((s) => s.getSortOrder(pageKey));
    const filter = useToolbarViewOptionsStore((s) => s.channelFilter);
    const pendingEditChannelId = useChannelNavigationStore((s) => s.editChannelId);
    const clearPendingEditChannel = useChannelNavigationStore((s) => s.clearEditChannel);
    const t = useTranslations('channel.batch');

    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [selectedTag, setSelectedTag] = useState<string>('all');
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [tagManagerOpen, setTagManagerOpen] = useState(false);

    const sortedChannels = useMemo(() => {
        if (!channelsData) return [];
        return [...channelsData].sort((a, b) => {
            const diff = sortField === 'name'
                ? a.raw.name.localeCompare(b.raw.name)
                : a.raw.id - b.raw.id;
            return sortOrder === 'asc' ? diff : -diff;
        });
    }, [channelsData, sortField, sortOrder]);

    const visibleChannels = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        const bySearch = !term
            ? sortedChannels
            : sortedChannels.filter((c) => {
                const haystack = [
                    c.raw.name,
                    ...(c.raw.base_urls ?? []).map((item) => item.url),
                    ...(c.raw.tags ?? []),
                ].join('\n').toLowerCase();
                return haystack.includes(term);
            });

        const byTag = selectedTag === 'all'
            ? bySearch
            : bySearch.filter((c) => (c.raw.tags ?? []).includes(selectedTag));

        if (filter === 'enabled') return byTag.filter((c) => c.raw.enabled);
        if (filter === 'disabled') return byTag.filter((c) => !c.raw.enabled);

        return byTag;
    }, [sortedChannels, searchTerm, filter, selectedTag]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        sortedChannels.forEach((item) => {
            (item.raw.tags ?? []).forEach((tag) => {
                if (tag.trim()) tags.add(tag);
            });
        });
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    }, [sortedChannels]);

    const visibleChannelIds = useMemo(() => visibleChannels.map((item) => item.raw.id), [visibleChannels]);
    const selectedIdArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
    const allVisibleSelected = visibleChannelIds.length > 0 && visibleChannelIds.every((id) => selectedIds.has(id));
    const selectedChannels = useMemo(
        () => sortedChannels.filter((item) => selectedIds.has(item.raw.id)),
        [selectedIds, sortedChannels]
    );
    const hasActiveFilters = Boolean(searchTerm.trim()) || filter !== 'all' || selectedTag !== 'all';
    const pendingEditIndex = useMemo(
        () => pendingEditChannelId ? visibleChannels.findIndex((item) => item.raw.id === pendingEditChannelId) : -1,
        [pendingEditChannelId, visibleChannels]
    );

    useEffect(() => {
        if (!channelsData) return;
        const existingIds = new Set(channelsData.map((item) => item.raw.id));
        setSelectedIds((prev) => {
            const next = new Set(Array.from(prev).filter((id) => existingIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [channelsData]);

    useEffect(() => {
        if (selectedTag === 'all') return;
        if (!availableTags.includes(selectedTag)) setSelectedTag('all');
    }, [availableTags, selectedTag]);

    useEffect(() => {
        if (!pendingEditChannelId || !channelsData) return;
        const exists = channelsData.some((item) => item.raw.id === pendingEditChannelId);
        if (!exists) {
            clearPendingEditChannel(pendingEditChannelId);
            return;
        }

        setSelectionMode(false);
        setSelectedIds(new Set());
        setSelectedTag('all');
        useSearchStore.getState().setSearchTerm(pageKey, '');
        useToolbarViewOptionsStore.getState().setChannelFilter('all');
    }, [channelsData, clearPendingEditChannel, pendingEditChannelId]);

    const toggleSelectionMode = () => {
        setSelectionMode((prev) => {
            const next = !prev;
            if (!next) setSelectedIds(new Set());
            return next;
        });
    };

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectVisible = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                visibleChannelIds.forEach((id) => next.delete(id));
            } else {
                visibleChannelIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const handleBatchDelete = () => {
        if (selectedIdArray.length === 0) return;
        batchDeleteChannels.mutate(
            { ids: selectedIdArray },
            {
                onSuccess: () => {
                    toast.success(t('deleteSuccess'), { description: String(selectedIdArray.length) });
                    setDeleteOpen(false);
                    setSelectionMode(false);
                    setSelectedIds(new Set());
                },
                onError: (error) => {
                    toast.error(t('deleteFailed'), { description: error.message });
                },
            }
        );
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card/80 p-3 text-card-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-medium">
                        {selectionMode ? t('selectedCount', { count: selectedIds.size }) : t('title')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {selectionMode ? t('selectionHint') : t('hint')}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTagManagerOpen(true)}
                    >
                        <Tags className="size-4" />
                        {t('tagManage')}
                    </Button>
                    {selectionMode && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={toggleSelectVisible}
                                disabled={visibleChannelIds.length === 0}
                            >
                                <CheckSquare className="size-4" />
                                {allVisibleSelected ? t('clearVisible') : t('selectVisible')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditOpen(true)}
                                disabled={selectedIds.size === 0}
                            >
                                <Edit3 className="size-4" />
                                {t('edit')}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => setDeleteOpen(true)}
                                disabled={selectedIds.size === 0}
                            >
                                <Trash2 className="size-4" />
                                {t('delete')}
                            </Button>
                        </>
                    )}
                    <Button
                        type="button"
                        variant={selectionMode ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={toggleSelectionMode}
                    >
                        {selectionMode ? <X className="size-4" /> : <CheckSquare className="size-4" />}
                        {selectionMode ? t('exit') : t('enter')}
                    </Button>
                </div>
            </div>

            {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-card/60 p-2 text-xs">
                    <span className="px-1 text-muted-foreground">{t('activeFilters')}</span>
                    {searchTerm.trim() && (
                        <FilterChip label={t('searchChip', { value: searchTerm.trim() })} onClear={() => useSearchStore.getState().setSearchTerm(pageKey, '')} />
                    )}
                    {filter !== 'all' && (
                        <FilterChip label={filter === 'enabled' ? t('enabledChip') : t('disabledChip')} onClear={() => useToolbarViewOptionsStore.getState().setChannelFilter('all')} />
                    )}
                    {selectedTag !== 'all' && (
                        <FilterChip label={t('tagChip', { value: selectedTag })} onClear={() => setSelectedTag('all')} />
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-lg px-2 text-xs"
                        onClick={() => {
                            useSearchStore.getState().setSearchTerm(pageKey, '');
                            useToolbarViewOptionsStore.getState().setChannelFilter('all');
                            setSelectedTag('all');
                        }}
                    >
                        {t('clearFilters')}
                    </Button>
                </div>
            )}

            {availableTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-card/60 p-2">
                    <button
                        type="button"
                        onClick={() => setSelectedTag('all')}
                        className={cn(
                            'inline-flex h-7 items-center rounded-md border px-2 text-xs transition-colors',
                            selectedTag === 'all'
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {t('allTags')}
                    </button>
                    {availableTags.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => setSelectedTag((prev) => (prev === tag ? 'all' : tag))}
                        >
                            <Badge
                                variant={selectedTag === tag ? 'default' : 'secondary'}
                                className="h-7 max-w-36 cursor-pointer rounded-md px-2 text-xs font-normal"
                            >
                                <span className="truncate">{tag}</span>
                            </Badge>
                        </button>
                    ))}
                </div>
            )}

            <div className="min-h-0 flex-1">
                {visibleChannels.length > 0 ? (
                    <VirtualizedGrid
                        items={visibleChannels}
                        layout={layout}
                        columns={{ default: 1, md: 2, lg: 3 }}
                        estimateItemHeight={216}
                        scrollToIndex={pendingEditIndex >= 0 ? pendingEditIndex : null}
                        getItemKey={(item: ChannelListItem) => `channel-${item.raw.id}`}
                        renderItem={(item: ChannelListItem) => (
                            <Card
                                channel={item.raw}
                                stats={item.formatted}
                                layout={layout}
                                selectionMode={selectionMode}
                                selected={selectedIds.has(item.raw.id)}
                                onToggleSelect={toggleSelect}
                                autoOpenEdit={pendingEditChannelId === item.raw.id}
                                onAutoOpenEdit={clearPendingEditChannel}
                            />
                        )}
                    />
                ) : (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center">
                        <Search className="mb-3 size-8 text-muted-foreground" />
                        <p className="text-sm font-medium">{channelsData?.length ? t('empty.filteredTitle') : t('empty.title')}</p>
                        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{channelsData?.length ? t('empty.filteredHint') : t('empty.hint')}</p>
                        {hasActiveFilters && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-4 rounded-xl"
                                onClick={() => {
                                    useSearchStore.getState().setSearchTerm(pageKey, '');
                                    useToolbarViewOptionsStore.getState().setChannelFilter('all');
                                    setSelectedTag('all');
                                }}
                            >
                                {t('clearFilters')}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <TagManagerDialog
                open={tagManagerOpen}
                onOpenChange={setTagManagerOpen}
                tags={availableTags.map((tag) => ({
                    tag,
                    count: sortedChannels.filter((item) => (item.raw.tags ?? []).includes(tag)).length,
                }))}
            />

            <BatchEditDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                selectedIds={selectedIdArray}
                selectedChannels={selectedChannels.map((item) => item.raw)}
                availableTags={availableTags}
                onDone={() => {
                    setSelectionMode(false);
                    setSelectedIds(new Set());
                }}
            />

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDescription', { count: selectedIds.size })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <BatchDeletePreview channels={selectedChannels.map((item) => item.raw)} />
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={handleBatchDelete}
                            disabled={batchDeleteChannels.isPending}
                        >
                            {batchDeleteChannels.isPending ? t('deleting') : t('confirmDelete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function BatchEditDialog({
    open,
    onOpenChange,
    selectedIds,
    selectedChannels,
    availableTags,
    onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedIds: number[];
    selectedChannels: ChannelType[];
    availableTags: string[];
    onDone: () => void;
}) {
    const t = useTranslations('channel.batch');
    const tForm = useTranslations('channel.form');
    const batchUpdateChannels = useBatchUpdateChannels();
    const [fields, setFields] = useState<BatchFieldState>(DEFAULT_BATCH_FIELDS);
    const [values, setValues] = useState({
        enabled: true,
        tags: [] as string[],
        key_mode: GroupMode.RoundRobin,
        rpm: 10,
        proxy: false,
        auto_sync: false,
        auto_check: true,
        auto_group: AutoGroupType.Regex,
    });
    const [tagInputValue, setTagInputValue] = useState('');
    const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        setFields(DEFAULT_BATCH_FIELDS);
        setTagInputValue('');
        setTagPopoverOpen(false);
    }, [open]);

    const hasFields = Object.values(fields).some(Boolean);
    const previewItems = useMemo(() => {
        const items: string[] = [];
        if (fields.enabled) items.push(t('previewEnabled', { value: values.enabled ? t('yes') : t('no') }));
        if (fields.tags) items.push(t('previewTags', { value: values.tags.length ? values.tags.join(', ') : t('emptyTags') }));
        if (fields.key_mode) items.push(t('previewKeyMode'));
        if (fields.rpm) items.push(t('previewRPM', { value: Math.max(0, Number(values.rpm) || 0) }));
        if (fields.proxy) items.push(t('previewProxy', { value: values.proxy ? t('yes') : t('no') }));
        if (fields.auto_sync) items.push(t('previewAutoSync', { value: values.auto_sync ? t('yes') : t('no') }));
        if (fields.auto_check) items.push(t('previewAutoCheck', { value: values.auto_check ? t('yes') : t('no') }));
        if (fields.auto_group) items.push(t('previewAutoGroup'));
        return items;
    }, [fields, t, values]);
    const filteredTagOptions = useMemo(() => {
        const selected = new Set(values.tags.map((tag) => tag.toLowerCase()));
        const term = tagInputValue.trim().toLowerCase();
        return availableTags.filter((tag) => {
            if (selected.has(tag.toLowerCase())) return false;
            return !term || tag.toLowerCase().includes(term);
        });
    }, [availableTags, tagInputValue, values.tags]);

    const updateField = <K extends keyof BatchFieldState>(key: K, value: BatchFieldState[K]) => {
        setFields((prev) => ({ ...prev, [key]: value }));
    };

    const normalizeTags = (tags: string[]) => {
        const seen = new Set<string>();
        const normalized: string[] = [];
        for (const tag of tags) {
            const trimmed = tag.trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            normalized.push(trimmed);
        }
        return normalized;
    };

    const handleAddTag = (tag: string) => {
        const nextTags = normalizeTags([...values.tags, tag]);
        setValues((prev) => ({ ...prev, tags: nextTags }));
        setTagInputValue('');
        setTagPopoverOpen(false);
    };

    const handleRemoveTag = (tag: string) => {
        setValues((prev) => ({ ...prev, tags: prev.tags.filter((item) => item !== tag) }));
    };

    const handleTagInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            if (tagInputValue.trim()) handleAddTag(tagInputValue);
        }
    };

    const handleSubmit = () => {
        if (selectedIds.length === 0) return;
        if (!hasFields) {
            toast.error(t('noFields'));
            return;
        }

        const payload: BatchUpdateChannelRequest = { ids: selectedIds };
        if (fields.enabled) payload.enabled = values.enabled;
        if (fields.tags) {
            payload.tags = normalizeTags(values.tags);
        }
        if (fields.key_mode) payload.key_mode = values.key_mode;
        if (fields.rpm) payload.rpm = Math.max(0, Number(values.rpm) || 0);
        if (fields.proxy) payload.proxy = values.proxy;
        if (fields.auto_sync) payload.auto_sync = values.auto_sync;
        if (fields.auto_check) payload.auto_check = values.auto_check;
        if (fields.auto_group) payload.auto_group = values.auto_group;

        batchUpdateChannels.mutate(payload, {
            onSuccess: () => {
                toast.success(t('editSuccess'), { description: String(selectedIds.length) });
                onOpenChange(false);
                onDone();
            },
            onError: (error) => {
                toast.error(t('editFailed'), { description: error.message });
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('editTitle')}</DialogTitle>
                    <DialogDescription>{t('editDescription', { count: selectedIds.length })}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                    <BatchBooleanRow
                        checked={fields.enabled}
                        onCheckedChange={(checked) => updateField('enabled', checked)}
                        label={tForm('enabled')}
                        value={values.enabled}
                        onValueChange={(enabled) => setValues((prev) => ({ ...prev, enabled }))}
                    />
                    <BatchSelectRow
                        checked={fields.tags}
                        onCheckedChange={(checked) => updateField('tags', checked)}
                        label={tForm('tags')}
                    >
                        <div className={cn('space-y-2', !fields.tags && 'opacity-60')}>
                            <Popover open={fields.tags && tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                                <PopoverAnchor asChild>
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            disabled={!fields.tags}
                                            value={tagInputValue}
                                            onFocus={() => fields.tags && setTagPopoverOpen(true)}
                                            onChange={(event) => {
                                                setTagInputValue(event.target.value);
                                                setTagPopoverOpen(true);
                                            }}
                                            onKeyDown={handleTagInputKeyDown}
                                            placeholder={t('tagsSearchPlaceholder')}
                                            className="pl-9 pr-10"
                                        />
                                        {fields.tags && tagInputValue.trim() && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleAddTag(tagInputValue)}
                                                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                                title={tForm('tagsAdd')}
                                            >
                                                <Plus className="size-4" />
                                            </Button>
                                        )}
                                    </div>
                                </PopoverAnchor>
                                <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-72 rounded-xl p-2">
                                    <div className="max-h-52 overflow-y-auto">
                                        {filteredTagOptions.map((tag) => (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => handleAddTag(tag)}
                                                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                                            >
                                                <span className="truncate">{tag}</span>
                                                <Check className="size-3.5 text-muted-foreground" />
                                            </button>
                                        ))}
                                        {filteredTagOptions.length === 0 && (
                                            <div className="px-2 py-3 text-xs text-muted-foreground">
                                                {tagInputValue.trim() ? tForm('tagsCreateHint') : tForm('tagsNoOptions')}
                                            </div>
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            {values.tags.length > 0 ? (
                                <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border bg-muted/30 p-2">
                                    {values.tags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="max-w-full">
                                            <span className="truncate">{tag}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveTag(tag)}
                                                className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">{t('tagsEmptyHint')}</p>
                            )}
                        </div>
                    </BatchSelectRow>
                    <BatchBooleanRow
                        checked={fields.auto_check}
                        onCheckedChange={(checked) => updateField('auto_check', checked)}
                        label={tForm('autoCheck')}
                        value={values.auto_check}
                        onValueChange={(auto_check) => setValues((prev) => ({ ...prev, auto_check }))}
                    />
                    <BatchBooleanRow
                        checked={fields.auto_sync}
                        onCheckedChange={(checked) => updateField('auto_sync', checked)}
                        label={tForm('autoSync')}
                        value={values.auto_sync}
                        onValueChange={(auto_sync) => setValues((prev) => ({ ...prev, auto_sync }))}
                    />
                    <BatchBooleanRow
                        checked={fields.proxy}
                        onCheckedChange={(checked) => updateField('proxy', checked)}
                        label={tForm('proxy')}
                        value={values.proxy}
                        onValueChange={(proxy) => setValues((prev) => ({ ...prev, proxy }))}
                    />
                    <BatchSelectRow
                        checked={fields.key_mode}
                        onCheckedChange={(checked) => updateField('key_mode', checked)}
                        label={t('keyMode')}
                    >
                        <Select
                            disabled={!fields.key_mode}
                            value={String(values.key_mode)}
                            onValueChange={(value) => setValues((prev) => ({ ...prev, key_mode: Number(value) as GroupMode }))}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={String(GroupMode.RoundRobin)}>{tForm('keyModeRoundRobin')}</SelectItem>
                                <SelectItem value={String(GroupMode.Random)}>{tForm('keyModeRandom')}</SelectItem>
                                <SelectItem value={String(GroupMode.Failover)}>{tForm('keyModeFailover')}</SelectItem>
                                <SelectItem value={String(GroupMode.Weighted)}>{tForm('keyModeWeighted')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </BatchSelectRow>
                    <BatchSelectRow
                        checked={fields.auto_group}
                        onCheckedChange={(checked) => updateField('auto_group', checked)}
                        label={tForm('autoGroup')}
                    >
                        <Select
                            disabled={!fields.auto_group}
                            value={String(values.auto_group)}
                            onValueChange={(value) => setValues((prev) => ({ ...prev, auto_group: Number(value) as AutoGroupType }))}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={String(AutoGroupType.None)}>{tForm('autoGroupNone')}</SelectItem>
                                <SelectItem value={String(AutoGroupType.Fuzzy)}>{tForm('autoGroupFuzzy')}</SelectItem>
                                <SelectItem value={String(AutoGroupType.Exact)}>{tForm('autoGroupExact')}</SelectItem>
                                <SelectItem value={String(AutoGroupType.Regex)}>{tForm('autoGroupRegex')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </BatchSelectRow>
                    <BatchSelectRow
                        checked={fields.rpm}
                        onCheckedChange={(checked) => updateField('rpm', checked)}
                        label={tForm('rpm')}
                    >
                        <Input
                            disabled={!fields.rpm}
                            type="number"
                            min={0}
                            value={values.rpm}
                            onChange={(event) => setValues((prev) => ({ ...prev, rpm: Number(event.target.value) }))}
                        />
                    </BatchSelectRow>
                </div>

                <div className="rounded-2xl border border-border bg-muted/25 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <AlertTriangle className="size-4 text-amber-500" />
                        {t('previewTitle')}
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div className="rounded-xl bg-background/70 p-2">
                            <div className="mb-1 font-medium text-foreground">{t('previewChannels')}</div>
                            <div className="max-h-24 space-y-1 overflow-y-auto">
                                {selectedChannels.slice(0, 20).map((channel) => (
                                    <div key={channel.id} className="truncate">{channel.name}</div>
                                ))}
                                {selectedChannels.length > 20 && <div>{t('previewMore', { count: selectedChannels.length - 20 })}</div>}
                            </div>
                        </div>
                        <div className="rounded-xl bg-background/70 p-2">
                            <div className="mb-1 font-medium text-foreground">{t('previewFields')}</div>
                            {previewItems.length > 0 ? (
                                <div className="space-y-1">
                                    {previewItems.map((item) => <div key={item}>{item}</div>)}
                                </div>
                            ) : (
                                <div>{t('noFields')}</div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('cancel')}
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={batchUpdateChannels.isPending || selectedIds.length === 0 || !hasFields}>
                        {batchUpdateChannels.isPending ? t('saving') : t('save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
    return (
        <Badge variant="secondary" className="h-7 rounded-lg pl-2 pr-1 font-normal">
            <span className="max-w-44 truncate">{label}</span>
            <button
                type="button"
                onClick={onClear}
                className="ml-1 rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
                <X className="size-3" />
            </button>
        </Badge>
    );
}

function BatchDeletePreview({ channels }: { channels: ChannelType[] }) {
    const t = useTranslations('channel.batch');
    const keyCount = channels.reduce((sum, channel) => sum + channel.keys.length, 0);
    const modelCount = channels.reduce((sum, channel) => {
        const models = `${channel.model},${channel.custom_model}`
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        return sum + new Set(models).size;
    }, 0);

    if (channels.length === 0) return null;

    return (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                    <div className="text-lg font-semibold">{channels.length}</div>
                    <div className="text-xs text-muted-foreground">{t('previewChannelCount')}</div>
                </div>
                <div>
                    <div className="text-lg font-semibold">{keyCount}</div>
                    <div className="text-xs text-muted-foreground">{t('previewKeyCount')}</div>
                </div>
                <div>
                    <div className="text-lg font-semibold">{modelCount}</div>
                    <div className="text-xs text-muted-foreground">{t('previewModelCount')}</div>
                </div>
            </div>
            <div className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded-xl bg-background/70 p-2 text-xs text-muted-foreground">
                {channels.map((channel) => (
                    <div key={channel.id} className="truncate">{channel.name}</div>
                ))}
            </div>
        </div>
    );
}

function TagManagerDialog({
    open,
    onOpenChange,
    tags,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tags: Array<{ tag: string; count: number }>;
}) {
    const t = useTranslations('channel.batch');
    const renameTag = useRenameChannelTag();
    const deleteTag = useDeleteChannelTag();
    const [editingTag, setEditingTag] = useState('');
    const [newTag, setNewTag] = useState('');

    useEffect(() => {
        if (!open) {
            setEditingTag('');
            setNewTag('');
        }
    }, [open]);

    const submitRename = () => {
        if (!editingTag || !newTag.trim()) return;
        renameTag.mutate(
            { old_tag: editingTag, new_tag: newTag.trim() },
            {
                onSuccess: () => {
                    toast.success(t('tagRenameSuccess'));
                    setEditingTag('');
                    setNewTag('');
                },
                onError: (error) => toast.error(t('tagRenameFailed'), { description: error.message }),
            }
        );
    };

    const submitDelete = (tag: string) => {
        deleteTag.mutate(
            { tag },
            {
                onSuccess: () => toast.success(t('tagDeleteSuccess')),
                onError: (error) => toast.error(t('tagDeleteFailed'), { description: error.message }),
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t('tagManageTitle')}</DialogTitle>
                    <DialogDescription>{t('tagManageDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {tags.length > 0 ? tags.map((item) => (
                        <div key={item.tag} className="rounded-2xl border border-border bg-background/70 p-3">
                            {editingTag === item.tag ? (
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Input
                                        value={newTag}
                                        onChange={(event) => setNewTag(event.target.value)}
                                        placeholder={t('tagRenamePlaceholder')}
                                        className="rounded-xl"
                                    />
                                    <Button type="button" onClick={submitRename} disabled={renameTag.isPending || !newTag.trim()}>
                                        {t('confirm')}
                                    </Button>
                                    <Button type="button" variant="outline" onClick={() => setEditingTag('')}>
                                        {t('cancel')}
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{item.tag}</div>
                                        <div className="text-xs text-muted-foreground">{t('tagUsedCount', { count: item.count })}</div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setEditingTag(item.tag);
                                                setNewTag(item.tag);
                                            }}
                                        >
                                            {t('rename')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => submitDelete(item.tag)}
                                            disabled={deleteTag.isPending}
                                        >
                                            {t('remove')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )) : (
                        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                            {t('tagManageEmpty')}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function BatchBooleanRow({
    checked,
    onCheckedChange,
    label,
    value,
    onValueChange,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
}) {
    return (
        <div className={cn('rounded-2xl border p-3', checked ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/60')}>
            <div className="mb-3 flex items-center gap-2">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    onChange={(event) => onCheckedChange(event.target.checked)}
                />
                <Label className="text-sm">{label}</Label>
            </div>
            <Switch checked={value} onCheckedChange={onValueChange} disabled={!checked} />
        </div>
    );
}

function BatchSelectRow({
    checked,
    onCheckedChange,
    label,
    children,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: string;
    children: ReactNode;
}) {
    return (
        <div className={cn('rounded-2xl border p-3', checked ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/60')}>
            <div className="mb-3 flex items-center gap-2">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    onChange={(event) => onCheckedChange(event.target.checked)}
                />
                <Label className="text-sm">{label}</Label>
            </div>
            {children}
        </div>
    );
}
