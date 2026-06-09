import { create } from 'zustand';
import { useNavStore } from '@/components/modules/navbar';
import { useSearchStore } from '@/components/modules/toolbar/search-store';
import { useToolbarViewOptionsStore } from '@/components/modules/toolbar/view-options-store';

interface ChannelNavigationState {
    editChannelId: number | null;
    openEditChannel: (channelId: number) => void;
    clearEditChannel: (channelId?: number) => void;
}

export const useChannelNavigationStore = create<ChannelNavigationState>((set, get) => ({
    editChannelId: null,
    openEditChannel: (channelId) => set({ editChannelId: channelId }),
    clearEditChannel: (channelId) => {
        const current = get().editChannelId;
        if (channelId !== undefined && current !== channelId) return;
        set({ editChannelId: null });
    },
}));

export function openChannelEditor(channelId: number) {
    useChannelNavigationStore.getState().openEditChannel(channelId);
    useSearchStore.getState().setSearchTerm('channel', '');
    useToolbarViewOptionsStore.getState().setChannelFilter('all');
    useNavStore.getState().setActiveItem('channel');
}
