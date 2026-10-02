import React from 'react';
import { addDays, addMonths, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';

/**
 * The month panel the app picks dates with.
 *
 * It is the same panel in every respect as the calendar that opens beside a tile
 * while an event is being duplicated (see [`DuplicateDropCalendar`](src/react/components/DuplicateDropCalendar.tsx)):
 * the same markup, the same `sleek-dup-cal*` classes and therefore the same surface,
 * month header, ‹ › navigation, Sunday-first weekday strip and day cells. Six rows are
 * always drawn — a fixed shape means the panel never changes height as the months
 * change, so it cannot shuffle the thing it is anchored to.
 *
 * The one difference is the cells: here a day is a button that can be chosen, and the
 * chosen day wears the same neutral wash and soft inset ring the duplicate panel gives
 * the day the pointer is over.
 *
 * Placement is deliberately left to the caller: the panel is flat inside whatever
 * positioned box it is rendered into, so it can hang off a form field or sit beside a
 * tile without knowing which.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const SleekMiniCalendar = ({
    month,
    onMonthChange,
    selected,
    onSelect,
    className
}: {
    /** Any date inside the month to show. */
    month: Date;
    onMonthChange: (next: Date) => void;
    /** The chosen day. Highlighted when it falls inside the month on screen. */
    selected?: Date | null;
    onSelect: (day: Date) => void;
    /** Extra classes for the panel itself, e.g. a width or placement hook. */
    className?: string;
}) => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const cells = Array.from({ length: 42 }).map((_, i) => addDays(gridStart, i));
    const today = new Date();

    return (
        <div
            className={`sleek-dup-cal sleek-mini-cal${className ? ` ${className}` : ''}`}
            aria-label="Choose a date"
        >
            <div className="sleek-dup-cal-head">
                <span className="sleek-dup-cal-title">{format(month, 'MMMM yyyy')}</span>
                <div className="sleek-dup-cal-nav">
                    <button
                        type="button"
                        className="sleek-dup-cal-navbtn"
                        title="Previous month"
                        onClick={() => onMonthChange(addMonths(month, -1))}
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        className="sleek-dup-cal-navbtn"
                        title="Next month"
                        onClick={() => onMonthChange(addMonths(month, 1))}
                    >
                        ›
                    </button>
                </div>
            </div>

            <div className="sleek-dup-cal-week">
                {WEEKDAYS.map((w, i) => (
                    <span key={i} className="sleek-dup-cal-weekday">{w}</span>
                ))}
            </div>

            <div className="sleek-dup-cal-grid">
                {cells.map((day, i) => {
                    const classes = [
                        'sleek-dup-cal-day',
                        day.getMonth() === month.getMonth() ? '' : 'is-outside',
                        isSameDay(day, today) ? 'is-today' : '',
                        selected && isSameDay(day, selected) ? 'is-selected' : ''
                    ].filter(Boolean).join(' ');

                    return (
                        <button
                            key={i}
                            type="button"
                            className={classes}
                            title={format(day, 'EEEE, MMM d')}
                            onClick={() => onSelect(day)}
                        >
                            {format(day, 'd')}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
