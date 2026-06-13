import type { Channel, ChannelKey } from '@/api/endpoints/channel';

type KeyLike = Pick<ChannelKey, 'enabled' | 'channel_key' | 'status_code' | 'last_use_time_stamp'>;

export type KeyHealthState = 'ok' | 'disabled' | 'invalid' | 'rate-limited' | 'server-error' | 'failed' | 'unchecked';

export function getKeyHealth(key: KeyLike): KeyHealthState {
    if (!key.enabled) return 'disabled';
    const status = key.status_code || 0;
    if (status === 0) return key.last_use_time_stamp ? 'failed' : 'unchecked';
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'invalid';
    if (status === 429) return 'rate-limited';
    if (status >= 500) return 'server-error';
    return 'failed';
}

export function keyNeedsAttention(key: KeyLike): boolean {
    const state = getKeyHealth(key);
    return state !== 'ok' && state !== 'unchecked';
}

export function keyIsAvailable(key: KeyLike): boolean {
    const state = getKeyHealth(key);
    return key.enabled && key.channel_key.trim() !== '' && state !== 'invalid';
}

export function getChannelHealth(channel: Channel) {
    const totalKeys = channel.keys.length;
    const availableKeys = channel.keys.filter(keyIsAvailable).length;
    const enabledKeys = channel.keys.filter((key) => key.enabled && key.channel_key.trim()).length;
    const disabledKeys = channel.keys.filter((key) => !key.enabled).length;
    const invalidKeys = channel.keys.filter((key) => getKeyHealth(key) === 'invalid').length;
    const abnormalKeys = channel.keys.filter((key) => {
        const state = getKeyHealth(key);
        return state !== 'ok' && state !== 'unchecked';
    }).length;
    const lastCheckedAt = channel.keys.reduce((latest, item) => Math.max(latest, item.last_use_time_stamp || 0), 0);
    const needsAttention = !channel.enabled || !channel.auto_check || availableKeys === 0 || abnormalKeys > 0;

    return {
        totalKeys,
        availableKeys,
        enabledKeys,
        disabledKeys,
        invalidKeys,
        abnormalKeys,
        lastCheckedAt,
        needsAttention,
    };
}

