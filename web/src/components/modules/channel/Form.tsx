import { AutoGroupType, ChannelType, GroupMode, type Channel, type ChannelKeyCheckResult, useChannelList, useCheckChannelKeys, useFetchModel, useUpdateChannel } from '@/api/endpoints/channel';
import { cn } from '@/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/common/Toast';
import { useTranslations } from '@/lib/translations';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Ban, Check, ClipboardPaste, GripVertical, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CheckResultDetail } from '@/components/common/CheckResultDetail';
import { getKeyHealth, keyNeedsAttention, type KeyHealthState } from './health';
import { DISGUISE_PRESETS, findDisguisePreset } from './disguisePresets';

export interface ChannelKeyFormItem {
    id?: number;
    enabled: boolean;
    channel_key: string;
    status_code?: number;
    last_use_time_stamp?: number;
    /** 最近一次检测失败的原因（来自后端持久化）；检测成功后为空 */
    last_check_message?: string;
    remark?: string;
    priority?: number;
    weight?: number;
}

function isImageGenerationModel(model: string): boolean {
    const name = model.trim().toLowerCase();
    if (!name) return false;
    const markers = ['gpt-image', 'dall-e', 'imagen', 'image-generation', 'image_generation', 'flux', 'midjourney', 'stable-diffusion'];
    if (markers.some((marker) => name.includes(marker))) return true;
    return name.includes('image') && !name.includes('vision');
}

function isImageChannelType(type: ChannelType): boolean {
    return [
        ChannelType.OpenAIImageGeneration,
        ChannelType.OpenAIImageEdit,
        ChannelType.OpenAIImageVariation,
    ].includes(type);
}

function deferStateUpdate(update: () => void) {
    queueMicrotask(update);
}

type KeyFilter = 'all' | 'enabled' | 'disabled' | 'attention' | 'invalid';
const NO_DISGUISE_PRESET_VALUE = '__none__';

function KeyStateBadge({ state, label }: { state: KeyHealthState; label: (key: string) => string }) {
    const tone = state === 'ok'
        ? 'bg-green-500/15 text-green-700 dark:text-green-400'
        : state === 'unchecked'
            ? 'bg-muted text-muted-foreground'
            : state === 'disabled'
                ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
                : state === 'rate-limited'
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
                    : 'bg-red-500/15 text-red-700 dark:text-red-400';
    return (
        <Badge variant="secondary" className={cn('h-5 px-1.5 text-[10px]', tone)}>
            {label(`state.${state}`)}
        </Badge>
    );
}

export interface ChannelFormData {
    name: string;
    type: ChannelType;
    base_urls: Channel['base_urls'];
    custom_header: Channel['custom_header'];
    disguise_preset: string;
    channel_proxy: string;
    param_override: string;
    keys: ChannelKeyFormItem[];
    key_mode: GroupMode;
    rpm: number;
    model: string;
    custom_model: string;
    check_model: string;
    enabled: boolean;
    tags: string[];
    proxy: boolean;
    auto_sync: boolean;
    auto_check: boolean;
    auto_group: AutoGroupType;
    match_regex: string;
}

export interface ChannelFormProps {
    formData: ChannelFormData;
    onFormDataChange: (data: ChannelFormData) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    isPending: boolean;
    submitText: string;
    pendingText: string;
    onCancel?: () => void;
    cancelText?: string;
    onDelete?: () => void;
    deleteText?: string;
    deleteDisabled?: boolean;
    idPrefix?: string;
    channelId?: number;
}

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

export function ChannelForm({
    formData,
    onFormDataChange,
    onSubmit,
    isPending,
    submitText,
    pendingText,
    onCancel,
    cancelText,
    onDelete,
    deleteText,
    deleteDisabled,
    idPrefix = 'channel',
    channelId,
}: ChannelFormProps) {
    const t = useTranslations('channel.form');
    const keyT = useTranslations('channel.detail.keyCheck');
    const { data: channelsData } = useChannelList();

    // Ensure the form always shows at least 1 row for base_urls / keys / custom_header.
    // This avoids "empty list" UI and also keeps URL + APIKEY layout consistent.
    useEffect(() => {
        if (!formData.base_urls || formData.base_urls.length === 0) {
            onFormDataChange({ ...formData, base_urls: [{ url: '', delay: 0 }] });
            return;
        }
        if (!formData.keys || formData.keys.length === 0) {
            onFormDataChange({ ...formData, keys: [{ enabled: true, channel_key: '' }] });
            return;
        }
        if (!formData.custom_header || formData.custom_header.length === 0) {
            onFormDataChange({ ...formData, custom_header: [{ header_key: '', header_value: '' }] });
        }
    }, [formData, onFormDataChange]);

    const autoModels = useMemo(
        () => formData.model
            ? formData.model.split(',').map((m) => m.trim()).filter(Boolean)
            : [],
        [formData.model]
    );
    const customModels = useMemo(
        () => formData.custom_model
            ? formData.custom_model.split(',').map((m) => m.trim()).filter(Boolean)
            : [],
        [formData.custom_model]
    );
    const checkModelOptions = useMemo(
        () => Array.from(new Set([formData.check_model?.trim(), ...autoModels, ...customModels].filter(Boolean))),
        [autoModels, customModels, formData.check_model]
    );
    const [inputValue, setInputValue] = useState('');
    const [tagInputValue, setTagInputValue] = useState('');
    const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
    const [draggedKeyIndex, setDraggedKeyIndex] = useState<number | null>(null);
    const [dragOverKeyIndex, setDragOverKeyIndex] = useState<number | null>(null);
    const [selectedKeyIds, setSelectedKeyIds] = useState<Set<number>>(new Set());
    const [checkModel, setCheckModel] = useState(formData.check_model ?? '');
    const [modelSearch, setModelSearch] = useState('');
    const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
    const [checkResults, setCheckResults] = useState<Record<number, ChannelKeyCheckResult>>({});
    const [bulkImportOpen, setBulkImportOpen] = useState(false);
    const [bulkKeyInput, setBulkKeyInput] = useState('');
    const [keyFilter, setKeyFilter] = useState<KeyFilter>('all');
    const inputRef = useRef<HTMLInputElement>(null);
    const keyListRef = useRef<HTMLDivElement>(null);

    const fetchModel = useFetchModel();
    const checkChannelKeys = useCheckChannelKeys();
    const updateChannel = useUpdateChannel();
    const showKeyWeight = formData.key_mode === GroupMode.Weighted;
    const canManageExistingKeys = typeof channelId === 'number';
    const activeCheckModel = checkModel.trim() || (checkModelOptions[0] ?? '');
    const isImageCheckModel = isImageChannelType(formData.type) || isImageGenerationModel(activeCheckModel);

    useEffect(() => {
        const savedModel = formData.check_model?.trim() ?? '';
        deferStateUpdate(() => {
            setCheckModel((current) => {
                if (savedModel) return savedModel;
                if (current && checkModelOptions.includes(current)) return current;
                return checkModelOptions[0] ?? '';
            });
        });
    }, [checkModelOptions, formData.check_model]);

    const effectiveKey =
        formData.keys.find((k) => k.enabled && k.channel_key.trim())?.channel_key.trim() || '';

    const handleDisguisePresetChange = (value: string) => {
        if (value === NO_DISGUISE_PRESET_VALUE) {
            onFormDataChange({ ...formData, disguise_preset: '' });
            return;
        }
        const preset = findDisguisePreset(value);
        if (!preset) return;
        onFormDataChange({
            ...formData,
            disguise_preset: preset.id,
            custom_header: preset.headers.map((header) => ({ ...header })),
        });
    };

    const selectedKeyIdArray = useMemo(() => Array.from(selectedKeyIds), [selectedKeyIds]);
    const checkableExistingKeyIds = useMemo(
        () => (formData.keys ?? [])
            .filter((key) => typeof key.id === 'number' && key.channel_key.trim())
            .map((key) => key.id as number),
        [formData.keys]
    );
    const selectedCheckableKeyIds = useMemo(
        () => selectedKeyIdArray.filter((id) => checkableExistingKeyIds.includes(id)),
        [checkableExistingKeyIds, selectedKeyIdArray]
    );
    const filteredModelOptions = useMemo(() => {
        const term = modelSearch.trim().toLowerCase();
        if (!term) return checkModelOptions;
        return checkModelOptions.filter((model) => model.toLowerCase().includes(term));
    }, [checkModelOptions, modelSearch]);
    const existingTagOptions = useMemo(() => {
        const tags = new Set<string>();
        channelsData?.forEach((item) => {
            item.raw.tags.forEach((tag) => {
                const trimmed = tag.trim();
                if (trimmed) tags.add(trimmed);
            });
        });
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    }, [channelsData]);
    const filteredTagOptions = useMemo(() => {
        const selected = new Set((formData.tags ?? []).map((tag) => tag.toLowerCase()));
        const term = tagInputValue.trim().toLowerCase();
        return existingTagOptions.filter((tag) => {
            if (selected.has(tag.toLowerCase())) return false;
            return !term || tag.toLowerCase().includes(term);
        });
    }, [existingTagOptions, formData.tags, tagInputValue]);
    const invalidKeyIds = useMemo(
        () => (formData.keys ?? [])
            .filter((key) => typeof key.id === 'number' && (key.status_code === 401 || key.status_code === 403))
            .map((key) => key.id as number),
        [formData.keys]
    );
    const statusFailedKeyIds = useMemo(
        () => (formData.keys ?? [])
            .filter((key) => (
                typeof key.id === 'number'
                && key.enabled
                && typeof key.status_code === 'number'
                && (key.status_code !== 0 || Boolean(key.last_use_time_stamp))
                && (key.status_code < 200 || key.status_code >= 300)
            ))
            .map((key) => key.id as number),
        [formData.keys]
    );
    const visibleKeys = useMemo(() => {
        return (formData.keys ?? [])
            .map((key, index) => ({ key, index }))
            .filter(({ key }) => {
                if (keyFilter === 'enabled') return key.enabled;
                if (keyFilter === 'disabled') return !key.enabled;
                if (keyFilter === 'attention') return keyNeedsAttention({
                    enabled: key.enabled,
                    channel_key: key.channel_key,
                    status_code: key.status_code ?? 0,
                    last_use_time_stamp: key.last_use_time_stamp ?? 0,
                });
                if (keyFilter === 'invalid') return key.status_code === 401 || key.status_code === 403;
                return true;
            });
    }, [formData.keys, keyFilter]);
    const keyFilterOptions: Array<{ value: KeyFilter; label: string; count: number }> = [
        { value: 'all', label: keyT('filterAll'), count: formData.keys.length },
        { value: 'enabled', label: keyT('filterEnabled'), count: formData.keys.filter((key) => key.enabled).length },
        { value: 'disabled', label: keyT('filterDisabled'), count: formData.keys.filter((key) => !key.enabled).length },
        { value: 'attention', label: keyT('filterAttention'), count: formData.keys.filter((key) => keyNeedsAttention({ enabled: key.enabled, channel_key: key.channel_key, status_code: key.status_code ?? 0, last_use_time_stamp: key.last_use_time_stamp ?? 0 })).length },
        { value: 'invalid', label: keyT('filterInvalid'), count: invalidKeyIds.length },
    ];
    const updateModels = (nextAuto: string[], nextCustom: string[]) => {
        const model = nextAuto.join(',');
        const custom_model = nextCustom.join(',');
        if (formData.model === model && formData.custom_model === custom_model) return;
        onFormDataChange({ ...formData, model, custom_model });
    };

    const handleRefreshModels = async () => {
        if (!formData.base_urls?.[0]?.url || !effectiveKey) return;
        fetchModel.mutate(
            {
                type: formData.type,
                base_urls: formData.base_urls,
                keys: formData.keys
                    .filter((k) => k.channel_key.trim())
                    .map((k) => ({ enabled: k.enabled, channel_key: k.channel_key.trim() })),
                proxy: formData.proxy,
                channel_proxy: formData.channel_proxy?.trim() || null,
                match_regex: formData.match_regex.trim() || null,
                custom_header: formData.custom_header?.filter((h) => h.header_key.trim()) || [],
            },
            {
                onSuccess: (data) => {
                    if (data && data.length > 0) {
                        const nextAuto = Array.from(new Set([...autoModels, ...data].map((m) => m.trim()).filter(Boolean)));
                        updateModels(nextAuto, customModels);
                        toast.success(t('modelRefreshSuccess'));
                    } else {
                        toast.warning(t('modelRefreshEmpty'));
                    }
                },
                onError: (error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toast.error(t('modelRefreshFailed'), { description: errorMessage });
                },
            }
        );
    };

    const handleAddModel = (model: string) => {
        const trimmedModel = model.trim();
        if (trimmedModel && !customModels.includes(trimmedModel) && !autoModels.includes(trimmedModel)) {
            updateModels(autoModels, [...customModels, trimmedModel]);
        }
        setInputValue('');
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
        const nextTags = normalizeTags([...(formData.tags ?? []), tag]);
        onFormDataChange({ ...formData, tags: nextTags });
        setTagInputValue('');
        setTagPopoverOpen(false);
    };

    const handleRemoveTag = (tag: string) => {
        onFormDataChange({ ...formData, tags: (formData.tags ?? []).filter((item) => item !== tag) });
    };

    const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (tagInputValue.trim()) handleAddTag(tagInputValue);
        }
    };

    const handleRemoveAutoModel = (model: string) => {
        updateModels(autoModels.filter(m => m !== model), customModels);
    };

    const handleRemoveCustomModel = (model: string) => {
        updateModels(autoModels, customModels.filter(m => m !== model));
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (inputValue.trim()) handleAddModel(inputValue);
        }
    };

    const handleAddKey = () => {
        onFormDataChange({
            ...formData,
            keys: [...formData.keys, { enabled: true, channel_key: '', priority: formData.keys.length + 1, weight: 1 }],
        });
    };

    // 批量粘贴导入：按行拆分（支持 "key#备注" 格式），去重去空后一次生成多行 Key
    const handleBulkImportKeys = () => {
        const existing = new Set(formData.keys.map((k) => k.channel_key.trim()).filter(Boolean));
        const lines = bulkKeyInput.split(/\r?\n/);
        const newKeys: ChannelKeyFormItem[] = [];
        let skipped = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const [rawKey, ...remarkParts] = trimmed.split('#');
            const key = rawKey.trim();
            if (!key) continue;
            if (existing.has(key)) {
                skipped++;
                continue;
            }
            existing.add(key);
            newKeys.push({
                enabled: true,
                channel_key: key,
                remark: remarkParts.join('#').trim() || undefined,
                priority: formData.keys.length + newKeys.length + 1,
                weight: 1,
            });
        }
        if (newKeys.length === 0) {
            toast.warning(keyT('bulkImportEmpty'), { description: keyT('bulkImportEmptyHint') });
            return;
        }
        onFormDataChange({ ...formData, keys: [...formData.keys, ...newKeys] });
        setBulkKeyInput('');
        setBulkImportOpen(false);
        toast.success(keyT('bulkImportDone'), { description: `${newKeys.length} ${skipped > 0 ? `(跳过重复 ${skipped})` : ''}`.trim() });
    };

    const normalizeKeyOrder = (keys: ChannelKeyFormItem[]) =>
        keys.map((key, index) => ({
            ...key,
            priority: index + 1,
            weight: key.weight && key.weight > 0 ? key.weight : 1,
        }));

    const handleUpdateKey = (idx: number, patch: Partial<ChannelKeyFormItem>) => {
        const next = formData.keys.map((k, i) => (i === idx ? { ...k, ...patch } : k));
        onFormDataChange({ ...formData, keys: next });
    };

    const handleRemoveKey = (idx: number) => {
        const curr = formData.keys ?? [];
        if (curr.length <= 1) return;
        const next = normalizeKeyOrder(curr.filter((_, i) => i !== idx));
        onFormDataChange({ ...formData, keys: next });
    };

    const resetKeyDragState = () => {
        setDraggedKeyIndex(null);
        setDragOverKeyIndex(null);
    };

    const handleKeyListDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (draggedKeyIndex === null) return;
        event.preventDefault();

        const container = keyListRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const edgeSize = 64;
        const maxSpeed = 18;
        if (event.clientY < rect.top + edgeSize) {
            container.scrollTop -= Math.max(4, Math.round(((rect.top + edgeSize - event.clientY) / edgeSize) * maxSpeed));
        } else if (event.clientY > rect.bottom - edgeSize) {
            container.scrollTop += Math.max(4, Math.round(((event.clientY - (rect.bottom - edgeSize)) / edgeSize) * maxSpeed));
        }
    };

    const handleKeyDragOver = (event: DragEvent<HTMLDivElement>, idx: number) => {
        if (draggedKeyIndex === null) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const insertIndex = event.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
        setDragOverKeyIndex(insertIndex);
    };

    const handleDropKey = (insertIndex: number) => {
        if (draggedKeyIndex === null) {
            resetKeyDragState();
            return;
        }
        const currentKeys = formData.keys ?? [];
        const boundedInsertIndex = Math.max(0, Math.min(insertIndex, currentKeys.length));
        if (draggedKeyIndex < 0 || draggedKeyIndex >= currentKeys.length) {
            resetKeyDragState();
            return;
        }
        const targetIndex = draggedKeyIndex < boundedInsertIndex ? boundedInsertIndex - 1 : boundedInsertIndex;
        if (targetIndex === draggedKeyIndex) {
            resetKeyDragState();
            return;
        }

        const next = [...currentKeys];
        const [dragged] = next.splice(draggedKeyIndex, 1);
        next.splice(targetIndex, 0, dragged);
        const normalized = normalizeKeyOrder(next);
        onFormDataChange({ ...formData, keys: normalized });
        resetKeyDragState();

        if (!canManageExistingKeys) return;
        const keysToUpdate = normalized
            .filter((key) => typeof key.id === 'number')
            .map((key, index) => ({ id: key.id as number, priority: index + 1 }));
        if (keysToUpdate.length === 0) return;
        updateChannel.mutate(
            { id: channelId, keys_to_update: keysToUpdate },
            {
                onSuccess: () => toast.success(keyT('sorted')),
                onError: (error) => toast.error(keyT('sortFailed'), { description: error.message }),
            }
        );
    };

    const toggleKeySelection = (id: number, checked: boolean) => {
        setSelectedKeyIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const pruneSelectedAndChecked = (ids: number[]) => {
        const idSet = new Set(ids);
        setSelectedKeyIds((prev) => new Set(Array.from(prev).filter((id) => !idSet.has(id))));
        setCheckResults((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !idSet.has(Number(id)))));
    };

    const handleCheckKeys = (keyIds?: number[], mode?: 'real_image_generation') => {
        if (!canManageExistingKeys) return;
        const ids = keyIds?.length ? keyIds.filter((id) => checkableExistingKeyIds.includes(id)) : checkableExistingKeyIds;
        if (ids.length === 0) {
            toast.warning(keyT('keyRequired'));
            return;
        }
        if (!activeCheckModel) {
            toast.warning(keyT('modelRequired'));
            return;
        }
        if (mode === 'real_image_generation' && !window.confirm('真实生图检测会调用上游图片生成接口，成功生成可能产生费用。确认继续吗？')) {
            return;
        }
        checkChannelKeys.mutate(
            { id: channelId, model: activeCheckModel, key_ids: ids, mode },
            {
                onSuccess: ({ results, note }) => {
                    if (note) {
                        toast.warning(note);
                    }
                    const resultByID = new Map(results.map((result) => [result.id, result]));
                    setCheckResults((prev) => ({ ...prev, ...Object.fromEntries(results.map((result) => [result.id, result])) }));
                    onFormDataChange({
                        ...formData,
                        keys: formData.keys.map((key) => {
                            if (typeof key.id !== 'number') return key;
                            const result = resultByID.get(key.id);
                            return result ? {
                                ...key,
                                status_code: result.status_code,
                                last_use_time_stamp: result.last_use_time_stamp ?? key.last_use_time_stamp,
                                last_check_message: result.ok ? '' : result.error,
                            } : key;
                        }),
                    });
                    const okCount = results.filter((result) => result.ok).length;
                    toast.success(keyT('done'), { description: `${okCount}/${results.length}` });
                },
                onError: (error) => toast.error(keyT('failed'), { description: error.message }),
            }
        );
    };

    const handleSelectCheckModel = (model: string) => {
        const nextModel = model.trim();
        setCheckModel(nextModel);
        setModelPopoverOpen(false);
        onFormDataChange({ ...formData, check_model: nextModel });

        if (!canManageExistingKeys) return;
        updateChannel.mutate(
            { id: channelId, check_model: nextModel },
            {
                onSuccess: () => toast.success(keyT('modelSaved')),
                onError: (error) => toast.error(keyT('modelSaveFailed'), { description: error.message }),
            }
        );
    };

    const handleDeleteKeys = (ids: number[]) => {
        if (!canManageExistingKeys) return;
        const uniqueIds = Array.from(new Set(ids));
        if (uniqueIds.length === 0) return;
        updateChannel.mutate(
            { id: channelId, keys_to_delete: uniqueIds },
            {
                onSuccess: () => {
                    pruneSelectedAndChecked(uniqueIds);
                    onFormDataChange({
                        ...formData,
                        keys: normalizeKeyOrder(formData.keys.filter((key) => typeof key.id !== 'number' || !uniqueIds.includes(key.id))),
                    });
                    toast.success(keyT('deleted'), { description: String(uniqueIds.length) });
                },
                onError: (error) => toast.error(keyT('deleteFailed'), { description: error.message }),
            }
        );
    };

    const handleDisableKeys = (ids: number[]) => {
        if (!canManageExistingKeys) return;
        const uniqueIds = Array.from(new Set(ids));
        if (uniqueIds.length === 0) return;
        updateChannel.mutate(
            {
                id: channelId,
                keys_to_update: uniqueIds.map((id) => ({ id, enabled: false })),
            },
            {
                onSuccess: () => {
                    pruneSelectedAndChecked(uniqueIds);
                    onFormDataChange({
                        ...formData,
                        keys: formData.keys.map((key) => (
                            typeof key.id === 'number' && uniqueIds.includes(key.id)
                                ? { ...key, enabled: false }
                                : key
                        )),
                    });
                    toast.success(keyT('disabled'), { description: String(uniqueIds.length) });
                },
                onError: (error) => toast.error(keyT('disableFailed'), { description: error.message }),
            }
        );
    };

    const handleAddBaseUrl = () => {
        onFormDataChange({
            ...formData,
            base_urls: [...(formData.base_urls ?? []), { url: '', delay: 0 }],
        });
    };

    const handleUpdateBaseUrl = (idx: number, patch: Partial<Channel['base_urls'][number]>) => {
        const next = (formData.base_urls ?? []).map((u, i) => (i === idx ? { ...u, ...patch } : u));
        onFormDataChange({ ...formData, base_urls: next });
    };

    const handleRemoveBaseUrl = (idx: number) => {
        const curr = formData.base_urls ?? [];
        if (curr.length <= 1) return;
        onFormDataChange({ ...formData, base_urls: curr.filter((_, i) => i !== idx) });
    };

    const handleAddHeader = () => {
        onFormDataChange({
            ...formData,
            custom_header: [...(formData.custom_header ?? []), { header_key: '', header_value: '' }],
        });
    };

    const handleUpdateHeader = (idx: number, patch: Partial<Channel['custom_header'][number]>) => {
        const next = (formData.custom_header ?? []).map((h, i) => (i === idx ? { ...h, ...patch } : h));
        onFormDataChange({ ...formData, custom_header: next });
    };

    const handleRemoveHeader = (idx: number) => {
        const curr = formData.custom_header ?? [];
        if (curr.length <= 1) return;
        onFormDataChange({ ...formData, custom_header: curr.filter((_, i) => i !== idx) });
    };

    return (
        <form onSubmit={onSubmit} className="space-y-4 px-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium text-card-foreground">
                        {t('name')}
                    </label>
                    <Input
                        className='rounded-xl'
                        id={`${idPrefix}-name`}
                        type="text"
                        value={formData.name}
                        onChange={(event) => onFormDataChange({ ...formData, name: event.target.value })}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-card-foreground">
                        {t('type')}
                    </label>
                    <Select
                        value={String(formData.type)}
                        onValueChange={(value) => onFormDataChange({ ...formData, type: value as ChannelType })}
                    >
                        <SelectTrigger id={`${idPrefix}-type`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className='rounded-xl'>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIChat)}>{t('typeOpenAIChat')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIResponse)}>{t('typeOpenAIResponse')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Anthropic)}>{t('typeAnthropic')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Gemini)}>{t('typeGemini')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Volcengine)}>{t('typeVolcengine')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIEmbedding)}>{t('typeOpenAIEmbedding')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIImageGeneration)}>{t('typeOpenAIImage')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="space-y-2">
                <label htmlFor={`${idPrefix}-tags`} className="text-sm font-medium text-card-foreground">
                    {t('tags')}
                </label>
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                    <PopoverAnchor asChild>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                id={`${idPrefix}-tags`}
                                type="text"
                                value={tagInputValue}
                                onFocus={() => setTagPopoverOpen(true)}
                                onChange={(event) => {
                                    setTagInputValue(event.target.value);
                                    setTagPopoverOpen(true);
                                }}
                                onKeyDown={handleTagInputKeyDown}
                                placeholder={t('tagsPlaceholder')}
                                className="rounded-xl pl-9 pr-10"
                            />
                            {tagInputValue.trim() && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleAddTag(tagInputValue)}
                                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                    title={t('tagsAdd')}
                                >
                                    <Plus className="size-4" />
                                </Button>
                            )}
                        </div>
                    </PopoverAnchor>
                    <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-72 rounded-xl p-2">
                        <div className="max-h-56 overflow-y-auto">
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
                                    {tagInputValue.trim() ? t('tagsCreateHint') : t('tagsNoOptions')}
                                </div>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
                {(formData.tags ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/30 p-2">
                        {formData.tags.map((tag) => (
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
                    <p className="text-xs text-muted-foreground">{t('tagsHint')}</p>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-card-foreground">
                        {t('baseUrls')} {formData.base_urls.length > 0 ? `(${formData.base_urls.length})` : ''}
                    </label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddBaseUrl}
                        className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('add')}
                    </Button>
                </div>
                <div className="space-y-2">
                    {(formData.base_urls ?? []).map((u, idx) => (
                        <div key={`baseurl-${idx}`} className="flex items-center gap-2">
                            <Input
                                id={`${idPrefix}-base-${idx}`}
                                type="url"
                                value={u.url}
                                onChange={(e) => handleUpdateBaseUrl(idx, { url: e.target.value })}
                                placeholder={t('baseUrlUrl')}
                                required={idx === 0}
                                className="rounded-xl flex-1"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveBaseUrl(idx)}
                                disabled={(formData.base_urls ?? []).length <= 1}
                                className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive disabled:opacity-40 hover:bg-transparent"
                                title="Remove"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2">
                    <label className="mr-auto min-w-fit text-sm font-medium text-card-foreground">
                        {t('apiKey')} {formData.keys.length > 0 ? `(${formData.keys.length})` : ''}
                    </label>
                    <Select
                        value={String(formData.key_mode)}
                        onValueChange={(value) => onFormDataChange({ ...formData, key_mode: Number(value) as GroupMode })}
                    >
                        <SelectTrigger className="h-8 w-32 rounded-lg border-border px-2 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem className="rounded-xl" value={String(GroupMode.RoundRobin)}>{t('keyModeRoundRobin')}</SelectItem>
                            <SelectItem className="rounded-xl" value={String(GroupMode.Random)}>{t('keyModeRandom')}</SelectItem>
                            <SelectItem className="rounded-xl" value={String(GroupMode.Failover)}>{t('keyModeFailover')}</SelectItem>
                            <SelectItem className="rounded-xl" value={String(GroupMode.Weighted)}>{t('keyModeWeighted')}</SelectItem>
                        </SelectContent>
                    </Select>
                    {canManageExistingKeys && (
                        <>
                            <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className="h-8 max-w-56 rounded-lg px-2 text-xs">
                                            <span className="truncate">{activeCheckModel || keyT('model')}</span>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-72 rounded-xl p-2">
                                        <div className="relative mb-2">
                                            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <Input
                                                value={modelSearch}
                                                onChange={(event) => setModelSearch(event.target.value)}
                                                className="h-8 rounded-lg pl-7 text-xs"
                                                placeholder={keyT('searchModel')}
                                            />
                                        </div>
                                        <div className="max-h-56 overflow-y-auto">
                                            {filteredModelOptions.map((model) => (
                                                <button
                                                    key={model}
                                                    type="button"
                                                    onClick={() => handleSelectCheckModel(model)}
                                                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
                                                >
                                                    <span className="truncate">{model}</span>
                                                    {activeCheckModel === model && <Check className="size-3.5 text-primary" />}
                                                </button>
                                            ))}
                                            {filteredModelOptions.length === 0 && (
                                                <div className="px-2 py-6 text-center text-xs text-muted-foreground">{keyT('noModels')}</div>
                                            )}
                                        </div>
                                    </PopoverContent>
                            </Popover>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={checkChannelKeys.isPending || checkableExistingKeyIds.length === 0}
                                onClick={() => handleCheckKeys()}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                <RefreshCw className={cn("size-3.5", checkChannelKeys.isPending && "animate-spin")} />
                                {keyT('all')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={checkChannelKeys.isPending || selectedCheckableKeyIds.length === 0}
                                onClick={() => handleCheckKeys(selectedCheckableKeyIds)}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                {keyT('selected')}
                            </Button>
                            {isImageCheckModel && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={checkChannelKeys.isPending || selectedCheckableKeyIds.length === 0}
                                    onClick={() => handleCheckKeys(selectedCheckableKeyIds, 'real_image_generation')}
                                    className="h-8 rounded-lg px-2 text-xs text-orange-600"
                                >
                                    真实生图检测
                                </Button>
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updateChannel.isPending || selectedKeyIdArray.length === 0}
                                onClick={() => handleDisableKeys(selectedKeyIdArray)}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                <Ban className="size-3.5" />
                                {keyT('disableSelected')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updateChannel.isPending || statusFailedKeyIds.length === 0}
                                onClick={() => handleDisableKeys(statusFailedKeyIds)}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                {keyT('disableFailedKeys')}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={updateChannel.isPending || selectedKeyIdArray.length === 0}
                                onClick={() => handleDeleteKeys(selectedKeyIdArray)}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                <Trash2 className="size-3.5" />
                                {keyT('deleteSelected')}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={updateChannel.isPending || invalidKeyIds.length === 0}
                                onClick={() => handleDeleteKeys(invalidKeyIds)}
                                className="h-8 rounded-lg px-2 text-xs"
                            >
                                {keyT('deleteInvalid')}
                            </Button>
                            {isImageCheckModel && (
                                <span className="basis-full text-[10px] leading-4 text-muted-foreground sm:basis-auto">
                                    图片模型默认仅鉴权检测
                                </span>
                            )}
                        </>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddKey}
                        className="h-8 rounded-lg px-2 text-xs text-muted-foreground/80 hover:text-muted-foreground"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('add')}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBulkImportOpen(true)}
                        className="h-8 rounded-lg px-2 text-xs text-muted-foreground/80 hover:text-muted-foreground"
                    >
                        <ClipboardPaste className="h-3 w-3 mr-1" />
                        {t('bulkImport')}
                    </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-1.5">
                    {keyFilterOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setKeyFilter(option.value)}
                            className={cn(
                                'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs transition-colors',
                                keyFilter === option.value
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                            )}
                        >
                            <span>{option.label}</span>
                            <span className="tabular-nums opacity-80">{option.count}</span>
                        </button>
                    ))}
                </div>
                <div
                    ref={keyListRef}
                    onDragOver={handleKeyListDragOver}
                    onDrop={() => handleDropKey(dragOverKeyIndex ?? (formData.keys ?? []).length)}
                    className="max-h-96 space-y-2 overflow-y-auto pr-1"
                >
                    {visibleKeys.map(({ key: k, index: idx }) => {
                        const showDropBefore = draggedKeyIndex !== null && dragOverKeyIndex === idx && draggedKeyIndex !== idx && draggedKeyIndex + 1 !== idx;
                        return (
                            <div key={k.id ?? `new-${idx}`} className="space-y-2">
                                {showDropBefore && (
                                    <div className="flex items-center gap-2 px-2 text-[10px] font-medium text-primary">
                                        <span className="h-0.5 flex-1 rounded-full bg-primary" />
                                        <span>{keyT('dropHere')}</span>
                                        <span className="h-0.5 flex-1 rounded-full bg-primary" />
                                    </div>
                                )}
                                <div
                                    onDragOver={(event) => handleKeyDragOver(event, idx)}
                                    onDrop={() => handleDropKey(dragOverKeyIndex ?? idx)}
                                    className={cn(
                                        "flex flex-col gap-2 rounded-xl border border-border/40 bg-background/60 p-2 transition-colors",
                                        draggedKeyIndex === idx ? "opacity-60" : "hover:bg-muted/30",
                                        showDropBefore && "border-primary/50"
                                    )}
                                >
                            <div className="flex min-w-0 items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span
                                        draggable={(formData.keys ?? []).length > 1}
                                        onDragStart={(event) => {
                                            setDraggedKeyIndex(idx);
                                            setDragOverKeyIndex(idx);
                                            event.dataTransfer.effectAllowed = 'move';
                                            event.dataTransfer.setData('text/plain', String(idx));
                                        }}
                                        onDragEnd={resetKeyDragState}
                                        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted active:cursor-grabbing"
                                        title={t('priority')}
                                    >
                                        <GripVertical className="h-4 w-4" />
                                    </span>
                                    <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                                        {idx + 1}
                                    </span>
                                    {canManageExistingKeys && typeof k.id === 'number' && (
                                        <input
                                            type="checkbox"
                                            checked={selectedKeyIds.has(k.id)}
                                            onChange={(event) => toggleKeySelection(k.id as number, event.target.checked)}
                                            className="size-4 shrink-0 rounded border-border"
                                        />
                                    )}
                                </div>
                                <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                                        <KeyStateBadge state={getKeyHealth({ enabled: k.enabled, channel_key: k.channel_key, status_code: k.status_code ?? 0, last_use_time_stamp: k.last_use_time_stamp ?? 0 })} label={keyT} />
                                        {typeof k.status_code === 'number' && (k.status_code !== 0 || Boolean(k.last_use_time_stamp)) && (
                                            <Badge
                                                variant="secondary"
                                                className={cn(
                                                    "h-5 px-1.5 text-[10px]",
                                                    k.status_code >= 200 && k.status_code < 300
                                                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                                                        : k.status_code === 429
                                                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                                            : "bg-red-500/15 text-red-700 dark:text-red-400"
                                                )}
                                            >
                                                {k.status_code}
                                            </Badge>
                                        )}
                                        {typeof k.id === 'number' && checkResults[k.id] && (
                                            <CheckResultDetail
                                                ok={checkResults[k.id].ok}
                                                label={checkResults[k.id].ok ? keyT('ok') : keyT('bad')}
                                                detail={[checkResults[k.id].note, checkResults[k.id].strategy ? `检测方式: ${checkResults[k.id].strategy}` : '', checkResults[k.id].error].filter(Boolean).join('\n')}
                                            />
                                        )}
                                        {typeof k.id === 'number' && !checkResults[k.id] && k.last_check_message && (
                                            <CheckResultDetail
                                                ok={false}
                                                label={keyT('bad')}
                                                detail={[k.last_check_message, k.last_use_time_stamp ? `${keyT('lastChecked')}: ${new Date(k.last_use_time_stamp * 1000).toLocaleString()}` : ''].filter(Boolean).join('\n')}
                                            />
                                        )}
                                        {Boolean(k.last_use_time_stamp) && (
                                            <span className="hidden max-w-48 truncate text-[10px] text-muted-foreground md:inline" title={`${keyT('lastChecked')}: ${new Date((k.last_use_time_stamp ?? 0) * 1000).toLocaleString()}`}>
                                                {keyT('lastChecked')}: {new Date((k.last_use_time_stamp ?? 0) * 1000).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <Switch
                                        checked={k.enabled}
                                        onCheckedChange={(checked) => handleUpdateKey(idx, { enabled: checked })}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveKey(idx)}
                                        disabled={(formData.keys ?? []).length <= 1}
                                        className="h-8 w-8 rounded-xl p-0 text-muted-foreground hover:bg-transparent hover:text-destructive disabled:opacity-40"
                                        title="Remove"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            <div className={cn("grid gap-2", showKeyWeight ? "md:grid-cols-[1fr_180px_90px]" : "md:grid-cols-[1fr_220px]") }>
                                <Input
                                    type="text"
                                    value={k.channel_key}
                                    onChange={(e) => handleUpdateKey(idx, { channel_key: e.target.value })}
                                    placeholder={t('apiKey')}
                                    required={idx === 0}
                                    className="min-w-0 rounded-xl font-mono text-sm"
                                />
                                <Input
                                    type="text"
                                    value={k.remark ?? ''}
                                    onChange={(e) => handleUpdateKey(idx, { remark: e.target.value })}
                                    placeholder={t('remark')}
                                    className="min-w-0 rounded-xl"
                                />
                                {showKeyWeight && (
                                    <Input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={String(k.weight ?? 1)}
                                        onChange={(e) => handleUpdateKey(idx, { weight: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })}
                                        title={t('weight')}
                                        className="rounded-xl"
                                    />
                                )}
                            </div>
                                </div>
                            </div>
                        );
                    })}
                    {draggedKeyIndex !== null && dragOverKeyIndex === (formData.keys ?? []).length && draggedKeyIndex !== (formData.keys ?? []).length - 1 && (
                        <div className="flex items-center gap-2 px-2 text-[10px] font-medium text-primary">
                            <span className="h-0.5 flex-1 rounded-full bg-primary" />
                            <span>{keyT('dropHere')}</span>
                            <span className="h-0.5 flex-1 rounded-full bg-primary" />
                        </div>
                    )}
                    {visibleKeys.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                            {keyT('filterEmpty')}
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-card-foreground">{t('model')}</label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshModels}
                        disabled={!formData.base_urls?.[0]?.url || !effectiveKey || fetchModel.isPending}
                        className="h-6 px-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-transparent"
                    >
                        <RefreshCw className={`h-3 w-3 mr-1 ${fetchModel.isPending ? 'animate-spin' : ''}`} />
                        {t('modelRefresh')}
                    </Button>
                </div>
                <input type="hidden" value={formData.model} required />

                <div className="relative">
                    <Input
                        ref={inputRef}
                        id={`${idPrefix}-model-custom`}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder={t('modelCustomPlaceholder')}
                        className="pr-10 rounded-xl"
                    />
                    {inputValue.trim() && !customModels.includes(inputValue.trim()) && !autoModels.includes(inputValue.trim()) && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAddModel(inputValue)}
                            className="absolute rounded-lg right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                            title={t('modelAdd')}
                        >
                            <Plus className="size-4" />
                        </Button>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-card-foreground">
                            {t('modelSelected')} {(autoModels.length + customModels.length) > 0 && `(${autoModels.length + customModels.length})`}
                        </label>
                        {(autoModels.length + customModels.length) > 0 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    updateModels([], []);
                                }}
                                className="h-6 px-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-transparent"
                            >
                                {t('modelClearAll')}
                            </Button>
                        )}
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-2.5 max-h-40 min-h-12 overflow-y-auto">
                        {(autoModels.length + customModels.length) > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {autoModels.map((model) => (
                                    <Badge key={model} variant="secondary" className="bg-muted hover:bg-muted/80">
                                        {model}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAutoModel(model)}
                                            className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                                {customModels.map((model) => (
                                    <Badge key={model} className="bg-primary hover:bg-primary/90">
                                        {model}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCustomModel(model)}
                                            className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-8 text-xs text-muted-foreground">
                                {t('modelNoSelected')}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Accordion type="single" collapsible className="w-full border rounded-xl bg-card">
                <AccordionItem value="advanced" className="border-none">
                    <AccordionTrigger className="text-sm font-medium text-card-foreground py-3 px-4 hover:no-underline hover:bg-muted/30 rounded-xl transition-colors">
                        {t('advanced')}
                    </AccordionTrigger>
                    <AccordionContent className="pt-4 px-4 pb-4 space-y-4 border-t">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor={`${idPrefix}-auto-group`} className="text-sm font-medium text-card-foreground">
                                    {t('autoGroup')}
                                </label>
                                <Select
                                    value={String(formData.auto_group)}
                                    onValueChange={(value) => onFormDataChange({ ...formData, auto_group: Number(value) as AutoGroupType })}
                                >
                                    <SelectTrigger id={`${idPrefix}-auto-group`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className='rounded-xl'>
                                        <SelectItem className='rounded-xl' value={String(AutoGroupType.None)}>{t('autoGroupNone')}</SelectItem>
                                        <SelectItem className='rounded-xl' value={String(AutoGroupType.Fuzzy)}>{t('autoGroupFuzzy')}</SelectItem>
                                        <SelectItem className='rounded-xl' value={String(AutoGroupType.Exact)}>{t('autoGroupExact')}</SelectItem>
                                        <SelectItem className='rounded-xl' value={String(AutoGroupType.Regex)}>{t('autoGroupRegex')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor={`${idPrefix}-rpm`} className="text-sm font-medium text-card-foreground">
                                    {t('rpm')}
                                </label>
                                <Input
                                    id={`${idPrefix}-rpm`}
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={formData.rpm}
                                    onChange={(e) => {
                                        const nextRPM = Number(e.target.value);
                                        onFormDataChange({
                                            ...formData,
                                            rpm: Number.isFinite(nextRPM) && nextRPM > 0 ? Math.floor(nextRPM) : 0,
                                        });
                                    }}
                                    placeholder={t('rpmPlaceholder')}
                                    className="rounded-xl"
                                />
                                <p className="text-xs text-muted-foreground">{t('rpmHint')}</p>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor={`${idPrefix}-channel-proxy`} className="text-sm font-medium text-card-foreground">
                                    {t('channelProxy')}
                                </label>
                                <Input
                                    id={`${idPrefix}-channel-proxy`}
                                    type="text"
                                    value={formData.channel_proxy}
                                    onChange={(e) => onFormDataChange({ ...formData, channel_proxy: e.target.value })}
                                    placeholder={t('channelProxyPlaceholder')}
                                    className="rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor={`${idPrefix}-disguise-preset`} className="text-sm font-medium text-card-foreground">
                                    伪装预设
                                </label>
                                <Select
                                    value={formData.disguise_preset || NO_DISGUISE_PRESET_VALUE}
                                    onValueChange={handleDisguisePresetChange}
                                >
                                    <SelectTrigger id={`${idPrefix}-disguise-preset`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <SelectValue placeholder="选择预设" />
                                    </SelectTrigger>
                                    <SelectContent className='rounded-xl'>
                                        <SelectItem className='rounded-xl' value={NO_DISGUISE_PRESET_VALUE}>无</SelectItem>
                                        {DISGUISE_PRESETS.map((preset) => (
                                            <SelectItem key={preset.id} className='rounded-xl' value={preset.id}>{preset.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-card-foreground">
                                    {t('customHeader')} {formData.custom_header.length > 0 ? `(${formData.custom_header.length})` : ''}
                                </label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleAddHeader}
                                    className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                                >
                                    <Plus className="h-3 w-3 mr-1" />
                                    {t('customHeaderAdd')}
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {(formData.custom_header ?? []).map((h, idx) => (
                                    <div key={`hdr-${idx}`} className="flex items-center gap-2">
                                        <Input
                                            type="text"
                                            value={h.header_key}
                                            onChange={(e) => handleUpdateHeader(idx, { header_key: e.target.value })}
                                            placeholder={t('customHeaderKey')}
                                            className="rounded-xl flex-1"
                                        />
                                        <Input
                                            type="text"
                                            value={h.header_value}
                                            onChange={(e) => handleUpdateHeader(idx, { header_value: e.target.value })}
                                            placeholder={t('customHeaderValue')}
                                            className="rounded-xl flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveHeader(idx)}
                                            disabled={(formData.custom_header ?? []).length <= 1}
                                            className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-transparent disabled:opacity-40"
                                            title="Remove"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={`${idPrefix}-match-regex`} className="text-sm font-medium text-card-foreground">
                                {t('matchRegex')}
                            </label>
                            <Input
                                id={`${idPrefix}-match-regex`}
                                type="text"
                                value={formData.match_regex}
                                onChange={(e) => onFormDataChange({ ...formData, match_regex: e.target.value })}
                                placeholder={t('matchRegexPlaceholder')}
                                className="rounded-xl"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={`${idPrefix}-param-override`} className="text-sm font-medium text-card-foreground">
                                {t('paramOverride')}
                            </label>
                            <textarea
                                id={`${idPrefix}-param-override`}
                                value={formData.param_override}
                                onChange={(e) => onFormDataChange({ ...formData, param_override: e.target.value })}
                                placeholder={t('paramOverridePlaceholder')}
                                className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-muted/20 border border-border/50">
                <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                        checked={formData.enabled}
                        onCheckedChange={(checked) => onFormDataChange({ ...formData, enabled: checked })}
                    />
                    <span className="text-sm font-medium text-card-foreground">{t('enabled')}</span>
                </label>
                <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                            checked={formData.proxy}
                            onCheckedChange={(checked) => onFormDataChange({ ...formData, proxy: checked })}
                        />
                        <span className="text-sm text-card-foreground">{t('proxy')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                            checked={formData.auto_sync}
                            onCheckedChange={(checked) => onFormDataChange({ ...formData, auto_sync: checked })}
                        />
                        <span className="text-sm text-card-foreground">{t('autoSync')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                            checked={formData.auto_check}
                            onCheckedChange={(checked) => onFormDataChange({ ...formData, auto_check: checked })}
                        />
                        <span className="text-sm text-card-foreground">{t('autoCheck')}</span>
                    </label>
                </div>
            </div>

            <div className={`flex flex-col gap-3 pt-2 ${onCancel || onDelete ? 'sm:flex-row' : ''}`}>
                {onDelete && deleteText && (
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onDelete}
                        disabled={deleteDisabled}
                        className="w-full sm:flex-1 rounded-2xl h-12"
                    >
                        {deleteText}
                    </Button>
                )}
                {onCancel && cancelText && (
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onCancel}
                        className="w-full sm:flex-1 rounded-2xl h-12"
                    >
                        {cancelText}
                    </Button>
                )}
                <Button
                    type="submit"
                    disabled={isPending}
                    className="w-full sm:flex-1 rounded-2xl h-12"
                >
                    {isPending ? pendingText : submitText}
                </Button>
            </div>

            <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('bulkImport')}</DialogTitle>
                        <DialogDescription>{t('bulkImportHint')}</DialogDescription>
                    </DialogHeader>
                    <textarea
                        value={bulkKeyInput}
                        onChange={(e) => setBulkKeyInput(e.target.value)}
                        placeholder={t('bulkImportPlaceholder')}
                        rows={8}
                        className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setBulkImportOpen(false)}>{t('bulkImportCancel')}</Button>
                        <Button type="button" onClick={handleBulkImportKeys}>{t('bulkImportConfirm')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </form>
    );
}
