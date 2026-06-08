'use client';

import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import zh_hansMessages from '../../public/locale/zh_hans.json';

const LOCALE = 'zh-Hans';

export function LocaleProvider({ children }: { children: ReactNode }) {
    return (
        <NextIntlClientProvider
            locale={LOCALE}
            messages={zh_hansMessages}
            timeZone="Asia/Shanghai"
        >
            {children}
        </NextIntlClientProvider>
    );
}

