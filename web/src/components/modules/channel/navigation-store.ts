import { create } from 'zustand';
import { useNavStore, type NavItem } from '@/components/modules/navbar';
import { useSearchStore } from '@/components/modules/toolbar/search-store';
import { useToolbarViewOptionsStore } from '@/components/modules/toolbar/view-options-store';

interface ChannelNavigationState {
    editChannelId: number | null;
    returnTo: NavItem | null;
    openEditChannel: (channelId: number, options?: { returnTo?: NavItem }) => void;
    clearEditChannel: (channelId?: number) => void;
    consumeReturnTo: () => NavItem | null;
}

export const useChannelNavigationStore = create<ChannelNavigationState>((set, get) => ({
    editChannelId: null,
    returnTo: null,
    openEditChannel: (channelId, options) => set({ editChannelId: channelId, returnTo: options?.returnTo ?? null }),
    clearEditChannel: (channelId) => {
        const current = get().editChannelId;
        if (channelId !== undefined && current !== channelId) return;
        set({ editChannelId: null });
    },
    consumeReturnTo: () => {
        const returnTo = get().returnTo;
        set({ returnTo: null });
        return returnTo;
    },
}));

export function openChannelEditor(channelId: number, options?: { returnTo?: NavItem }) {
    useChannelNavigationStore.getState().openEditChannel(channelId, options);
    useSearchStore.getState().setSearchTerm('channel', '');
    useToolbarViewOptionsStore.getState().setChannelFilter('all');
    useNavStore.getState().setActiveItem('channel');
}