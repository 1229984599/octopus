'use client';

import messages from './messages.json';

type Messages = typeof messages;
type MessageValue = string | number | boolean | null | undefined;

function getByPath(source: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
        if (typeof current !== 'object' || current === null) return undefined;
        return (current as Record<string, unknown>)[key];
    }, source);
}

function formatMessage(template: string, values?: Record<string, MessageValue>) {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = values[key];
        return value === null || value === undefined ? match : String(value);
    });
}

export function useTranslations(namespace?: string) {
    return (key: string, values?: Record<string, MessageValue>) => {
        const path = namespace ? `${namespace}.${key}` : key;
        const value = getByPath(messages as Messages, path);
        return typeof value === 'string' ? formatMessage(value, values) : path;
    };
}
