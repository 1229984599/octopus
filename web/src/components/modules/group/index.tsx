'use client';

import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { GroupCard } from './Card';
import { type Group as GroupData, useGroupList, useUpdateGroup } from '@/api/endpoints/group';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { cn } from '@/lib/utils';
import { toast } from '@/components/common/Toast';
import { useTranslations } from '@/lib/translations';

function reorderList<T>(list: T[], startIndex: number, endIndex: number): T[] {
    const result = [...list];
    const [removed] = result.splice(startIndex, 1);
    if (!removed) return list;
    result.splice(endIndex, 0, removed);
    return result;
}

const AUTO_SCROLL_EDGE_SIZE = 96;
const AUTO_SCROLL_MAX_STEP = 24;

export function Group() {
    const { data: groups } = useGroupList();
    const updateGroup = useUpdateGroup();
    const t = useTranslations('group');
    const pageKey = 'group' as const;
    const searchTerm = useSearchStore((s) => s.getSearchTerm(pageKey));
    const sortField = useToolbarViewOptionsStore((s) => s.getSortField(pageKey));
    const sortOrder = useToolbarViewOptionsStore((s) => s.getSortOrder(pageKey));
    const setSortConfig = useToolbarViewOptionsStore((s) => s.setSortConfig);
    const filter = useToolbarViewOptionsStore((s) => s.groupFilter);
    const [localOrder, setLocalOrder] = useState<GroupData[] | null>(null);
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dropTargetId, setDropTargetId] = useState<number | null>(null);
    const [dropSide, setDropSide] = useState<'before' | 'after'>('before');
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    const sortedGroups = useMemo(() => {
        const source = localOrder ?? groups;
        if (!source) return [];
        return [...source].sort((a, b) => {
            const diff = sortField === 'name'
                ? a.name.localeCompare(b.name)
                : ((a.sort_order ?? a.id ?? 0) - (b.sort_order ?? b.id ?? 0));
            return sortOrder === 'asc' ? diff : -diff;
        });
    }, [groups, localOrder, sortField, sortOrder]);

    const visibleGroups = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        const byName = !term ? sortedGroups : sortedGroups.filter((g) => g.name.toLowerCase().includes(term));

        if (filter === 'with-members') return byName.filter((g) => (g.items?.length || 0) > 0);
        if (filter === 'empty') return byName.filter((g) => (g.items?.length || 0) === 0);

        return byName;
    }, [sortedGroups, searchTerm, filter]);

    const dragDisabled = searchTerm.trim() !== '' || filter !== 'all';

    const persistOrder = useCallback((nextVisible: GroupData[]) => {
        if (sortField !== 'created' || sortOrder !== 'asc') {
            setSortConfig(pageKey, 'created', 'asc');
        }

        const updates = nextVisible
            .filter((group): group is GroupData & { id: number } => typeof group.id === 'number')
            .map((group, index) => updateGroup.mutateAsync({ id: group.id, sort_order: index + 1 }));

        Promise.all(updates)
            .then(() => toast.success(t('toast.sorted')))
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                toast.error(t('toast.sortFailed'), { description: message });
            });
    }, [setSortConfig, sortField, sortOrder, t, updateGroup]);

    const applyReorder = useCallback((from: number, to: number) => {
        if (from === to) return;
        const reorderedVisible = reorderList(visibleGroups, from, to);
        const reorderedIds = new Set(reorderedVisible.map((group) => group.id));
        const allGroups = sortedGroups.filter((group) => !reorderedIds.has(group.id));
        const next = [...reorderedVisible, ...allGroups].map((group, index) => ({ ...group, sort_order: index + 1 }));
        setLocalOrder(next);
        persistOrder(reorderedVisible);
    }, [persistOrder, sortedGroups, visibleGroups]);

    const autoScrollDuringDrag = useCallback((clientY: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const distanceToTop = clientY - rect.top;
        const distanceToBottom = rect.bottom - clientY;
        let delta = 0;
        if (distanceToTop < AUTO_SCROLL_EDGE_SIZE) {
            delta = -Math.ceil(((AUTO_SCROLL_EDGE_SIZE - distanceToTop) / AUTO_SCROLL_EDGE_SIZE) * AUTO_SCROLL_MAX_STEP);
        } else if (distanceToBottom < AUTO_SCROLL_EDGE_SIZE) {
            delta = Math.ceil(((AUTO_SCROLL_EDGE_SIZE - distanceToBottom) / AUTO_SCROLL_EDGE_SIZE) * AUTO_SCROLL_MAX_STEP);
        }
        if (delta !== 0) container.scrollBy({ top: delta, behavior: 'auto' });
    }, []);

    const setEdgeDropTarget = useCallback((clientY: number) => {
        const container = scrollContainerRef.current;
        if (!container || visibleGroups.length === 0) return;
        const rect = container.getBoundingClientRect();
        if (clientY < rect.top + AUTO_SCROLL_EDGE_SIZE) {
            const first = visibleGroups[0];
            if (first?.id && first.id !== draggingId) {
                setDropTargetId(first.id);
                setDropSide('before');
            }
        } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_SIZE) {
            const last = visibleGroups[visibleGroups.length - 1];
            if (last?.id && last.id !== draggingId) {
                setDropTargetId(last.id);
                setDropSide('after');
            }
        }
    }, [draggingId, visibleGroups]);

    const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>, groupId?: number) => {
        if (dragDisabled || !groupId) return;
        setDraggingId(groupId);
        setDropTargetId(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(groupId));
        const card = event.currentTarget.closest('[data-group-card]');
        if (card instanceof HTMLElement) {
            event.dataTransfer.setDragImage(card, Math.min(card.offsetWidth / 2, 180), 24);
        }
    }, [dragDisabled]);

    const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>, groupId?: number) => {
        if (dragDisabled || !draggingId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        autoScrollDuringDrag(event.clientY);
        if (!groupId || draggingId === groupId) {
            setEdgeDropTarget(event.clientY);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const nextSide = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        setDropSide(nextSide);
        setDropTargetId(groupId);
    }, [autoScrollDuringDrag, dragDisabled, draggingId, setEdgeDropTarget]);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>, targetGroupId?: number) => {
        event.preventDefault();
        const sourceGroupId = Number(event.dataTransfer.getData('text/plain') || draggingId);
        setDraggingId(null);
        setDropTargetId(null);
        const resolvedTargetGroupId = targetGroupId ?? dropTargetId;
        if (dragDisabled || !sourceGroupId || !resolvedTargetGroupId || sourceGroupId === resolvedTargetGroupId) return;
        const from = visibleGroups.findIndex((group) => group.id === sourceGroupId);
        const targetIndex = visibleGroups.findIndex((group) => group.id === resolvedTargetGroupId);
        if (from < 0 || targetIndex < 0) return;
        let to = dropSide === 'after' ? targetIndex + 1 : targetIndex;
        if (from < to) to -= 1;
        to = Math.max(0, Math.min(to, visibleGroups.length - 1));
        applyReorder(from, to);
    }, [applyReorder, dragDisabled, draggingId, dropSide, dropTargetId, visibleGroups]);

    const handleDragEnd = useCallback(() => {
        setDraggingId(null);
        setDropTargetId(null);
        setDropSide('before');
    }, []);

    return (
        <div
            ref={scrollContainerRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="h-full min-h-0 overflow-y-auto rounded-t-3xl"
        >
            <div className="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleGroups.map((group) => {
                    const isDragging = draggingId === group.id;
                    const isDropTarget = dropTargetId === group.id;
                    return (
                        <div
                            key={String(group.id ?? group.name)}
                            onDragOver={(event) => handleDragOver(event, group.id)}
                            onDrop={(event) => handleDrop(event, group.id)}
                            className={cn(
                                'relative min-w-0 rounded-3xl transition-[opacity,transform]',
                                isDragging && 'scale-[0.98] opacity-45'
                            )}
                        >
                            {isDropTarget && (
                                <div
                                    className={cn(
                                        'pointer-events-none absolute inset-y-3 z-30 flex w-1.5 items-center justify-center rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]',
                                        dropSide === 'before' ? '-left-2' : '-right-2'
                                    )}
                                >
                                    <span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary" />
                                    <span
                                        className={cn(
                                            'absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground shadow-lg',
                                            dropSide === 'before' ? 'left-3' : 'right-3'
                                        )}
                                    >
                                        {dropSide === 'before' ? t('detail.actions.dropBefore') : t('detail.actions.dropAfter')}
                                    </span>
                                </div>
                            )}
                            <GroupCard
                                group={group}
                                dragHandleProps={{
                                    draggable: !dragDisabled && !!group.id,
                                    onDragStart: (event) => handleDragStart(event, group.id),
                                    onDragEnd: handleDragEnd,
                                }}
                                dragDisabled={dragDisabled || !group.id}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

