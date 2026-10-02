import React from 'react';
import { addDays, addMonths, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { CalendarEvent } from '../../types';

/**
 * The pop-out month that appears while an event tile is being duplicated with
 * Cmd/Ctrl held down.
 *
 * It exists so a copy can be sent to a day that isn't even on screen: the user
 * either drops the tile on one of these days, or ignores the panel entirely and
 * keeps dragging on the grid — both are handled by the same drag, so nothing is
 * committed until the pointer is released.
 *
 * The panel opens directly beside the tile being duplicated (the tile's own rect
 * is handed down as `anchor`) rather than being parked in a corner, which keeps
 * the drop target within a short reach of the thing being dropped.
 *
 * Every day cell is a dnd-kit droppable carrying `{ dupCalDay: true, date }`. The
 * grid's collision strategy ([`MainGrid`](src/react/components/MainGrid.tsx))
 * gives these priority whenever the pointer is physically inside them, because
 * the tall day columns behind the panel would otherwise always win.
 *
 * Styling is deliberately identical in spirit to the rest of the app: neutral
 * surfaces, one neutral hairline border, no accent colour anywhere. A cell only
 * ever lights up with `--background-modifier-hover` and a soft neutral ring.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Gap between the tile and the panel it opens beside. */
const PANEL_GAP = 14;
/** Minimum breathing room between the panel and the edge of the grid. */
const EDGE_PAD = 10;
/**
 * The day headers occupy the top ~82px of the grid area, so the panel never
 * climbs above them.
 */
const HEADER_SAFE = 88;

/** Stable, timezone-proof key for a day (used for the droppable id). */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const DuplicateDayCell = ({
    day,
    inMonth,
    isToday,
    isTarget
}: {
    day: Date;
    inMonth: boolean;
    isToday: boolean;
    isTarget: boolean;
}) => {
    const { setNodeRef } = useDroppable({
        id: `sleek-dup-day-${dayKey(day)}`,
        data: { dupCalDay: true, date: day }
    });

    const classes = [
        'sleek-dup-cal-day',
        inMonth ? '' : 'is-outside',
        isToday ? 'is-today' : '',
        isTarget ? 'is-drop-target' : ''
    ].filter(Boolean).join(' ');

    return (
        <div
            ref={setNodeRef}
            className={classes}
            title={format(day, 'EEEE, MMM d')}
        >
            {format(day, 'd')}
        </div>
    );
};

export const DuplicateDropCalendar = ({
    month,
    onMonthChange,
    anchor,
    hostRef,
    preview
}: {
    /** Any date inside the month to show. */
    month: Date;
    onMonthChange: (next: Date) => void;
    /** Viewport rect of the tile being duplicated, used to place the panel. */
    anchor: { left: number; top: number; right: number; bottom: number };
    /** The panel's containing block, measured to keep the panel inside the grid. */
    hostRef?: React.RefObject<HTMLDivElement | null>;
    /** The event being copied, used for the footer's time-of-day readout. */
    preview?: CalendarEvent | null;
}) => {
    // Reading `over` straight from the drag context means the panel and its footer
    // always agree with whichever cell dnd-kit has actually resolved as the target.
    const { over } = useDndContext();
    const overData = over?.data.current as { dupCalDay?: boolean; date?: Date } | undefined;
    const targetDay = overData?.dupCalDay && overData.date ? overData.date : null;

    // The panel itself is droppable too, so a pointer over its header or padding is
    // absorbed here instead of falling through to a day column hidden behind it.
    const { setNodeRef } = useDroppable({
        id: 'sleek-dup-cal-panel',
        data: { dupCalPanel: true }
    });

    // A stable merged ref: dnd-kit needs the node for measuring, the positioning
    // effect needs it to write its coordinates. A fresh callback every render would
    // make React detach and re-attach the ref (and re-register the droppable) on
    // every pass, so the two are combined once.
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const setPanelRef = React.useCallback((node: HTMLDivElement | null) => {
        panelRef.current = node;
        setNodeRef(node);
    }, [setNodeRef]);

    // Anchoring is done imperatively: the panel is measured and positioned right
    // after layout, off the tile's own rect, so the panel can never be painted in
    // one place and then jump to another. It sits beside the tile, flipping to the
    // tile's other side when it would otherwise run off the grid.
    React.useLayoutEffect(() => {
        const host = hostRef?.current;
        const panel = panelRef.current;
        if (!host || !panel) return;

        const hostRect = host.getBoundingClientRect();
        const panelW = panel.offsetWidth || 320;
        const panelH = panel.offsetHeight || 360;

        const tileLeft = anchor.left - hostRect.left;
        const tileRight = anchor.right - hostRect.left;
        const tileTop = anchor.top - hostRect.top;
        const tileBottom = anchor.bottom - hostRect.top;

        let left = tileRight + PANEL_GAP;
        if (left + panelW > hostRect.width - EDGE_PAD) {
            left = tileLeft - PANEL_GAP - panelW;
        }
        left = Math.max(EDGE_PAD, Math.min(left, Math.max(EDGE_PAD, hostRect.width - panelW - EDGE_PAD)));

        // Vertically centred on the tile, but never tucked under the day headers.
        const centred = (tileTop + tileBottom) / 2 - panelH / 2;
        const top = Math.max(
            HEADER_SAFE,
            Math.min(centred, Math.max(HEADER_SAFE, hostRect.height - panelH - EDGE_PAD))
        );

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.right = 'auto';
    });

    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    // Six rows always — a fixed shape means the panel never resizes mid-drag.
    const cells = Array.from({ length: 42 }).map((_, i) => addDays(gridStart, i));
    const today = new Date();

    const timeRange = preview
        ? `${format(preview.startTime, 'h:mm a')} – ${format(preview.endTime, 'h:mm a')}`
        : '';

    return (
        <div
            className="sleek-dup-cal"
            ref={setPanelRef}
            aria-label="Duplicate to another day"
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
                {cells.map((day, i) => (
                    <DuplicateDayCell
                        key={i}
                        day={day}
                        inMonth={day.getMonth() === month.getMonth()}
                        isToday={isSameDay(day, today)}
                        isTarget={Boolean(targetDay && isSameDay(day, targetDay))}
                    />
                ))}
            </div>

            <div className={`sleek-dup-cal-foot${targetDay ? ' is-targeting' : ''}`}>
                {targetDay ? (
                    <>
                        <span className="sleek-dup-cal-foot-target">
                            {format(targetDay, 'EEEE, MMM d')}
                            {timeRange ? ` · ${timeRange}` : ''}
                        </span>
                        <span className="sleek-dup-cal-hint">Release to drop the copy here</span>
                    </>
                ) : (
                    <span className="sleek-dup-cal-hint">
                        Drop the copy on a day here — or keep dragging on the grid
                    </span>
                )}
            </div>
        </div>
    );
};
