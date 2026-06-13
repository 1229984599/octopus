'use client';

import { PageWrapper } from '@/components/common/PageWrapper';
import { SettingAutoCheck } from '@/components/modules/setting/AutoCheck';

export function AutoCheckPage() {
    return (
        <div className="h-full min-h-0 overflow-y-auto overscroll-contain rounded-t-3xl">
            <PageWrapper className="pb-24 md:pb-4">
                <SettingAutoCheck />
            </PageWrapper>
        </div>
    );
}
