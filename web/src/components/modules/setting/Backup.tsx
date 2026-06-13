'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from '@/lib/translations';
import { AlertTriangle, Database, Download, Eye, Loader2, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/common/Toast';
import { DBBackupSelectableItem, DBBackupSelection, DBImportPreview, useExportDB, useImportDB, usePreviewExportDB, usePreviewImportDB } from '@/api/endpoints/setting';
import { cn } from '@/lib/utils';

type BackupMode = 'export' | 'import';
type SelectionKind = 'channelIds' | 'groupIds' | 'settingKeys';

type SelectionState = {
    channelIds: Set<number>;
    groupIds: Set<number>;
    settingKeys: Set<string>;
};

function itemValue(item: DBBackupSelectableItem) {
    return item.key ?? String(item.id);
}

function fullSelection(preview?: DBImportPreview): SelectionState {
    return {
        channelIds: new Set((preview?.channels ?? []).map((item) => item.id)),
        groupIds: new Set((preview?.groups ?? []).map((item) => item.id)),
        settingKeys: new Set((preview?.settings ?? []).map((item) => itemValue(item))),
    };
}

function toBackupSelection(selection: SelectionState): DBBackupSelection {
    return {
        channel_ids: Array.from(selection.channelIds),
        group_ids: Array.from(selection.groupIds),
        setting_keys: Array.from(selection.settingKeys),
    };
}

function countSelected(selection: SelectionState) {
    return selection.channelIds.size + selection.groupIds.size + selection.settingKeys.size;
}

function filterSelectableItems(items: DBBackupSelectableItem[], search: string) {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => [item.id, item.key ?? '', item.name, item.secondary ?? ''].join('\n').toLowerCase().includes(term));
}

function SelectionList({
    title,
    empty,
    items,
    selected,
    search,
    onSearchChange,
    onToggle,
    onSetAll,
}: {
    title: string;
    empty: string;
    items: DBBackupSelectableItem[];
    selected: Set<string | number>;
    search: string;
    onSearchChange: (value: string) => void;
    onToggle: (item: DBBackupSelectableItem) => void;
    onSetAll: (checked: boolean, items: DBBackupSelectableItem[]) => void;
}) {
    const filteredItems = filterSelectableItems(items, search);
    const allChecked = filteredItems.length > 0 && filteredItems.every((item) => selected.has(itemValue(item)) || selected.has(item.id));
    const checkedCount = items.filter((item) => selected.has(itemValue(item)) || selected.has(item.id)).length;

    return (
        <section className="min-h-0 space-y-2">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold text-foreground">{title}</div>
                    <div className="text-xs text-muted-foreground">{checkedCount} / {items.length}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={(event) => onSetAll(event.target.checked, filteredItems)}
                        className="size-4 shrink-0 rounded border-border accent-primary"
                    />
                    全选当前筛选
                </label>
            </div>

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={`搜索${title}`}
                    className="h-9 rounded-lg pl-9"
                />
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2 sm:max-h-64">
                {filteredItems.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">{empty}</div>
                ) : filteredItems.map((item) => {
                    const value = itemValue(item);
                    const checked = selected.has(value) || selected.has(item.id);
                    return (
                        <label key={`${item.key ?? item.id}`} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-background/80">
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(item)}
                                className="size-4 shrink-0 rounded border-border accent-primary"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                                <span className="block truncate text-xs text-muted-foreground" title={item.secondary}>
                                    {item.secondary ? `${item.secondary} · ` : ''}{item.sub_count > 0 ? `${item.sub_count} 个关联项` : item.key ? item.key : `${item.id}`}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </div>
        </section>
    );
}

function PreviewTables({ preview }: { preview?: DBImportPreview }) {
    if (!preview) return null;
    return (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">数据概览</div>
                <div className="text-xs text-muted-foreground">{preview.total_rows} 行</div>
            </div>
            <div className="grid max-h-28 grid-cols-1 gap-1 overflow-y-auto sm:max-h-32 sm:grid-cols-2">
                {preview.tables.map((table) => (
                    <div key={table.table} className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs">
                        <span className="min-w-0 truncate text-muted-foreground">{table.table}</span>
                        <span className="font-semibold tabular-nums text-foreground">{table.count}</span>
                    </div>
                ))}
            </div>
            {preview.warnings.length > 0 && (
                <div className="space-y-1 text-xs text-amber-600 dark:text-amber-300">
                    {preview.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
            )}
        </div>
    );
}

export function SettingBackup() {
    const t = useTranslations('setting');

    const exportDB = useExportDB();
    const importDB = useImportDB();
    const previewImportDB = usePreviewImportDB();
    const previewExportDB = usePreviewExportDB();

    const [includeLogs, setIncludeLogs] = useState(false);
    const [includeStats, setIncludeStats] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [dialogMode, setDialogMode] = useState<BackupMode | null>(null);
    const [selection, setSelection] = useState<SelectionState>(() => fullSelection());
    const [channelSearch, setChannelSearch] = useState('');
    const [groupSearch, setGroupSearch] = useState('');
    const [settingSearch, setSettingSearch] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const activePreview = dialogMode === 'export' ? previewExportDB.data : previewImportDB.data;
    const rowsAffected = importDB.data?.rows_affected ?? null;
    const rowsAffectedList = useMemo(() => {
        if (!rowsAffected) return [];
        return Object.entries(rowsAffected)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => ({ table: k, count: v }));
    }, [rowsAffected]);

    const resetSearch = () => {
        setChannelSearch('');
        setGroupSearch('');
        setSettingSearch('');
    };

    const openExportPreview = async () => {
        try {
            const preview = await previewExportDB.refetch();
            if (!preview.data) throw new Error('导出预览失败');
            setIncludeLogs(false);
            setIncludeStats(false);
            setSelection(fullSelection(preview.data));
            resetSearch();
            setDialogMode('export');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '导出预览失败');
        }
    };

    const openImportPreview = async () => {
        if (!file) {
            toast.error(t('backup.import.noFile'));
            return;
        }
        try {
            const preview = await previewImportDB.mutateAsync(file);
            setSelection(fullSelection(preview));
            resetSearch();
            setDialogMode('import');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('backup.import.previewFailed'));
        }
    };

    const onPickFile = (f: File | null) => {
        setFile(f);
        setDialogMode(null);
        previewImportDB.reset();
    };

    const updateSelection = (kind: SelectionKind, next: Set<number> | Set<string>) => {
        setSelection((current) => ({ ...current, [kind]: next }));
    };

    const toggleItem = (kind: SelectionKind, item: DBBackupSelectableItem) => {
        const value = kind === 'settingKeys' ? itemValue(item) : item.id;
        const current = selection[kind] as Set<typeof value>;
        const next = new Set(current);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        updateSelection(kind, next as Set<number> | Set<string>);
    };

    const setAll = (kind: SelectionKind, items: DBBackupSelectableItem[], checked: boolean) => {
        const current = selection[kind] as Set<string | number>;
        const next = new Set(current);
        items.forEach((item) => {
            const value = kind === 'settingKeys' ? itemValue(item) : item.id;
            if (checked) next.add(value);
            else next.delete(value);
        });
        updateSelection(kind, next as Set<number> | Set<string>);
    };

    const onConfirmDialog = async () => {
        if (!activePreview) return;
        const selected = toBackupSelection(selection);
        try {
            if (dialogMode === 'export') {
                await exportDB.mutateAsync({ include_logs: includeLogs, include_stats: includeStats, selection: selected });
                toast.success(t('backup.export.success'));
            } else if (dialogMode === 'import') {
                if (!file) {
                    toast.error(t('backup.import.noFile'));
                    return;
                }
                await importDB.mutateAsync({ file, selection: selected });
                toast.success(t('backup.import.success'));
                if (fileInputRef.current) fileInputRef.current.value = '';
                setFile(null);
                previewImportDB.reset();
            }
            setDialogMode(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : dialogMode === 'export' ? t('backup.export.failed') : t('backup.import.failed'));
        }
    };

    const pending = exportDB.isPending || importDB.isPending;
    const selectedCount = countSelected(selection);

    return (
        <div className="rounded-3xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                <Database className="h-5 w-5" />
                {t('backup.title')}
            </h2>

            <div className="space-y-3">
                <div className="text-sm font-semibold text-card-foreground">{t('backup.export.title')}</div>
                <Button type="button" variant="outline" className="w-full rounded-xl" onClick={openExportPreview} disabled={previewExportDB.isFetching || exportDB.isPending}>
                    {previewExportDB.isFetching ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                    {previewExportDB.isFetching ? '预览中...' : '预览并导出'}
                </Button>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-3">
                <div className="text-sm font-semibold text-card-foreground">{t('backup.import.title')}</div>
                <Input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    className="rounded-xl"
                />
                <Button type="button" variant="outline" className="w-full rounded-xl" onClick={openImportPreview} disabled={previewImportDB.isPending || !file}>
                    {previewImportDB.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                    {previewImportDB.isPending ? t('backup.import.previewing') : t('backup.import.preview')}
                </Button>

                {rowsAffectedList.length > 0 && (
                    <div className="mt-2 space-y-1">
                        <div className="text-xs font-semibold text-card-foreground">{t('backup.import.result')}</div>
                        <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                            {rowsAffectedList.map((it) => (
                                <div key={it.table} className="flex justify-between gap-2">
                                    <span className="truncate">{it.table}</span>
                                    <span className="tabular-nums">{it.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
                <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-none flex-col gap-3 overflow-hidden p-4 sm:max-h-[90vh] sm:w-full sm:max-w-5xl sm:gap-4 sm:p-6">
                    <DialogHeader className="pr-6 text-left">
                        <DialogTitle>{dialogMode === 'export' ? '导出预览' : t('backup.import.previewResult')}</DialogTitle>
                        <DialogDescription>
                            选择要{dialogMode === 'export' ? '导出' : '导入'}的数据，关联的密钥和模型配置会一并处理。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 sm:space-y-4">
                        {dialogMode === 'export' && (
                            <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-2 sm:p-3">
                                <div className="flex items-center justify-between gap-4 rounded-lg bg-background/70 px-3 py-2">
                                    <span className="text-sm text-muted-foreground">{t('backup.export.includeLogs')}</span>
                                    <Switch checked={includeLogs} onCheckedChange={setIncludeLogs} />
                                </div>
                                <div className="flex items-center justify-between gap-4 rounded-lg bg-background/70 px-3 py-2">
                                    <span className="text-sm text-muted-foreground">{t('backup.export.includeStats')}</span>
                                    <Switch checked={includeStats} onCheckedChange={setIncludeStats} />
                                </div>
                            </div>
                        )}

                        {activePreview?.warnings && activePreview.warnings.length > 0 && (
                            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <div className="space-y-1">
                                    {activePreview.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                                </div>
                            </div>
                        )}

                        <div className="grid min-h-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <SelectionList
                                title="渠道"
                                empty="没有匹配的渠道"
                                items={activePreview?.channels ?? []}
                                selected={selection.channelIds}
                                search={channelSearch}
                                onSearchChange={setChannelSearch}
                                onToggle={(item) => toggleItem('channelIds', item)}
                                onSetAll={(checked, items) => setAll('channelIds', items, checked)}
                            />
                            <SelectionList
                                title="分组"
                                empty="没有匹配的分组"
                                items={activePreview?.groups ?? []}
                                selected={selection.groupIds}
                                search={groupSearch}
                                onSearchChange={setGroupSearch}
                                onToggle={(item) => toggleItem('groupIds', item)}
                                onSetAll={(checked, items) => setAll('groupIds', items, checked)}
                            />
                            <SelectionList
                                title="设置"
                                empty="没有匹配的设置"
                                items={activePreview?.settings ?? []}
                                selected={selection.settingKeys}
                                search={settingSearch}
                                onSearchChange={setSettingSearch}
                                onToggle={(item) => toggleItem('settingKeys', item)}
                                onSetAll={(checked, items) => setAll('settingKeys', items, checked)}
                            />
                        </div>

                        <PreviewTables preview={activePreview} />
                    </div>

                    <DialogFooter className="flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:border-0 sm:pt-0">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDialogMode(null)} disabled={pending}>取消</Button>
                        <Button
                            type="button"
                            variant={dialogMode === 'import' ? 'destructive' : 'default'}
                            onClick={onConfirmDialog}
                            disabled={pending || selectedCount === 0}
                            className={cn('w-full sm:w-auto', dialogMode === 'export' && 'gap-2')}
                        >
                            {pending ? <Loader2 className="size-4 animate-spin" /> : dialogMode === 'export' ? <Download className="size-4" /> : <Upload className="size-4" />}
                            {dialogMode === 'export' ? (exportDB.isPending ? t('backup.export.exporting') : t('backup.export.button')) : (importDB.isPending ? t('backup.import.importing') : t('backup.import.button'))}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}