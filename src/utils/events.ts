import { CalendarEvent } from '../types';

/**
 * Returns true when at least one event overlaps the given calendar day.
 *
 * Overlap (rather than a simple "starts on this day" check) is used so
 * multi-day events also mark every day they span.
 */
export const eventOccursOnDay = (events: CalendarEvent[] | undefined, day: Date): boolean => {
    if (!events || events.length === 0) return false;
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();
    return events.some(ev => {
        const start = new Date(ev.startTime).getTime();
        const end = new Date(ev.endTime).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return false;
        return start < dayEndMs && end > dayStartMs;
    });
};
