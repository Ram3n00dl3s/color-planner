import React from 'react';

/**
 * Small "note + pencil" icon shown on an event tile when the event has one or
 * more linked notes (a note linked from the event details, or a note created
 * there). Drawn to echo the reference image: a page with ruled lines and a
 * solid pencil resting across its bottom-right corner.
 *
 * It is monochrome — every shape paints with `currentColor`, so the wrapping
 * element decides the neutral ink colour. It never introduces a coloured /
 * purple accent and never a framed box. It never intercepts pointer events.
 */
export const NoteIcon = ({
    size = 24
}: {
    size?: number;
}) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            style={{
                display: 'block',
                pointerEvents: 'none',
                flexShrink: 0
            }}
        >
            {/* Page */}
            <rect
                x="2.6"
                y="3"
                width="14.8"
                height="18"
                rx="2.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            />
            {/* Ruled lines */}
            <line x1="5.8" y1="8" x2="14.2" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5.8" y1="11.5" x2="14.2" y2="11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5.8" y1="15" x2="10.4" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5.8" y1="18.5" x2="14.2" y2="18.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            {/* Pencil resting across the bottom-right corner (pointing down-left) */}
            <g transform="translate(13.6 18.4) rotate(-45)">
                {/* Shaft */}
                <rect x="0" y="-1.25" width="9.2" height="2.5" rx="0.6" fill="currentColor" />
                {/* Lead tip */}
                <polygon points="0,-1.25 -3,0 0,1.25" fill="currentColor" />
            </g>
        </svg>
    );
};
