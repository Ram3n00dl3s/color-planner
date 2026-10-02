import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CustomRepeat } from '../../types';
import { SleekMiniCalendar } from './SleekMiniCalendar';

interface CustomRepeatModalProps {
    initial?: CustomRepeat | null;
    accentColor?: string | null;
    onCancel: () => void;
    onDone: (value: CustomRepeat) => void;
}

const UNIT_OPTIONS: { value: CustomRepeat['unit']; label: string }[] = [
    { value: 'day', label: 'day' },
    { value: 'week', label: 'week' },
    { value: 'month', label: 'month' },
    { value: 'year', label: 'year' }
];

// Monday-first display order; values are JS day numbers (0 = Sunday).
const WEEKDAY_ORDER = [
    { value: 1, label: 'Mo' },
    { value: 2, label: 'Tu' },
    { value: 3, label: 'We' },
    { value: 4, label: 'Th' },
    { value: 5, label: 'Fr' },
    { value: 6, label: 'Sa' },
    { value: 0, label: 'Su' }
];

const toDateInputValue = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/* The end date travels as a `YYYY-MM-DD` string, but the month panel wants a Date.
   Parsed field by field rather than with `new Date(value)`, which reads a bare date
   as UTC midnight and can therefore land on the day before, west of Greenwich. */
const fromDateInputValue = (value: string): Date => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
};

export const CustomRepeatModal = ({ initial, accentColor, onCancel, onDone }: CustomRepeatModalProps) => {
    const [interval, setIntervalValue] = useState<number>(initial?.interval ?? 1);
    const [unit, setUnit] = useState<CustomRepeat['unit']>(initial?.unit ?? 'week');
    const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
    const [ends, setEnds] = useState<CustomRepeat['ends']>(initial?.ends ?? 'never');
    const [endDate, setEndDate] = useState<string>(initial?.endDate ?? toDateInputValue(new Date()));
    const [count, setCount] = useState<number>(initial?.count ?? 4);

    // The end date is chosen from our own month panel rather than the browser's date
    // input, so the dialog has to hold whether that panel is open and which month it
    // is showing. It opens on the month of the date currently chosen.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerMonth, setPickerMonth] = useState<Date>(() => fromDateInputValue(initial?.endDate ?? toDateInputValue(new Date())));
    const dateWrapRef = useRef<HTMLDivElement | null>(null);
    const datePopoverRef = useRef<HTMLDivElement | null>(null);

    // Escape backs out one step at a time: the month panel first, then the dialog.
    // Key propagation is stopped so Obsidian hotkeys don't fire while it is open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (pickerOpen) {
                    setPickerOpen(false);
                    e.stopPropagation();
                    return;
                }
                onCancel();
            }
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel, pickerOpen]);

    // A click anywhere outside the date box closes the month panel. Capture phase, so
    // an inner handler stopping propagation cannot hold it open.
    useEffect(() => {
        if (!pickerOpen) return;
        const handlePointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.repeat-modal-date-wrap')) setPickerOpen(false);
        };
        window.addEventListener('pointerdown', handlePointerDown, true);
        return () => window.removeEventListener('pointerdown', handlePointerDown, true);
    }, [pickerOpen]);

    // The panel is as tall as the duplicate calendar's, and the date box sits in the
    // middle of the dialog: it hangs below the box by default and flips above it on
    // the rare short window where there is more room that way. Measured after layout,
    // so the panel can never paint in one place and then jump to another.
    useLayoutEffect(() => {
        if (!pickerOpen) return;
        const wrap = dateWrapRef.current;
        const panel = datePopoverRef.current;
        if (!wrap || !panel) return;
        const wrapRect = wrap.getBoundingClientRect();
        const panelH = panel.offsetHeight || 330;
        const spaceBelow = window.innerHeight - wrapRect.bottom - 12;
        const spaceAbove = wrapRect.top - 12;
        const openUp = spaceBelow < panelH && spaceAbove > spaceBelow;
        panel.style.top = openUp ? 'auto' : 'calc(100% + 6px)';
        panel.style.bottom = openUp ? 'calc(100% + 6px)' : 'auto';
    }, [pickerOpen]);

    const toggleWeekday = (value: number) => {
        setWeekdays(prev => prev.includes(value)
            ? prev.filter(d => d !== value)
            : [...prev, value].sort((a, b) => a - b));
    };

    const handleDone = () => {
        onDone({
            interval: Math.max(1, Math.min(99, Math.floor(interval) || 1)),
            unit,
            weekdays: unit === 'week' ? weekdays : [],
            ends,
            endDate: ends === 'on' ? endDate : undefined,
            count: ends === 'after' ? Math.max(1, Math.min(999, Math.floor(count) || 1)) : undefined
        });
    };

    return (
        <div
            className="repeat-modal-overlay"
            style={accentColor ? ({ ['--sleek-accent' as any]: accentColor } as React.CSSProperties) : undefined}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="repeat-modal" role="dialog" aria-modal="true" aria-label="Repeat">
                <div className="repeat-modal-title">Repeat</div>

                <div className="repeat-modal-row">
                    <span className="repeat-modal-label">Every</span>
                    <input
                        type="number"
                        min={1}
                        max={99}
                        value={interval}
                        onChange={(e) => setIntervalValue(Number(e.target.value))}
                        className="repeat-modal-number"
                    />
                    <select
                        className="repeat-modal-select"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as CustomRepeat['unit'])}
                    >
                        {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                </div>

                {unit === 'week' && (
                    <div className="repeat-modal-row">
                        <span className="repeat-modal-label">On</span>
                        <div className="repeat-weekday-list">
                            {WEEKDAY_ORDER.map(d => {
                                const active = weekdays.includes(d.value);
                                return (
                                    <button
                                        key={d.value}
                                        type="button"
                                        className={`repeat-weekday ${active ? 'is-active' : ''}`}
                                        onClick={() => toggleWeekday(d.value)}
                                    >
                                        {d.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="repeat-modal-section-label">Ends</div>

                <div className="repeat-end-row">
                    <button
                        type="button"
                        className={`repeat-radio ${ends === 'never' ? 'is-selected' : ''}`}
                        onClick={() => setEnds('never')}
                    >
                        <span className="repeat-radio-dot" />
                        <span>Never</span>
                    </button>
                </div>

                <div className="repeat-end-row">
                    <button
                        type="button"
                        className={`repeat-radio ${ends === 'on' ? 'is-selected' : ''}`}
                        onClick={() => setEnds('on')}
                    >
                        <span className="repeat-radio-dot" />
                        <span>On</span>
                    </button>
                    {/* The date box opens a month panel of our own — the very same one
                        the duplicate calendar shows — instead of the browser's date
                        picker. The whole box is the control, so a click anywhere in it
                        opens the panel. */}
                    <div className="repeat-modal-date-wrap" ref={dateWrapRef}>
                        <button
                            type="button"
                            className="repeat-modal-date repeat-date-btn"
                            aria-expanded={pickerOpen}
                            onClick={() => {
                                setEnds('on');
                                setPickerMonth(fromDateInputValue(endDate));
                                setPickerOpen(prev => !prev);
                            }}
                        >
                            <span>{format(fromDateInputValue(endDate), 'MMM d, yyyy')}</span>
                            <svg className="repeat-date-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        {pickerOpen && (
                            <div className="repeat-date-popover" ref={datePopoverRef}>
                                <SleekMiniCalendar
                                    month={pickerMonth}
                                    onMonthChange={setPickerMonth}
                                    selected={fromDateInputValue(endDate)}
                                    onSelect={(day) => {
                                        setEndDate(toDateInputValue(day));
                                        setEnds('on');
                                        setPickerOpen(false);
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="repeat-end-row">
                    <button
                        type="button"
                        className={`repeat-radio ${ends === 'after' ? 'is-selected' : ''}`}
                        onClick={() => setEnds('after')}
                    >
                        <span className="repeat-radio-dot" />
                        <span>After</span>
                    </button>
                    <input
                        type="number"
                        min={1}
                        max={999}
                        className="repeat-modal-number"
                        value={count}
                        onFocus={() => setEnds('after')}
                        onChange={(e) => { setCount(Number(e.target.value)); setEnds('after'); }}
                    />
                    <span className="repeat-modal-suffix">times</span>
                </div>

                <div className="repeat-modal-footer">
                    <button type="button" className="repeat-modal-btn" onClick={onCancel}>Cancel</button>
                    <button type="button" className="repeat-modal-btn is-primary" onClick={handleDone}>Done</button>
                </div>
            </div>
        </div>
    );
};
