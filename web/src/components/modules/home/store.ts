'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RankSortMode = 'count' | 'tokens';
export type ChartMetricType = 'count' | 'tokens';
export type ChartPeriod = '1' | '7' | '30';

interface HomeViewState {
    rankSortMode: RankSortMode;
    chartMetricType: ChartMetricType;
    chartPeriod: ChartPeriod;
    setRankSortMode: (value: RankSortMode) => void;
    setChartMetricType: (value: ChartMetricType) => void;
    setChartPeriod: (value: ChartPeriod) => void;
}

export const useHomeViewStore = create<HomeViewState>()(
    persist(
        (set) => ({
            rankSortMode: 'count',
            chartMetricType: 'count',
            chartPeriod: '1',
            setRankSortMode: (value) => set({ rankSortMode: value }),
            setChartMetricType: (value) => set({ chartMetricType: value }),
            setChartPeriod: (value) => set({ chartPeriod: value }),
        }),
        {
            name: 'home-view-options-storage',
            version: 2,
            migrate: (state) => {
                const persisted = (state ?? {}) as Partial<HomeViewState>;
                return {
                    ...persisted,
                    rankSortMode: persisted.rankSortMode === 'tokens' ? 'tokens' : 'count',
                    chartMetricType: persisted.chartMetricType === 'tokens' ? 'tokens' : 'count',
                };
            },
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                rankSortMode: state.rankSortMode,
                chartMetricType: state.chartMetricType,
                chartPeriod: state.chartPeriod,
            }),
        }
    )
);
