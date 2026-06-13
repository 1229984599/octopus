import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface LLMChannel {
    name: string;
    enabled: boolean;
    channel_id: number;
    channel_name: string;
}

export function useModelChannelList() {
    return useQuery({
        queryKey: ['models', 'channel'],
        queryFn: async () => {
            return apiClient.get<LLMChannel[]>('/api/v1/model/channel');
        },
        refetchInterval: 30000,
    });
}
