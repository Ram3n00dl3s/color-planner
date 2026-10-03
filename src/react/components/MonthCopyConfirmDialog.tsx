import React, { useEffect } from 'react';
import { format } from 'date-fns';

/**
 * The question the month asks before one day's events are copied onto another day.
 *
 * Letting go of a dragged day tile raises this, so a slip of the mouse can never quietly
 * duplicate a day's worth of events — the copy waits for a yes. It is deliberately the same
 * window the custom-repeat form uses: the shared overlay, card, title, footer and buttons, so
 * the month asks its question in the app's own voice rather than opening a new kind of dialog.
 * Neutral throughout — no coloured borders, and the primary button takes the accent the app is
 * already wearing, falling back to plain text colour when accents are switched off.
 */
export const MonthCopyConfirmDialog = ({
    from,
    to,
    count,
    accentColor,
    onCancel,
    onConfirm
}: {
    /** The day being copied from. */
    from: Date;
    /** The day the events are going to. */
    to: Date;
    /** How many events the source day holds. */
    count: number;
    /** The app's accent, if accents are on. The dialog renders in a portal, so it cannot
        inherit `--sleek-accent` and has to be handed it. */
    accentColor?: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}) => {
    // Escape backs out, and every key is stopped here so Obsidian's own hotkeys cannot fire
    // underneath the question while it is open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);

    return (
        <div
            className="month-copy-overlay"
            style={accentColor ? ({ ['--sleek-accent' as any]: accentColor } as React.CSSProperties) : undefined}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="month-copy-dialog" role="dialog" aria-modal="true" aria-label="Copy events">
                <div className="month-copy-title">
                    {count === 1 ? 'Copy this event?' : `Copy these ${count} events?`}
                </div>

                {/* The two days, said plainly and side by side, joined by a quiet arrow. */}
                <div className="month-copy-body">
                    <span className="month-copy-day">{format(from, 'EEE, MMM d')}</span>
                    <svg
                        className="month-copy-arrow"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <line x1="4" y1="12" x2="19" y2="12"></line>
                        <polyline points="13 6 19 12 13 18"></polyline>
                    </svg>
                    <span className="month-copy-day">{format(to, 'EEE, MMM d')}</span>
                </div>

                <p className="month-copy-note">
                    The day's events will be added to the new day. The day they came from keeps them.
                </p>

                <div className="month-copy-footer">
                    <button type="button" className="month-copy-btn" onClick={onCancel}>Cancel</button>
                    <button type="button" className="month-copy-btn is-primary" onClick={onConfirm}>Copy</button>
                </div>
            </div>
        </div>
    );
};
