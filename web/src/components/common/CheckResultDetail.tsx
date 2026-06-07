'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { cn } from '@/lib/utils';

type CheckResultDetailProps = {
    ok: boolean;
    label: string;
    detail?: string;
    className?: string;
};

export function CheckResultDetail({ ok, label, detail, className }: CheckResultDetailProps) {
    const triggerClassName = cn(
        'h-5 rounded px-1.5 text-[10px] font-medium leading-5',
        ok
            ? 'bg-green-500/15 text-green-700 dark:text-green-400'
            : 'bg-red-500/15 text-red-700 dark:text-red-400',
        detail && 'cursor-help',
        className
    );

    if (!detail) {
        return <span className={triggerClassName}>{label}</span>;
    }

    return (
        <>
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" className={cn(triggerClassName, 'md:hidden')}>
                        {label}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 rounded-xl p-3 text-xs">
                    <p className="break-words whitespace-pre-wrap leading-5">{detail}</p>
                </PopoverContent>
            </Popover>

            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button type="button" className={cn(triggerClassName, 'hidden md:inline-flex')}>
                            {label}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-96">
                        <span className="block max-w-80 break-words whitespace-pre-wrap leading-5">{detail}</span>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </>
    );
}
