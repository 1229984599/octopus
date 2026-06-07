'use client';

import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import zh_hansMessages from '../../public/locale/zh_hans.json';

export function LocaleProvider({ children }: { children: ReactNode }) {
    return (
        <NextIntlClientProvider
            locale="zh_hans"
            messages={zh_hansMessages}
            timeZone="Asia/Shanghai"
        >
            {children}
        </NextIntlClientProvider>
    );
}

