"use client"

import { cn } from "@/lib/utils"
import { useNavStore, type NavItem } from "@/components/modules/navbar"
import { ROUTES } from "@/route/config"
import { usePreload } from "@/route/use-preload"

export function NavBar() {
    const { activeItem, setActiveItem } = useNavStore()
    const { preload } = usePreload()

    return (
        <div className="relative z-50 md:min-h-screen">
            <nav
                aria-label="Main Navigation"
                className={cn(
                    "fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-3",
                    "md:sticky md:top-30 md:left-auto md:bottom-auto md:translate-x-0 md:flex-col md:gap-3",
                    "bg-sidebar text-sidebar-foreground border border-sidebar-border rounded-3xl",
                    "custom-shadow"
                )}
            >
                {ROUTES.map((route) => {
                    const isActive = activeItem === route.id
                    return (
                        <button
                            key={route.id}
                            type="button"
                            onClick={() => setActiveItem(route.id as NavItem)}
                            onMouseEnter={() => preload(route.id)}
                            className={cn(
                                "relative p-2 md:p-3 rounded-2xl z-20",
                                isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 hover:bg-sidebar-accent"
                            )}
                        >
                            {isActive && (
                                <div
                                    className="absolute inset-0 bg-sidebar-primary rounded-2xl z-0"
                                />
                            )}
                            <span className="relative z-10">
                                <route.icon strokeWidth={2} />
                            </span>
                        </button>
                    )
                })}
            </nav>
        </div>
    )
}
