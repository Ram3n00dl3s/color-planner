/**
 * Shared palette + accent utilities.
 *
 * The hex values mirror the `.event-<name>` background colors defined in
 * styles.css, so any swatch rendered from this map matches the app's existing
 * palette exactly.
 */
export const EVENT_COLOR_HEX: Record<string, string> = {
    blue: '#99ccff',
    green: '#87e5aa',
    purple: '#b7a8f5',
    orange: '#ffc175',
    red: '#ff99a2',
    pink: '#ff9bd2',
    indigo: '#9eaeff',
    cyan: '#7ee8e8',
    teal: '#77ebd0',
    lime: '#d4eb7a',
    yellow: '#ffef6b',
    amber: '#ffd766',
    brown: '#cca791',
    grey: '#d6d6d6',
    bluegrey: '#a6b3bd',
    'pastel-red': '#ffaaa8',
    'pastel-orange': '#ffc8a8',
    'pastel-yellow': '#ffeca8',
    'pastel-green': '#a8ffb9',
    'pastel-blue': '#a8d2ff',
    'pastel-purple': '#cca8ff',
    'pastel-pink': '#ffa8e2',
    mint: '#99f2b8',
    coral: '#ff9c9c',
    lavender: '#d1c4f7',
    sky: '#9fd4ff',
    ice: '#bfe9ff',
    azure: '#9fc4ff',
    aqua: '#a3f0e6',
    turquoise: '#8fe6d8',
    seafoam: '#b0f0d0',
    emerald: '#a3e8bf',
    sage: '#c4e2b0',
    olive: '#d8e29a',
    gold: '#ffe49a',
    banana: '#fff2a8',
    apricot: '#ffd0a6',
    peach: '#ffd9b3',
    salmon: '#ffb3a7',
    rose: '#ffb8c6',
    blush: '#ffc2cc',
    magenta: '#f7a8d8',
    orchid: '#e6b0f2',
    violet: '#c3b0f5',
    periwinkle: '#b3c0f7',
    // Muted mid tones added for the timer palette. These are the tans, browns
    // and greys that sit a shade or two deeper than the bright pastels, so a
    // tile's text can still be read against them.
    tan: '#d6b483',
    sand: '#dfc9a0',
    khaki: '#c9bd8b',
    mocha: '#b98d6c',
    cocoa: '#a97c5c',
    rust: '#bd7d5f',
    clay: '#c69480',
    taupe: '#b2a596',
    stone: '#b5b2ac',
    ash: '#a9a79f',
    slate: '#97a2ab',
    moss: '#a5ad7d',
    plum: '#ab8fa6'
};

/**
 * Ordered list of selectable accent swatches. These are the exact same color
 * names used across the app (event tiles, timers, etc.).
 */
export const ACCENT_SWATCHES: string[] = [
    'blue', 'cyan', 'teal', 'green', 'lime',
    'yellow', 'amber', 'orange', 'coral', 'red',
    'pink', 'purple', 'lavender', 'indigo', 'pastel-purple',
    'pastel-blue', 'pastel-green', 'mint', 'pastel-yellow', 'pastel-orange',
    'pastel-red', 'pastel-pink', 'brown', 'bluegrey', 'grey',
    'sky', 'ice', 'azure', 'aqua', 'turquoise',
    'seafoam', 'emerald', 'sage', 'olive', 'gold',
    'banana', 'apricot', 'peach', 'salmon', 'rose',
    'blush', 'magenta', 'orchid', 'violet', 'periwinkle'
];

/** The muted mid tones, appended to the palette in the order they are shown. */
const MUTED_SWATCHES: string[] = [
    'tan', 'sand', 'khaki', 'mocha', 'cocoa', 'rust',
    'clay', 'taupe', 'stone', 'ash', 'slate', 'moss', 'plum'
];

/** Every named swatch, in palette order: the shared set, then the muted tones. */
export const PALETTE_ORDER: string[] = [...ACCENT_SWATCHES, ...MUTED_SWATCHES];

/** Channel triple for a #rgb / #rrggbb string, or null when it cannot be read. */
const rgbOf = (hex?: string | null): [number, number, number] | null => {
    const clean = (hex || '').replace('#', '');
    const parts = clean.length === 3
        ? [clean[0] + clean[0], clean[1] + clean[1], clean[2] + clean[2]]
        : clean.length === 6
            ? [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)]
            : [];
    if (parts.length !== 3) return null;
    const rgb = parts.map(part => parseInt(part, 16));
    return rgb.some(channel => Number.isNaN(channel)) ? null : rgb as [number, number, number];
};

/**
 * WCAG relative luminance of a colour: 0 for black, 1 for white. Used to sort
 * the palette by how much light a swatch actually reflects, rather than by what
 * its name suggests.
 */
export const relativeLuminance = (hex?: string | null): number => {
    const rgb = rgbOf(hex);
    if (!rgb) return 1;
    const [r, g, b] = rgb.map(channel => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Luminance a timer tile's swatch is not allowed to exceed.
 *
 * Tile text is dark, so a swatch has to be deep enough to hold it: bright
 * yellow, banana, lime and the palest pastels are all above this line (their
 * dark labels wash out completely), while the blues, reds, pinks, purples and
 * the new muted tans, browns and greys sit below it. The cut is measured rather
 * than hand-picked, so the list stays honest if the palette ever changes.
 */
export const TIMER_COLOR_LUMINANCE_CEILING = 0.62;

/**
 * The swatches a timer tile may wear: the darker share of the palette, in
 * palette order. Anything brighter is left out of the picker entirely, so a
 * timer can only ever be given a colour its own text can be read on.
 */
export const TIMER_COLOR_NAMES: string[] = PALETTE_ORDER.filter(name => {
    const hex = EVENT_COLOR_HEX[name];
    return Boolean(hex) && relativeLuminance(hex) <= TIMER_COLOR_LUMINANCE_CEILING;
});

/** The handful of swatches offered straight away, before the full palette. */
export const TIMER_QUICK_COLORS: string[] = ['blue', 'indigo', 'purple', 'pink', 'red', 'mocha'];

/** Default colour for a newly created timer tile. */
export const DEFAULT_TIMER_COLOR = TIMER_QUICK_COLORS[0];

/** Fallback accent used when a name cannot be resolved. */
export const DEFAULT_ACCENT_HEX = '#3b82f6';

export const resolveAccentHex = (name?: string | null): string | null => {
    if (!name) return null;
    const hex = EVENT_COLOR_HEX[name];
    return hex || (name.startsWith('#') ? name : null);
};

/**
 * Opacity of the faint accent wash used behind a mini-calendar day chip. Kept
 * deliberately low: the chip should only hint that it carries the accent colour,
 * never read as a solid block of it. Shared by the components (via `hexToRgba`)
 * and by the `--sleek-accent-soft` CSS variable.
 */
export const ACCENT_CHIP_TINT_ALPHA = 0.14;

/**
 * How far a chosen accent is softened before the app uses it.
 *
 * The pickable swatches are bright, high-chroma pastels. At full strength a
 * chosen accent overpowers the neutral UI it is dropped into — it reads bright
 * and intense whether it lands as a solid fill, as text or as a tint wash. The
 * accent keeps the hue the user picked but loses chroma, and a little light, so
 * every surface that wears it reads calmer.
 */
const ACCENT_SATURATION_SCALE = 0.68;
const ACCENT_LIGHTNESS_SCALE = 0.9;

/**
 * A softened variant of an accent colour, returned in the same #rrggbb form.
 *
 * Called once, where the accent is resolved, so the CSS variables, the tint wash
 * and every component handed the hex are all toned down by exactly the same
 * amount instead of each surface fiddling with the colour on its own. Input that
 * is not a readable #rgb / #rrggbb string is handed straight back untouched.
 */
export const toneDownAccent = (hex?: string | null): string | null => {
    const rgb = rgbOf(hex);
    if (!rgb) return hex ?? null;
    const [r, g, b] = rgb.map(channel => channel / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    let hue = 0;
    if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = (hue * 60 + 360) % 360;
    }

    const s = saturation * ACCENT_SATURATION_SCALE;
    const l = lightness * ACCENT_LIGHTNESS_SCALE;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let channels: [number, number, number];
    if (hue < 60) channels = [c, x, 0];
    else if (hue < 120) channels = [x, c, 0];
    else if (hue < 180) channels = [0, c, x];
    else if (hue < 240) channels = [0, x, c];
    else if (hue < 300) channels = [x, 0, c];
    else channels = [c, 0, x];
    const toChannel = (value: number) =>
        Math.round(Math.min(1, Math.max(0, value + m)) * 255).toString(16).padStart(2, '0');
    return `#${channels.map(toChannel).join('')}`;
};

/** Convert a #rgb / #rrggbb hex color string into an rgba() string. */
export const hexToRgba = (hex: string, alpha: number): string => {
    const clean = (hex || '').replace('#', '');
    let r = 0, g = 0, b = 0;
    if (clean.length === 3) {
        r = parseInt(clean[0] + clean[0], 16);
        g = parseInt(clean[1] + clean[1], 16);
        b = parseInt(clean[2] + clean[2], 16);
    } else if (clean.length === 6) {
        r = parseInt(clean.slice(0, 2), 16);
        g = parseInt(clean.slice(2, 4), 16);
        b = parseInt(clean.slice(4, 6), 16);
    }
    if ([r, g, b].some(n => Number.isNaN(n))) return hex;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Palette names used for the tiny "has event" dots on the mini-calendars. */
const EVENT_DOT_COLOR_NAMES: string[] = Object.keys(EVENT_COLOR_HEX);

/**
 * Stable pseudo-random palette color for a given calendar day.
 *
 * The pick is deterministic per calendar date (so the dot never flickers or
 * changes between re-renders / month navigation) yet spreads across the whole
 * palette, giving each day's dot a "random" color.
 */
export const randomEventDotColor = (date: Date): string => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    const name = EVENT_DOT_COLOR_NAMES[Math.abs(hash) % EVENT_DOT_COLOR_NAMES.length];
    return EVENT_COLOR_HEX[name] || DEFAULT_ACCENT_HEX;
};

/**
 * Stable pseudo-random palette NAME for a calendar day, in palette order.
 *
 * Used to paint a month-view day tile that carries one or more events: the
 * colour is deterministic per date (so a day's tile never flickers between
 * renders or while navigating months) yet spreads across the palette so
 * neighbouring busy days rarely collide.
 *
 * `exclude` holds palette names to steer away from — normally the user's
 * default no-event tile colour — so a day with events always reads as a
 * different colour from a quiet one. If the exclusion would empty the pool the
 * full palette is used as a fallback.
 */
export const randomDayColorName = (date: Date, exclude: string[] = []): string => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    const pool = PALETTE_ORDER.filter(name => !exclude.includes(name));
    const names = pool.length > 0 ? pool : PALETTE_ORDER;
    return names[Math.abs(hash) % names.length];
};

/** Hue of a hex colour in degrees (0–360), or null when it has no usable hue. */
const hueOf = (hex?: string | null): number | null => {
    const rgb = rgbOf(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(channel => channel / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta < 1e-6) return null;
    const lightness = (max + min) / 2;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    // A washed-out grey has no opposite to speak of, so it is reported as hueless.
    if (saturation < 0.08) return null;
    let hue: number;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    return (hue + 360) % 360;
};

/** Shortest distance between two hues, in degrees (0–180). */
const hueDistance = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
};

/** How far off the true opposite a swatch may sit and still count as "opposite". */
const OPPOSITE_HUE_BAND = 55;

/** Small stable string hash, used only to break ties between equally good picks. */
const hashOf = (value: string): number => {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
};

/**
 * The swatch that sits opposite `previous` on the colour wheel.
 *
 * Month-view day tiles that carry events are coloured in date order, and each one
 * is asked to oppose the colour before it: the previous swatch's hue is rotated
 * 180° and the nearest palette entry wins, so two busy days in a row read as a
 * deliberate pair rather than two near-identical pastels. Hueless swatches (the
 * greys) are never chosen, and the previous colour is always excluded so a tile
 * never simply echoes its neighbour.
 *
 * `exclude` steers away from names the caller must avoid — normally the user's
 * default no-event colour. `seed` breaks the ties between equally opposite
 * swatches, so the pairs vary from month to month instead of locking onto one
 * fixed couple.
 */
export const oppositeDayColorName = (
    previous: string,
    exclude: string[] = [],
    seed = ''
): string => {
    const previousHue = hueOf(EVENT_COLOR_HEX[previous]);
    const pool = PALETTE_ORDER.filter(name => name !== previous && !exclude.includes(name));
    const fallbackPool = pool.length > 0 ? pool : PALETTE_ORDER;

    // A grey (or a colour we cannot read) has no direction to oppose: step to some
    // other swatch rather than inventing one.
    if (previousHue === null) return fallbackPool[hashOf(seed) % fallbackPool.length];

    const target = (previousHue + 180) % 360;
    const candidates = pool
        .map(name => ({ name, hue: hueOf(EVENT_COLOR_HEX[name]) }))
        .filter((c): c is { name: string; hue: number } => c.hue !== null);
    if (candidates.length === 0) return fallbackPool[hashOf(seed) % fallbackPool.length];

    const inBand = candidates.filter(c => hueDistance(c.hue, target) <= OPPOSITE_HUE_BAND);
    const from = inBand.length > 0 ? inBand : candidates;
    const ranked = [...from].sort(
        (a, b) => hueDistance(a.hue, target) - hueDistance(b.hue, target)
    );
    // Anything within a few degrees of the best match is equally "opposite"; the seed
    // chooses between them so consecutive months are not carbon copies of each other.
    const best = hueDistance(ranked[0].hue, target);
    const tied = ranked.filter(c => hueDistance(c.hue, target) <= best + 6);
    return tied[hashOf(seed) % tied.length].name;
};

/**
 * Accent hex for the Nth row of a list.
 *
 * Walks the ordered swatch palette so that two adjacent rows always receive a
 * different accent color (the palette is ordered so neighbouring entries never
 * collide). Used to tint completed to-do checkboxes + their strikethrough line.
 */
export const accentColorForIndex = (index: number): string => {
    const safeIndex = Math.abs(Math.trunc(index)) % ACCENT_SWATCHES.length;
    return EVENT_COLOR_HEX[ACCENT_SWATCHES[safeIndex]] || DEFAULT_ACCENT_HEX;
};

/**
 * Stable accent hex for a specific list item, derived from its id.
 *
 * Unlike `accentColorForIndex`, this is independent of the row's position, so
 * an item keeps the exact same accent when the list re-sorts (e.g. a completed
 * to-do dropping to the bottom). The hash spreads ids across the ordered
 * palette.
 */
export const accentColorForId = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    const name = ACCENT_SWATCHES[Math.abs(hash) % ACCENT_SWATCHES.length];
    return EVENT_COLOR_HEX[name] || DEFAULT_ACCENT_HEX;
};
