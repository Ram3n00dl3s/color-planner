import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    addDays,
    addMonths,
    differenceInCalendarDays,
    format,
    getDaysInMonth,
    isSameDay,
    isSameMonth,
    startOfMonth,
    startOfWeek
} from 'date-fns';
import { CalendarEvent } from '../../types';
import { MonthCopyConfirmDialog } from './MonthCopyConfirmDialog';
import {
    DEFAULT_ACCENT_HEX,
    EVENT_COLOR_HEX,
    PALETTE_ORDER,
    oppositeDayColorName,
    resolveAccentHex,
    randomDayColorName
} from '../../utils/colors';

/**
 * A full-month calendar view.
 *
 * This is the alternative to the day columns: seven days across, and a whole
 * month down, so a busy stretch can be read at a glance without scrolling. It
 * deliberately borrows the app's own palette and surfaces — a day tile is the
 * same pastel as an event tile, a quiet day wears the user's chosen default,
 * and the busy days are walked in date order with each colour the opposite of
 * the one before it, so a run of event days reads as a deliberate back-and-forth
 * across the colour wheel — and the month reads as the same calendar in a
 * different shape rather than a new one.
 *
 * There is no timeline here: the hour scale belongs to the day view and would
 * be meaningless at a month's zoom. The left ruler is dropped entirely and the
 * day headers are replaced by a compact weekday strip, which lights the column
 * the pointer — or the last click — is in, so it is obvious which weekday a tile
 * belongs to.
 *
 * The wheel rolls the calendar itself. The months sit on a vertical track and the wheel pulls
 * that track instead of stepping it, so the calendar comes to rest wherever the wheel left it —
 * a little of two months meeting across the middle is as valid a place to stop as a whole
 * month, and the join between them keeps the very same gap the weeks inside a month keep, so the
 * seam reads as just another row gap rather than the two months buttered together. A month pulled
 * all the way past rolls on underneath, so a whole year can be crossed in one gesture and the
 * scroll never reaches an end. The ‹ › arrows remain the ones that step cleanly, a whole month at
 * a time.
 *
 * A day can also be dragged onto another day, which is the month's own answer to the day view's
 * duplicate-a-tile drag: the whole day's events are carried to the day the pointer is let go on,
 * and only once a confirmation has been answered — so a slip of the mouse can never quietly
 * duplicate a day. The day being dragged from stays marked for the whole gesture, the day under
 * the pointer says it will take the copy, and a small chip travels with the cursor saying how
 * many events are in hand. Nothing leaves the original day; it is the copy that is made.
 *
 * Each in-month tile can be right-clicked for the same quiet menu the event
 * tiles use: a row of quick swatches, the full palette behind the droplet, and
 * a couple of neutral actions. A day cannot be deleted, so that option is never
 * offered. All colours are inline (never coloured borders), and no purple or
 * accent variable is ever used — the colour lives on the tile's own background.
 */

/** Stable, timezone-proof key for a day (used for per-day colour overrides). */
export const monthDayKey = (d: Date): string =>
    `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Wheel travel, in pixels, that pulls the track one whole month along.
 *
 * This is deliberately heavy. A mouse wheel has no half measures — the smallest movement it
 * can report is a whole notch, about 100px in Chromium, the engine Obsidian runs on — so if a
 * month were cheap to cross the tiniest nudge would turn it straight over. At this weight one
 * notch leans the track over by only about a twelfth of a month and leaves it there, so the
 * wheel creeps the calendar along rather than flicking it, and a whole month — a full turn of
 * the wheel — takes a deliberate, unhurried spin.
 */
const WHEEL_PX_PER_MONTH = 1200;

/**
 * The months the track keeps mounted, as offsets from the one being shown. Two either side
 * rather than one so that a month still easing past the edge is never unmounted while any
 * part of it is on screen.
 */
const PANE_OFFSETS = [-2, -1, 0, 1, 2];

/**
 * How far the pointer must travel after going down on a day before the press counts as a drag
 * rather than a click. Small enough to feel immediate, large enough that the wobble of an
 * ordinary click never turns into a copy.
 */
const COPY_DRAG_THRESHOLD = 6;

/**
 * The most event lines a day tile will ever list.
 *
 * A month is a map, not a day — the tiles read best when they stay quiet — so this is
 * deliberately small: one or two titles past the first is all it takes to tell a busy day
 * from a quiet one. The tile takes as many lines as it has real room for up to this many,
 * which is why a bigger window (or a four-week month) shows slightly more than a cramped one.
 */
const MAX_TILE_EVENT_ROWS = 3;

/** The handful of swatches offered straight away, before the full palette. */
const QUICK_COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'pink', 'teal'];

const hexOf = (name?: string | null): string =>
    resolveAccentHex(name) || DEFAULT_ACCENT_HEX;

/** Shared styling for a neutral menu row (mirrors the event tile menu). */
const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-normal, #e2e8f0)',
    transition: 'background-color 0.1s ease'
};

const MonthDayTile = ({
    day,
    inMonth,
    isToday,
    isSelected,
    events,
    maxRows = MAX_TILE_EVENT_ROWS,
    colorName,
    hasOverride,
    onChangeColor,
    onResetColor,
    onOpenDay,
    onHoverDow,
    onPulseDow,
    onDropItem,
    onTilePointerDown
}: {
    day: Date;
    inMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
    events: CalendarEvent[];
    /**
     * The most event lines this tile has room for, measured by the month above from the tile's
     * own height. The tile lists as many events as fit up to this, and folds whatever is left
     * into its quiet "+N more".
     */
    maxRows?: number;
    colorName: string;
    hasOverride: boolean;
    onChangeColor: (color: string) => void;
    onResetColor: () => void;
    onOpenDay: (day: Date) => void;
    /** Report the weekday column the pointer is in, so the strip up top can mark it. */
    onHoverDow: (dow: number | null) => void;
    /** Report a click's weekday column, for a one-shot highlight before the view swaps. */
    onPulseDow: (dow: number) => void;
    /**
     * A to-do or a note was dropped on this tile. Owned by the grid above: a month
     * tile is a whole day, so only the day matters and no position is read.
     */
    onDropItem?: (e: React.DragEvent, day: Date) => void;
    /**
     * The pointer went down on this tile with the left button, carrying the tile element
     * itself. The month above watches the gesture and, if the pointer travels, turns it
     * into a day-to-day copy — so the tile only has to say that it was pressed.
     */
    onTilePointerDown?: (e: React.PointerEvent, day: Date, el: HTMLElement) => void;
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [menuPos, setMenuPos] = useState<{ x: number; y: number; flippedX?: boolean; flippedY?: boolean }>({ x: 0, y: 0 });
    const [showPalette, setShowPalette] = useState(false);
    // One-shot acknowledgement for a right-click, borrowed straight from the event
    // tiles in the day view: a hair's width of press before the menu lands. Dropped
    // to false and re-added on the next frame so a repeated right-click replays it.
    const [isContextPulsing, setIsContextPulsing] = useState(false);
    // True while a to-do or a note hovers this tile, so it can say it will take the
    // drop. A neutral ring only — the same language the day columns' targets use.
    const [isDropTarget, setIsDropTarget] = useState(false);

    const bg = hexOf(colorName);

    // How much of the day the tile can afford to say. Room is taken first for the "+N more"
    // line whenever there is more to tell than there is space to tell it, so the list never
    // promises a row it cannot show; when the day fits whole, every title is shown instead.
    const fitsAll = events.length <= maxRows;
    const visibleCount = fitsAll ? events.length : Math.max(1, maxRows - 1);
    const hiddenCount = events.length - visibleCount;
    const visibleEvents = events.slice(0, visibleCount);

    useEffect(() => {
        if (!showMenu) return;
        const close = () => {
            setShowMenu(false);
            setShowPalette(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('click', close);
        window.addEventListener('pointerdown', close);
        window.addEventListener('contextmenu', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('contextmenu', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [showMenu]);

    const handleContextMenu = (e: React.MouseEvent) => {
        if (!inMonth) return;
        e.preventDefault();
        e.stopPropagation();

        let x = e.clientX;
        let y = e.clientY;
        let flippedX = false;
        let flippedY = false;
        if (x + 236 > window.innerWidth - 10) {
            x = e.clientX - 236;
            flippedX = true;
        }
        if (y + 250 > window.innerHeight - 10) {
            y = e.clientY - 250;
            flippedY = true;
        }
        setMenuPos({ x, y, flippedX, flippedY });
        setShowPalette(false);
        setShowMenu(true);

        // The day tile's own version of the event tile press: drop the class for one
        // frame, re-add on the next, so the keyframe restarts even on a rapid second
        // right-click instead of sitting still.
        setIsContextPulsing(false);
        requestAnimationFrame(() => setIsContextPulsing(true));
    };

    // A plain click opens the day in the day view, so the month acts as a map you
    // click through into the day-by-day view — landing on the day you picked, with
    // however many days were last in view.
    const handleClick = () => {
        onOpenDay(day);
    };

    // --- Taking a dropped to-do or note ------------------------------------------
    // A month tile is a day, not an hour, so a drop here carries no time: the tile
    // only has to say which day it is and the grid above does the rest. The highlight
    // is offered only for payloads the calendar actually understands, so an unrelated
    // drag passes straight through instead of swallowing the drop.

    const carriesDroppable = (e: React.DragEvent): boolean => {
        const types = Array.from(e.dataTransfer?.types || []);
        return types.some(t =>
            t === 'application/x-obsidian-calendar-todo' ||
            t === 'application/json' ||
            t === 'text/plain'
        );
    };

    const handleTileDragOver = (e: React.DragEvent) => {
        if (!onDropItem || !carriesDroppable(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!isDropTarget) setIsDropTarget(true);
    };

    const handleTileDragLeave = () => {
        if (isDropTarget) setIsDropTarget(false);
    };

    const handleTileDrop = (e: React.DragEvent) => {
        if (!onDropItem) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDropTarget(false);
        onDropItem(e, day);
    };

    const pickColor = (color: string) => {
        onChangeColor(color);
        setShowMenu(false);
        setShowPalette(false);
    };

    const renderSwatch = (name: string, size: number) => {
        const isCurrent = colorName === name;
        return (
            <div
                key={name}
                title={name.replace(/-/g, ' ')}
                onClick={(e) => {
                    e.stopPropagation();
                    pickColor(name);
                }}
                style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    borderRadius: '50%',
                    background: hexOf(name),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    border: isCurrent ? '2px solid var(--text-normal, #ffffff)' : '1px solid rgba(0, 0, 0, 0.2)',
                    boxShadow: isCurrent ? '0 0 0 1px rgba(0, 0, 0, 0.45)' : 'none',
                    flexShrink: 0,
                    transition: 'transform 0.12s ease, border-color 0.12s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
            >
                {isCurrent && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 0, 0, 0.8)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                )}
            </div>
        );
    };

    // A day spilling in from a neighbouring month keeps the grid's columns open, so the month's
    // own days land under their proper weekdays — but it wears nothing of its own. No tile, no
    // number, and not the today or selected ring: those would leave a ring and a digit hanging
    // in the seam between two months, floating over empty space, which reads as a ghost day that
    // belongs to no month at all. It stays a cell so it can still take a drop while something is
    // being carried, and so the weeks above and below it never shift.
    return (
        <div
            className={`month-day-tile${!inMonth ? ' is-outside' : ''}${inMonth && isToday ? ' is-today' : ''}${inMonth && isSelected ? ' is-selected' : ''}${isContextPulsing ? ' context-pulse' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
            style={inMonth ? { background: bg } : undefined}
            title={
                events.length > 0
                    ? `${format(day, 'EEEE, MMMM d')} — ${events.length} event${events.length === 1 ? '' : 's'}`
                    : format(day, 'EEEE, MMMM d')
            }
            /* The day as a plain `YYYY-MM-DD`, so the drag above can read back which day the
               pointer is over without a map of elements to dates. */
            data-day={format(day, 'yyyy-MM-dd')}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onMouseEnter={() => onHoverDow(day.getDay())}
            onMouseLeave={() => onHoverDow(null)}
            onPointerDown={(e) => {
                onPulseDow(day.getDay());
                if (onTilePointerDown) onTilePointerDown(e, day, e.currentTarget as HTMLElement);
            }}
            onDragOver={handleTileDragOver}
            onDragLeave={handleTileDragLeave}
            onDrop={handleTileDrop}
        >
            {inMonth && <span className="month-day-number">{format(day, 'd')}</span>}

            {/* A small hint of what the day holds: as many one-line titles as the tile has
       room for, then a quiet "+N more" for the rest. Kept deliberately brief — at a
       month's zoom the tile can only ever suggest detail, and the room it has is what
       decides how much of the day it shows. */}
            {inMonth && events.length > 0 && (
                <div className="month-day-events">
                    {visibleEvents.map((ev) => (
                        <span key={ev.id} className="month-day-event-title">{ev.title || 'Event'}</span>
                    ))}
                    {hiddenCount > 0 && (
                        <span className="month-day-event-more">+{hiddenCount} more</span>
                    )}
                </div>
            )}

            {showMenu && inMonth && createPortal(
                <div
                    className="event-context-menu"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        left: `${menuPos.x}px`,
                        top: `${menuPos.y}px`,
                        zIndex: 4000,
                        transformOrigin: menuPos.flippedX ? (menuPos.flippedY ? 'bottom right' : 'top right') : (menuPos.flippedY ? 'bottom left' : 'top left'),
                        minWidth: '224px',
                        background: 'rgba(28, 29, 32, 0.95)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '12px',
                        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3)',
                        padding: '8px 6px',
                        userSelect: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                    }}
                >
                    {/* Which day this menu is for — the tile's own date, said in full. */}
                    <div style={{ padding: '4px 8px 8px 8px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.01em', color: 'var(--text-normal, #e2e8f0)' }}>
                        {format(day, 'EEEE, MMM d')}
                    </div>

                    {/* Quick swatches plus the droplet that opens the full palette. */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', padding: '4px 6px 8px 6px' }}>
                        {QUICK_COLORS.map((c) => renderSwatch(c, 20))}

                        <div className="color-picker-wrapper" style={{ position: 'relative', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <button
                                type="button"
                                className={`more-colors-btn ${showPalette ? 'active' : ''}`}
                                title="More colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowPalette((p) => !p);
                                }}
                                style={{
                                    width: '26px',
                                    height: '26px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxSizing: 'border-box',
                                    padding: 0,
                                    outline: 'none',
                                    boxShadow: 'none',
                                    background: 'transparent',
                                    border: 'none',
                                    color: showPalette ? 'var(--text-normal, #ffffff)' : 'var(--text-muted, rgba(255, 255, 255, 0.6))'
                                }}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                                </svg>
                            </button>

                            {showPalette && (
                                <div
                                    className="color-palette-popover"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: menuPos.flippedY ? 'auto' : 'calc(100% + 10px)',
                                        bottom: menuPos.flippedY ? 'calc(100% + 10px)' : 'auto',
                                        zIndex: 4100,
                                        background: 'rgba(28, 29, 32, 0.98)',
                                        backdropFilter: 'blur(20px)',
                                        WebkitBackdropFilter: 'blur(20px)',
                                        border: '1px solid rgba(255, 255, 255, 0.12)',
                                        borderRadius: '10px',
                                        padding: '10px',
                                        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
                                        width: '162px',
                                        maxHeight: '162px',
                                        overflowY: 'auto',
                                        overflowX: 'hidden',
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(5, 1fr)',
                                        justifyItems: 'center',
                                        alignItems: 'center',
                                        gap: '6px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    {PALETTE_ORDER.map((c) => renderSwatch(c, 22))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '0 4px 4px 4px' }} />

                    {/* Open the day itself in the day view. */}
                    <div
                        className="event-context-menu-item"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(false);
                            onOpenDay(day);
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <span>Open this day</span>
                        </div>
                    </div>

                    {/* Clearing the override hands the day back to its automatic colour. */}
                    {hasOverride && (
                        <div
                            className="event-context-menu-item"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(false);
                                onResetColor();
                            }}
                            style={menuItemStyle}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10"></polyline>
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                                </svg>
                                <span>Reset colour</span>
                            </div>
                        </div>
                    )}
                </div>, document.body
            )}
        </div>
    );
};

/**
 * One month of the track, complete with its own day tiles and its own automatic colouring.
 *
 * It is kept apart — and memoised — because of what changes while the wheel turns: the only
 * thing that moves is the wrapper's offset, so a month that is merely gliding past must not
 * be recomputed. While the track is being pulled, every month that stays put simply returns
 * its last render untouched, and only the offsets are rewritten.
 */
const MonthPane = React.memo(({
    month,
    selectedDate,
    events,
    defaultDayColor,
    dayColors,
    autoColors,
    onChangeDayColor,
    onResetDayColor,
    onOpenDay,
    onDropItem,
    onHoverDow,
    onPulseDow,
    onSeedAutoColors,
    onTilePointerDown
}: {
    /** The month this pane shows. */
    month: Date;
    /** The day the calendar is sitting on, ringed on whichever pane happens to carry it. */
    selectedDate: Date;
    events: CalendarEvent[];
    defaultDayColor: string;
    dayColors: Record<string, string>;
    autoColors: Record<string, string>;
    onChangeDayColor: (dayKey: string, color: string) => void;
    onResetDayColor: (dayKey: string) => void;
    onOpenDay: (day: Date) => void;
    onDropItem?: (e: React.DragEvent, day: Date) => void;
    onHoverDow: (dow: number | null) => void;
    onPulseDow: (dow: number) => void;
    onSeedAutoColors?: (colors: Record<string, string>) => void;
    /** A tile was pressed: passed straight through, the pane keeps no part of the drag. */
    onTilePointerDown?: (e: React.PointerEvent, day: Date, el: HTMLElement) => void;
}) => {
    const monthStart = startOfMonth(month);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const daysInMonth = getDaysInMonth(monthStart);
    const leading = differenceInCalendarDays(monthStart, gridStart);
    // Whole weeks only: 4 at the very least (a 28-day February), 6 at the most.
    const weeks = Math.max(4, Math.min(6, Math.ceil((leading + daysInMonth) / 7)));
    const cells = Array.from({ length: weeks * 7 }).map((_, i) => addDays(gridStart, i));
    const today = new Date();

    const eventsForDay = (day: Date) => events.filter((e) => isSameDay(e.startTime, day));

    // A month's busy days are painted once, in date order, each colour opposite the one
    // before it. Those decisions are handed up to be stored and are then never revisited:
    // a day that gains an event later takes a plain random colour of its own and leaves
    // every colour already on screen exactly as it was. That split is the whole point —
    // the app places the run once, and from then on the calendar is the user's to recolour.
    //
    // Every month on the track is decided the moment it is mounted, including the ones
    // either side of the month being shown, so a month always slides in already wearing the
    // colours it settled on rather than changing under the pointer as it arrives.
    const eventDayColors: Record<string, string> = {};
    const autoSeed: Record<string, string> = {};
    {
        const inMonthEventDays = cells.filter(day => isSameMonth(day, month) && eventsForDay(day).length > 0);
        // Nothing on screen carries a settled colour yet: this is the month's first look,
        // so the app gets to place the whole run. Once even one day is settled, anything
        // still uncoloured is a later arrival and must not disturb the rest.
        const isFirstLook = inMonthEventDays.length > 0
            && inMonthEventDays.every(day => !dayColors[monthDayKey(day)] && !autoColors[monthDayKey(day)]);

        let previous: string | null = null;
        for (const day of inMonthEventDays) {
            const key = monthDayKey(day);
            const settled = dayColors[key] || autoColors[key];
            if (settled) {
                eventDayColors[key] = settled;
                previous = settled;
                continue;
            }
            const name: string = isFirstLook && previous
                ? oppositeDayColorName(previous, [defaultDayColor], key)
                : randomDayColorName(day, [defaultDayColor]);
            eventDayColors[key] = name;
            autoSeed[key] = name;
            previous = name;
        }
    }

    // Hand the freshly decided colours up to be stored. The signature is content-based
    // rather than the object itself, so this settles after a single pass instead of
    // firing again on every render.
    const autoSeedSignature = Object.keys(autoSeed).sort().map(k => `${k}=${autoSeed[k]}`).join('|');
    useEffect(() => {
        if (!autoSeedSignature) return;
        if (onSeedAutoColors) onSeedAutoColors(autoSeed);
    }, [autoSeedSignature]);

    const colorNameForDay = (day: Date): string => {
        const key = monthDayKey(day);
        return dayColors[key] || eventDayColors[key] || defaultDayColor;
    };

    // How many single-line event titles a day tile has room for.
    //
    // A tile is one fixed slice of the month, so how much of a day it can afford to say depends
    // entirely on how tall that slice is: a four-week month, or the same month in a taller
    // window, hands every tile more room than a six-week month squeezed onto a laptop. The
    // figure is measured from a real tile rather than assumed — the tile's own padding, its date
    // number and the list's own line height and row gap are all read back from the DOM — so it
    // stays true if any of those are ever restyled. Measured on the grid, which is the one element
    // whose size is the month's and not a tile's, and re-measured only when the month changes
    // shape or the window is resized.
    const [eventRowCapacity, setEventRowCapacity] = useState(MAX_TILE_EVENT_ROWS);
    const gridRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;

        const measure = () => {
            const rowGap = parseFloat(getComputedStyle(grid).rowGap) || 0;
            const tileHeight = (grid.clientHeight - rowGap * (weeks - 1)) / weeks;

            // Read the first tile that actually carries a list, so the list's own metrics are
            // measured rather than guessed at; fall back to any tile for the tile metrics alone.
            const tiles = Array.from(grid.querySelectorAll<HTMLElement>('.month-day-tile'));
            const tile = tiles.find((t) => t.querySelector('.month-day-events')) || tiles[0];
            if (!tile) return;

            const tileStyle = getComputedStyle(tile);
            const padding = (parseFloat(tileStyle.paddingTop) || 0) + (parseFloat(tileStyle.paddingBottom) || 0);
            const number = tile.querySelector<HTMLElement>('.month-day-number');
            const numberHeight = number ? number.getBoundingClientRect().height : 18;

            const list = tile.querySelector<HTMLElement>('.month-day-events');
            const title = list?.querySelector<HTMLElement>('.month-day-event-title');
            const lineHeight = title ? parseFloat(getComputedStyle(title).lineHeight) || 13 : 13;
            const listGap = list ? parseFloat(getComputedStyle(list).rowGap) || 0 : 1;

            // The date number and the list's own top margin are spent before any title is drawn,
            // and a couple of pixels are kept back so a tile never crams its last line to the edge.
            const available = tileHeight - padding - numberHeight - 2 - 4;
            const stride = lineHeight + listGap;
            const rows = Math.floor((available + listGap) / stride);

            setEventRowCapacity(Math.max(2, Math.min(MAX_TILE_EVENT_ROWS, rows)));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(grid);
        return () => observer.disconnect();
    }, [weeks]);

    return (
        <div ref={gridRef} className="month-grid" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
            {cells.map((day, i) => {
                const key = monthDayKey(day);
                return (
                    <MonthDayTile
                        key={i}
                        day={day}
                        inMonth={isSameMonth(day, month)}
                        isToday={isSameDay(day, today)}
                        isSelected={isSameDay(day, selectedDate)}
                        events={eventsForDay(day)}
                        maxRows={eventRowCapacity}
                        colorName={colorNameForDay(day)}
                        hasOverride={Boolean(dayColors[key])}
                        onChangeColor={(color) => onChangeDayColor(key, color)}
                        onResetColor={() => onResetDayColor(key)}
                        onOpenDay={onOpenDay}
                        onHoverDow={onHoverDow}
                        onPulseDow={onPulseDow}
                        onDropItem={onDropItem}
                        onTilePointerDown={onTilePointerDown}
                    />
                );
            })}
        </div>
    );
});
MonthPane.displayName = 'MonthPane';

export const MonthView = ({
    currentDate,
    events,
    defaultDayColor,
    dayColors,
    onChangeDayColor,
    onResetDayColor,
    onOpenDay,
    onDropItem,
    autoColors,
    onSeedAutoColors,
    onStepMonth,
    onCopyDayEvents,
    snapSignal,
    accentColor
}: {
    /** Any date inside the month to show. */
    currentDate: Date;
    events: CalendarEvent[];
    /** Palette name used for a day tile that carries no events. */
    defaultDayColor: string;
    /** Per-day colour overrides, keyed by [`monthDayKey()`](#monthDayKey). */
    dayColors: Record<string, string>;
    onChangeDayColor: (dayKey: string, color: string) => void;
    onResetDayColor: (dayKey: string) => void;
    /** Jump into the day view on the given day. */
    onOpenDay: (day: Date) => void;
    /** A to-do or note dropped on a day: the grid turns it into that day's entry. */
    onDropItem?: (e: React.DragEvent, day: Date) => void;
    /** Automatic colours this month has already settled on, keyed by [`monthDayKey()`](#monthDayKey). */
    autoColors: Record<string, string>;
    /** Stores freshly decided automatic colours, so they are never revisited. */
    onSeedAutoColors?: (colors: Record<string, string>) => void;
    /** Rolls the calendar by whole months — positive forward, negative back. */
    onStepMonth?: (months: number) => void;
    /**
     * Copies every event of one day onto another. Owned by the grid above, which holds the
     * events: the month only reports which day was dragged onto which, and the copy is made
     * once the confirmation has been answered.
     */
    onCopyDayEvents?: (from: Date, to: Date) => void;
    /**
     * A nudge from the header — the month's own name, or "Today" — asking the track to settle
     * back onto a whole month. The wheel is free to leave the calendar resting anywhere, which is
     * the whole point of the rolling track; this is its counterweight, the one gesture that gives
     * the leftover fraction of a month back and leaves the month being shown filling the screen
     * from its first row. Only the changes are read, so the value itself means nothing.
     */
    snapSignal?: number;
    /** The app's accent, handed on to the confirmation dialog (it renders in a portal). */
    accentColor?: string | null;
}) => {
    // The months riding the track: the one being shown, plus its neighbours either side.
    // Keyed off the month index rather than the date, so a day change inside the same month
    // does not hand every pane a new Date and cost it its memo.
    const monthIndex = currentDate.getFullYear() * 12 + currentDate.getMonth();
    const paneMonths = useMemo(
        () => PANE_OFFSETS.map(offset => addMonths(currentDate, offset)),
        [monthIndex]
    );

    // Which weekday column the pointer sits over, and which one was last clicked, so
    // the strip up top can mark it. Hovering any tile in a column lights that column's
    // name; a click flashes it for a moment before the view swaps to the day columns.
    const [hoverDow, setHoverDow] = useState<number | null>(null);
    const [pulseDow, setPulseDow] = useState<number | null>(null);
    const pulseTimer = useRef<number | null>(null);

    // A one-shot entrance for the month's day tiles. This shape is only mounted when the view
    // is actually switched to the month, so a mount-scoped flag lets every tile settle in
    // together exactly once — and never again while the calendar is merely scrolled or a month
    // is rolled past. The class is dropped once the brief motion has finished so nothing
    // lingers. Purely presentational — no event, timer or note data is touched.
    const [entering, setEntering] = useState(true);
    useEffect(() => {
        const id = window.setTimeout(() => setEntering(false), 620);
        return () => window.clearTimeout(id);
    }, []);

    // Stable, so the panes keep their memo while the track is being pulled.
    const handlePulseDow = useCallback((dow: number) => {
        setPulseDow(dow);
        if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
        pulseTimer.current = window.setTimeout(() => setPulseDow(null), 420);
    }, []);

    useEffect(() => () => {
        if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    }, []);

    // ---- The rolling track -------------------------------------------------------------
    // The months ride a vertical track, one pane each, and the wheel pulls the track rather
    // than stepping it. `travel` is how far past the month being shown the track has been
    // pulled, measured in panes — and it is free: whatever fraction of a month the wheel left
    // behind is exactly where the calendar stays, so resting with a little of two months on
    // screen is a real resting place, not a way-station on the way to a clean one. A month
    // pulled all the way past simply rolls on underneath, so the scroll never ends.
    //
    // Leftovers are never dropped, so a slow trackpad — a few pixels per event — still adds
    // up across a drift, and the calendar always travels exactly as far as the wheel was
    // turned, quickly when the wheel is turned quickly.
    //
    // The listener is attached by hand with `passive: false`: React's synthetic wheel events
    // cannot reliably stop the page from scrolling underneath the calendar, and the track
    // must own the gesture outright.
    const viewRef = useRef<HTMLDivElement | null>(null);
    const travelRef = useRef(0);
    const [travel, setTravel] = useState(0);
    const rebaseRef = useRef(0);

    const pullTo = (value: number) => {
        travelRef.current = value;
        setTravel(value);
    };

    useEffect(() => {
        const node = viewRef.current;
        if (!node || !onStepMonth) return;
        const onWheel = (event: WheelEvent) => {
            // Pinch-zoom (ctrl+wheel) belongs to Obsidian, not to the calendar.
            if (event.ctrlKey) return;
            const primary = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            if (!primary) return;
            event.preventDefault();
            event.stopPropagation();

            // The wheel pulls the track and lets it stay wherever it lands. There is no snap
            // and no landing: the fraction of a month the wheel left over is kept, so the
            // calendar comes to rest exactly where it was let go, whole month or half of one.
            const pulled = travelRef.current + primary / WHEEL_PX_PER_MONTH;
            const months = Math.round(pulled);
            if (months !== 0) {
                // A whole month has been pulled past. Hand it up, and note how far the track
                // will have to be rebased once it renders, so relabelling the panes moves
                // nothing on screen and the pull simply carries on from the same pixel.
                rebaseRef.current += months;
                onStepMonth(months);
            }
            pullTo(pulled);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
    }, [onStepMonth]);

    // The month rolling underneath the track, noticed however it was changed. The pane
    // offsets follow the calendar on their own, which is all the ‹ › arrows need: the month
    // is swapped and the track eases the step into view by itself, in whichever direction it
    // went.
    //
    // A change the wheel asked for is the one that needs care. The travel that pulled it into
    // view is already counted in `travel`, so the same amount has to come back out here, or
    // the track would glide a second time for one gesture. Doing it in a layout effect keeps
    // it in the same frame — the panes are relabelled and the offset corrected before
    // anything is painted — so not one pixel moves.
    const lastMonthIndex = useRef(monthIndex);
    useLayoutEffect(() => {
        if (lastMonthIndex.current === monthIndex) return;
        lastMonthIndex.current = monthIndex;
        const rebase = rebaseRef.current;
        rebaseRef.current = 0;
        pullTo(rebase !== 0 ? travelRef.current - rebase : 0);
    }, [monthIndex]);

    // The header's controls hand the track its whole month back. Nothing above would notice on
    // its own — this is the same month, only no longer halfway off the screen — so the nudge
    // itself is the entire signal. The panes keep their transform transition, so the track eases
    // onto the month rather than jumping, exactly as it eased away from it.
    useEffect(() => {
        if (snapSignal === undefined) return;
        pullTo(0);
    }, [snapSignal]);

    const currentDow = currentDate.getDay();

    // ---- Carrying a day's events to another day -----------------------------------------
    // Dragging one day tile onto another is the month's own copy gesture, the quiet cousin of
    // the day view's duplicate-a-tile drag: the whole day goes rather than one event, and
    // nothing happens without a yes.
    //
    // The gesture is watched on the window rather than on the tile — the pointer leaves the tile
    // the moment it moves, and it may well cross into a neighbouring month's pane — so the day
    // under the pointer is read back from the DOM and the drag carries on wherever the pointer
    // goes. It costs no renders: the chip is positioned straight onto its element and the two
    // tiles' states are written as classes, so dragging across a whole month re-renders nothing.
    const dragRef = useRef<{
        from: Date;
        fromKey: string;
        count: number;
        startX: number;
        startY: number;
        active: boolean;
        source: HTMLElement;
        target: HTMLElement | null;
    } | null>(null);
    const [copyDrag, setCopyDrag] = useState<{ from: Date; count: number } | null>(null);
    const [copyAsk, setCopyAsk] = useState<{ from: Date; to: Date; count: number } | null>(null);
    const ghostRef = useRef<HTMLDivElement | null>(null);
    const pointerRef = useRef({ x: 0, y: 0 });
    // A drag ends in a click as often as not, so the click that follows one is swallowed
    // instead of being allowed to open the day view underneath the drag.
    const swallowNextClickRef = useRef(false);

    // The values the window listeners need, kept in refs so those listeners can be attached
    // once and never re-bound in the middle of a drag.
    const eventsRef = useRef(events);
    const copyDayEventsRef = useRef(onCopyDayEvents);
    const openDayRef = useRef(onOpenDay);
    useEffect(() => {
        eventsRef.current = events;
        copyDayEventsRef.current = onCopyDayEvents;
        openDayRef.current = onOpenDay;
    });

    // Stable, so the panes keep their memo. A press only records where it went down: nothing is
    // decided until the pointer actually travels. A day with nothing on it starts no drag at
    // all, so the ordinary click-through to the day view is left untouched.
    const handleTilePointerDown = useCallback((e: React.PointerEvent, day: Date, el: HTMLElement) => {
        swallowNextClickRef.current = false;
        if (!copyDayEventsRef.current || e.button !== 0) return;
        const count = eventsRef.current.filter(ev => isSameDay(ev.startTime, day)).length;
        if (count === 0) return;
        dragRef.current = {
            from: day,
            fromKey: monthDayKey(day),
            count,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            source: el,
            target: null
        };
    }, []);

    // Stable too: the day view is opened only by a click that was not the tail of a copy.
    const handleOpenDay = useCallback((day: Date) => {
        if (swallowNextClickRef.current) {
            swallowNextClickRef.current = false;
            return;
        }
        openDayRef.current(day);
    }, []);

    useEffect(() => {
        const dayOf = (key?: string): Date | null => {
            if (!key) return null;
            const [y, m, d] = key.split('-').map(Number);
            if (!y || !m || !d) return null;
            return new Date(y, m - 1, d);
        };
        const tileUnder = (x: number, y: number): HTMLElement | null => {
            const el = document.elementFromPoint(x, y) as HTMLElement | null;
            return (el?.closest('.month-day-tile') || null) as HTMLElement | null;
        };
        const placeGhost = () => {
            const ghost = ghostRef.current;
            if (!ghost) return;
            ghost.style.transform = `translate(${pointerRef.current.x + 18}px, ${pointerRef.current.y + 18}px)`;
        };

        const onMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            pointerRef.current = { x: event.clientX, y: event.clientY };
            if (!drag.active) {
                if (Math.abs(event.clientX - drag.startX) < COPY_DRAG_THRESHOLD
                    && Math.abs(event.clientY - drag.startY) < COPY_DRAG_THRESHOLD) return;
                // The press is a drag now: mark the day it came from, put the chip in flight,
                // and note that whatever click ends this gesture has to be swallowed.
                drag.active = true;
                swallowNextClickRef.current = true;
                drag.source.classList.add('is-copy-source');
                viewRef.current?.classList.add('is-copy-dragging');
                setCopyDrag({ from: drag.from, count: drag.count });
            }
            placeGhost();

            // A day only offers itself if it is not the day the events came from: copying a day
            // onto itself is nothing, and a ring saying otherwise would be a lie.
            const tile = tileUnder(event.clientX, event.clientY);
            const next = tile && tile.dataset.day !== drag.fromKey ? tile : null;
            if (next !== drag.target) {
                drag.target?.classList.remove('is-copy-target');
                drag.target = next;
                if (next) next.classList.add('is-copy-target');
            }
        };

        const finish = (event: PointerEvent, ask: boolean) => {
            const drag = dragRef.current;
            if (!drag) return;
            dragRef.current = null;
            drag.source.classList.remove('is-copy-source');
            drag.target?.classList.remove('is-copy-target');
            viewRef.current?.classList.remove('is-copy-dragging');
            if (!drag.active) return;
            setCopyDrag(null);
            if (!ask) return;
            // The question is about two days, so a gesture that ended back on the day it started
            // from, or off the calendar altogether, simply comes to nothing.
            const day = dayOf(tileUnder(event.clientX, event.clientY)?.dataset.day);
            if (!day || monthDayKey(day) === drag.fromKey) return;
            setCopyAsk({ from: drag.from, to: day, count: drag.count });
        };

        const onUp = (event: PointerEvent) => finish(event, true);
        const onAbort = (event: PointerEvent) => finish(event, false);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onAbort);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onAbort);
        };
    }, []);

    return (
        <div className={`month-view${entering ? ' is-entering' : ''}`} ref={viewRef}>
            <div className="month-week-strip" onMouseLeave={() => setHoverDow(null)}>
                {WEEKDAY_LABELS.map((w, i) => {
                    const isLit = hoverDow === i || pulseDow === i;
                    const classes = [
                        'month-week-label',
                        isLit ? 'is-active' : '',
                        currentDow === i ? 'is-current' : ''
                    ].filter(Boolean).join(' ');
                    return <span key={i} className={classes}>{w}</span>;
                })}
            </div>
            <div className="month-track-clip">
                {paneMonths.map((month, i) => {
                    const offset = PANE_OFFSETS[i];
                    return (
                        <div
                            key={monthDayKey(month)}
                            className="month-pane"
                            style={{ transform: `translateY(${(offset - travel) * 100}%)` }}
                        >
                            <MonthPane
                                month={month}
                                selectedDate={currentDate}
                                events={events}
                                defaultDayColor={defaultDayColor}
                                dayColors={dayColors}
                                autoColors={autoColors}
                                onChangeDayColor={onChangeDayColor}
                                onResetDayColor={onResetDayColor}
                                onOpenDay={handleOpenDay}
                                onDropItem={onDropItem}
                                onHoverDow={setHoverDow}
                                onPulseDow={handlePulseDow}
                                onSeedAutoColors={onSeedAutoColors}
                                onTilePointerDown={handleTilePointerDown}
                            />
                        </div>
                    );
                })}
            </div>

            {/* The chip that travels with the pointer while a day is being carried, and the
                question asked when it is let go. Both live outside the calendar's own boxes —
                a portal each — so neither can be clipped by the track's overflow, and the
                confirmation lands as the app's own dialog rather than inside the grid. */}
            {copyDrag && createPortal(
                <div
                    className="month-copy-ghost"
                    aria-hidden="true"
                    ref={(node) => {
                        ghostRef.current = node;
                        if (node) {
                            node.style.transform = `translate(${pointerRef.current.x + 18}px, ${pointerRef.current.y + 18}px)`;
                        }
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="12" height="12" rx="2.5"></rect>
                        <path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"></path>
                    </svg>
                    <div className="month-copy-ghost-text">
                        <span className="month-copy-ghost-title">
                            {copyDrag.count === 1 ? '1 event' : `${copyDrag.count} events`}
                        </span>
                        <span className="month-copy-ghost-sub">{format(copyDrag.from, 'EEE, MMM d')}</span>
                    </div>
                </div>, document.body
            )}

            {copyAsk && createPortal(
                <MonthCopyConfirmDialog
                    from={copyAsk.from}
                    to={copyAsk.to}
                    count={copyAsk.count}
                    accentColor={accentColor}
                    onCancel={() => setCopyAsk(null)}
                    onConfirm={() => {
                        const ask = copyAsk;
                        setCopyAsk(null);
                        copyDayEventsRef.current?.(ask.from, ask.to);
                    }}
                />, document.body
            )}
        </div>
    );
};
