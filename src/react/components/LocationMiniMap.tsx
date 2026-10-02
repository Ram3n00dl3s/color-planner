import React from 'react';

/**
 * Small "map pin" icon shown on an event tile when the event has a location.
 *
 * Modelled on the familiar multi-colour folded-pin marker: the balloon is split
 * into four quadrants (blue / red / yellow / green) by two diagonals through its
 * centre, with the centre punched out so the tile colour shows through. It is a
 * flat decorative graphic — not a photo and not a framed box — so it never
 * introduces a purple accent or a coloured border. It never intercepts pointer
 * events.
 */
export const LocationMiniMap = ({
    size = 24
}: {
    size?: number;
}) => {
    // Unique ids per instance so several tiles never share/clobber a clip/mask.
    const rawId = React.useId();
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    const clipId = `sleek-pin-clip-${safeId}`;
    const maskId = `sleek-pin-mask-${safeId}`;

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
            <defs>
                <clipPath id={clipId}>
                    {/* Balloon with the classic tapered tail */}
                    <path d="M12 2 C7.6 2 4 5.6 4 10 C4 15.5 12 22 12 22 C12 22 20 15.5 20 10 C20 5.6 16.4 2 12 2 Z" />
                </clipPath>
                {/* Punch the centre out so the underlying tile colour shows through. */}
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect x="0" y="0" width="24" height="24" fill="#ffffff" />
                    <circle cx="12" cy="10" r="3.3" fill="#000000" />
                </mask>
            </defs>
            <g clipPath={`url(#${clipId})`} mask={`url(#${maskId})`}>
                {/* Top quadrant — blue */}
                <polygon points="12,10 -30.4,-32.4 54.4,-32.4" fill="#4285F4" />
                {/* Right quadrant — green */}
                <polygon points="12,10 54.4,-32.4 54.4,52.4" fill="#34A853" />
                {/* Bottom quadrant — yellow */}
                <polygon points="12,10 54.4,52.4 -30.4,52.4" fill="#FBBC04" />
                {/* Left quadrant — red */}
                <polygon points="12,10 -30.4,52.4 -30.4,-32.4" fill="#EA4335" />
            </g>
        </svg>
    );
};
