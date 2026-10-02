import React, { useEffect, useState } from 'react';
import { CustomRepeat } from '../../types';

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

export const CustomRepeatModal = ({ initial, accentColor, onCancel, onDone }: CustomRepeatModalProps) => {
    const [interval, setIntervalValue] = useState<number>(initial?.interval ?? 1);
    const [unit, setUnit] = useState<CustomRepeat['unit']>(initial?.unit ?? 'week');
    const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
    const [ends, setEnds] = useState<CustomRepeat['ends']>(initial?.ends ?? 'never');
    const [endDate, setEndDate] = useState<string>(initial?.endDate ?? toDateInputValue(new Date()));
    const [count, setCount] = useState<number>(initial?.count ?? 4);

    // Escape closes the dialog; stop key propagation so Obsidian hotkeys
    // don't fire while it is open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);

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
                    <input
                        type="date"
                        className="repeat-modal-date"
                        value={endDate}
                        onFocus={() => setEnds('on')}
                        onChange={(e) => { setEndDate(e.target.value); setEnds('on'); }}
                    />
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
