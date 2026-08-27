import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type NavItem = 'home' | 'channel' | 'group' | 'health' | 'autocheck' | 'log' | 'setting'

const NAV_ORDER: NavItem[] = ['home', 'channel', 'group', 'health', 'autocheck', 'log', 'setting']

function normalizeNavItem(item: unknown): NavItem {
    return NAV_ORDER.includes(item as NavItem) ? item as NavItem : 'channel'
}

interface NavState {
    activeItem: NavItem
    prevItem: NavItem | null
    direction: number
    setActiveItem: (item: NavItem) => void
}

export const useNavStore = create<NavState>()(
    persist(
        (set, get) => ({
            activeItem: 'home',
            prevItem: null,
            direction: 0,
            setActiveItem: (item) => {
                const { activeItem } = get()
                const currentIndex = NAV_ORDER.indexOf(activeItem)
                const nextItem = normalizeNavItem(item)
                const newIndex = NAV_ORDER.indexOf(nextItem)
                const direction = newIndex > currentIndex ? 1 : -1

                set({
                    activeItem: nextItem,
                    prevItem: activeItem,
                    direction
                })
            },
        }),
        {
            name: 'nav-storage',
            version: 2,
            migrate: (state) => {
                const persisted = (state ?? {}) as Partial<NavState>
                return {
                    ...persisted,
                    activeItem: normalizeNavItem(persisted.activeItem),
                    prevItem: persisted.prevItem ? normalizeNavItem(persisted.prevItem) : null,
                }
            },
        }
    )
)
