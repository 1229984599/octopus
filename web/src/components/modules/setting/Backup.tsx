'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Database, Download, Eye, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import { useExportDB, useImportDB, usePreviewImportDB } from '@/api/endpoints/setting';

export function SettingBackup() {
    const t = useTranslations('setting');

    const exportDB = useExportDB();
    const importDB = useImportDB();
    const previewImportDB = usePreviewImportDB();

    const [includeLogs, setIncludeLogs] = useState(false);
    const [includeStats, setIncludeStats] = useState(false);

    const [file, setFile] = useState<File | null>(null);
    const [previewConfirmed, setPreviewConfirmed] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const rowsAffected = importDB.data?.rows_affected ?? null;
    const rowsAffectedList = useMemo(() => {
        if (!rowsAffected) return [];
        return Object.entries(rowsAffected)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => ({ table: k, count: v }));
    }, [rowsAffected]);

    const onPickFile = (f: File | null) => {
        setFile(f);
        setPreviewConfirmed(false);
        previewImportDB.reset();
    };

    const onPreviewImport = async () => {
        if (!file) {
            toast.error(t('backup.import.noFile'));
            return;
        }
        try {
            await previewImportDB.mutateAsync(file);
            setPreviewConfirmed(true);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('backup.import.previewFailed'));
        }
    };

    const onImport = async () => {
        if (!file) {
            toast.error(t('backup.import.noFile'));
            return;
        }
        if (!previewConfirmed) {
            toast.error(t('backup.import.previewRequired'));
            return;
        }
        try {
            await importDB.mutateAsync(file);
            toast.success(t('backup.import.success'));
            if (fileInputRef.current) fileInputRef.current.value = '';
            setFile(null);
            setPreviewConfirmed(false);
            previewImportDB.reset();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('backup.import.failed'));
        }
    };

    const onExport = async () => {
        try {
            await exportDB.mutateAsync({ include_logs: includeLogs, include_stats: includeStats });
            toast.success(t('backup.export.success'));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('backup.export.failed'));
        }
    };

    return (
        <div className="rounded-3xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                <Database className="h-5 w-5" />
                {t('backup.title')}
            </h2>

            {/* 导出 */}
            <div className="space-y-3">
                <div className="text-sm font-semibold text-card-foreground">{t('backup.export.title')}</div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">{t('backup.export.includeLogs')}</div>
                    <Switch checked={includeLogs} onCheckedChange={setIncludeLogs} />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">{t('backup.export.includeStats')}</div>
                    <Switch checked={includeStats} onCheckedChange={setIncludeStats} />
                </div>

                <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl"
                    onClick={onExport}
                    disabled={exportDB.isPending}
                >
                    <Download className="size-4" />
                    {exportDB.isPending ? t('backup.export.exporting') : t('backup.export.button')}
                </Button>
            </div>

            <div className="h-px bg-border" />

            {/* 导入 */}
            <div className="space-y-3">
                <div className="text-sm font-semibold text-card-foreground">{t('backup.import.title')}</div>

                <Input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                    className="rounded-xl"
                />

                <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl"
                    onClick={onPreviewImport}
                    disabled={previewImportDB.isPending || !file}
                >
                    <Eye className="size-4" />
                    {previewImportDB.isPending ? t('backup.import.previewing') : t('backup.import.preview')}
                </Button>

                {previewImportDB.data && (
                    <div className="space-y-3 rounded-2xl border border-border bg-muted/25 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold text-card-foreground">{t('backup.import.previewResult')}</div>
                                <div className="text-xs text-muted-foreground">
                                    {t('backup.import.previewTotal', { count: previewImportDB.data.total_rows })}
                                </div>
                            </div>
                            {previewImportDB.data.warnings.length > 0 && (
                                <AlertTriangle className="size-5 text-amber-500" />
                            )}
                        </div>
                        <div className="max-h-44 space-y-1 overflow-y-auto">
                            {previewImportDB.data.tables.map((table) => (
                                <div key={table.table} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-background/70 p-2 text-xs">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium text-foreground">{table.table}</div>
                                        <div className="truncate text-muted-foreground">{table.action}</div>
                                        {table.warning && <div className="mt-1 text-amber-600 dark:text-amber-300">{table.warning}</div>}
                                    </div>
                                    <div className="font-semibold tabular-nums">{table.count}</div>
                                </div>
                            ))}
                        </div>
                        {previewImportDB.data.warnings.length > 0 && (
                            <div className="space-y-1 text-xs text-amber-600 dark:text-amber-300">
                                {previewImportDB.data.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                            </div>
                        )}
                    </div>
                )}

                <Button
                    type="button"
                    variant="destructive"
                    className="w-full rounded-xl"
                    onClick={onImport}
                    disabled={importDB.isPending || !previewConfirmed}
                >
                    <Upload className="size-4" />
                    {importDB.isPending ? t('backup.import.importing') : t('backup.import.button')}
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
        </div>
    );
}


