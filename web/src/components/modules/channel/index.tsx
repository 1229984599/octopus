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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import { CheckSquare, Edit3, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

type ChannelListItem = {
    raw: ChannelType;
    formatted: Parameters<typeof Card>[0]['stats'];
};

type BatchFieldState = {
    enabled: boolean;
    key_mode: boolean;
    rpm: boolean;
    proxy: boolean;
    auto_sync: boolean;
    auto_check: boolean;
    auto_group: boolean;
};

const DEFAULT_BATCH_FIELDS: BatchFieldState = {
    enabled: false,
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
    const t = useTranslations('channel.batch');

    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

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
        const byName = !term ? sortedChannels : sortedChannels.filter((c) => c.raw.name.toLowerCase().includes(term));

        if (filter === 'enabled') return byName.filter((c) => c.raw.enabled);
        if (filter === 'disabled') return byName.filter((c) => !c.raw.enabled);

        return byName;
    }, [sortedChannels, searchTerm, filter]);

    const visibleChannelIds = useMemo(() => visibleChannels.map((item) => item.raw.id), [visibleChannels]);
    const selectedIdArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
    const allVisibleSelected = visibleChannelIds.length > 0 && visibleChannelIds.every((id) => selectedIds.has(id));

    useEffect(() => {
        if (!channelsData) return;
        const existingIds = new Set(channelsData.map((item) => item.raw.id));
        setSelectedIds((prev) => {
            const next = new Set(Array.from(prev).filter((id) => existingIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [channelsData]);

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

            <div className="min-h-0 flex-1">
                <VirtualizedGrid
                    items={visibleChannels}
                    layout={layout}
                    columns={{ default: 1, md: 2, lg: 3 }}
                    estimateItemHeight={216}
                    getItemKey={(item: ChannelListItem) => `channel-${item.raw.id}`}
                    renderItem={(item: ChannelListItem) => (
                        <Card
                            channel={item.raw}
                            stats={item.formatted}
                            layout={layout}
                            selectionMode={selectionMode}
                            selected={selectedIds.has(item.raw.id)}
                            onToggleSelect={toggleSelect}
                        />
                    )}
                />
            </div>

            <BatchEditDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                selectedIds={selectedIdArray}
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
    onDone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedIds: number[];
    onDone: () => void;
}) {
    const t = useTranslations('channel.batch');
    const tForm = useTranslations('channel.form');
    const batchUpdateChannels = useBatchUpdateChannels();
    const [fields, setFields] = useState<BatchFieldState>(DEFAULT_BATCH_FIELDS);
    const [values, setValues] = useState({
        enabled: true,
        key_mode: GroupMode.RoundRobin,
        rpm: 10,
        proxy: false,
        auto_sync: false,
        auto_check: true,
        auto_group: AutoGroupType.Regex,
    });

    useEffect(() => {
        if (!open) return;
        setFields(DEFAULT_BATCH_FIELDS);
    }, [open]);

    const hasFields = Object.values(fields).some(Boolean);

    const updateField = <K extends keyof BatchFieldState>(key: K, value: BatchFieldState[K]) => {
        setFields((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = () => {
        if (selectedIds.length === 0) return;
        if (!hasFields) {
            toast.error(t('noFields'));
            return;
        }

        const payload: BatchUpdateChannelRequest = { ids: selectedIds };
        if (fields.enabled) payload.enabled = values.enabled;
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
