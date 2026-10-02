/**
 * Time-zone helpers.
 *
 * The plugin stores a single time-zone string (an IANA name, or 'auto' to use
 * the system zone). `getNowInTimeZone` returns a Date whose *local* getters
 * (getHours, getDate, ...) reflect the wall-clock time in the requested zone,
 * which is exactly what the calendar UI needs for the "now" indicator, the
 * highlighted current hour and "today" detection.
 */
export const AUTO_TIME_ZONE = 'auto';

export interface TimeZoneOption {
    value: string;
    label: string;
}

export const TIME_ZONE_OPTIONS: TimeZoneOption[] = [
    { value: AUTO_TIME_ZONE, label: 'System (local)' },
    { value: 'UTC', label: 'UTC' },
    { value: 'America/New_York', label: 'New York (ET)' },
    { value: 'America/Chicago', label: 'Chicago (CT)' },
    { value: 'America/Denver', label: 'Denver (MT)' },
    { value: 'America/Phoenix', label: 'Phoenix (MST)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
    { value: 'America/Anchorage', label: 'Anchorage (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
    { value: 'America/Toronto', label: 'Toronto (ET)' },
    { value: 'America/Mexico_City', label: 'Mexico City (CT)' },
    { value: 'America/Sao_Paulo', label: 'Sao Paulo (BRT)' },
    { value: 'America/Buenos_Aires', label: 'Buenos Aires (ART)' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris (CET)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET)' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)' },
    { value: 'Europe/Rome', label: 'Rome (CET)' },
    { value: 'Europe/Athens', label: 'Athens (EET)' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
    { value: 'Africa/Cairo', label: 'Cairo (EET)' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST)' },
    { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
    { value: 'Asia/Kolkata', label: 'Kolkata (IST)' },
    { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Seoul', label: 'Seoul (KST)' },
    { value: 'Australia/Perth', label: 'Perth (AWST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AET)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZT)' }
];

export const isAutoTimeZone = (timeZone?: string): boolean =>
    !timeZone || timeZone === AUTO_TIME_ZONE;

/** Resolve the effective IANA time-zone id. */
export const resolveTimeZone = (timeZone?: string): string => {
    if (!isAutoTimeZone(timeZone)) return timeZone as string;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
};

/**
 * Returns a Date whose local getters represent the wall-clock time in the
 * requested time zone. For 'auto' this is simply the real local Date.
 */
export const getNowInTimeZone = (timeZone?: string, source: Date = new Date()): Date => {
    if (isAutoTimeZone(timeZone)) return new Date(source.getTime());
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).formatToParts(source);
        const map: Record<string, string> = {};
        for (const p of parts) map[p.type] = p.value;
        const hour = map.hour === '24' ? '0' : map.hour;
        return new Date(
            Number(map.year),
            Number(map.month) - 1,
            Number(map.day),
            Number(hour),
            Number(map.minute),
            Number(map.second)
        );
    } catch {
        return new Date(source.getTime());
    }
};

/** Human readable short label (e.g. "GMT-6") for the effective zone. */
export const getTimeZoneLabel = (timeZone?: string, source: Date = new Date()): string => {
    const tz = resolveTimeZone(timeZone);
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(source);
        return parts.find(p => p.type === 'timeZoneName')?.value || tz;
    } catch {
        return tz;
    }
};

/** City portion of an IANA zone id, e.g. "America/Denver" → "Denver". */
export const getTimeZoneCity = (timeZone?: string): string => {
    const tz = resolveTimeZone(timeZone);
    const segments = tz.split('/');
    const city = segments[segments.length - 1] || tz;
    return city.replace(/_/g, ' ');
};

/** Short GMT offset (e.g. "GMT-6") for the effective zone. */
export const getTimeZoneOffsetLabel = (timeZone?: string, source: Date = new Date()): string => {
    const tz = resolveTimeZone(timeZone);
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(source);
        const name = parts.find(p => p.type === 'timeZoneName')?.value;
        if (name) return name;
    } catch {
        // fall through to the short-name fallback
    }
    return getTimeZoneLabel(tz, source);
};

/**
 * Compact, Notion-Calendar-style zone label, e.g. "GMT-6 Denver".
 */
export const getTimeZoneDisplayLabel = (timeZone?: string, source: Date = new Date()): string => {
    const tz = resolveTimeZone(timeZone);
    const offset = getTimeZoneOffsetLabel(tz, source);
    const city = getTimeZoneCity(tz);
    if (!city || city.toLowerCase() === offset.toLowerCase()) return offset;
    return `${offset} ${city}`.trim();
};

/**
 * Offset of a zone from UTC, in minutes, at the given instant
 * (positive = east of UTC). Used to shift an event when its zone changes.
 */
export const getTimeZoneOffsetMinutes = (timeZone: string, date: Date): number => {
    const tz = resolveTimeZone(timeZone);
    if (tz === 'UTC') return 0;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).formatToParts(date);
        const map: Record<string, string> = {};
        for (const p of parts) map[p.type] = p.value;
        const hour = map.hour === '24' ? '0' : map.hour;
        const asUTC = Date.UTC(
            Number(map.year),
            Number(map.month) - 1,
            Number(map.day),
            Number(hour),
            Number(map.minute),
            Number(map.second)
        );
        const aligned = Math.floor(date.getTime() / 1000) * 1000;
        return Math.round((asUTC - aligned) / 60000);
    } catch {
        return 0;
    }
};
