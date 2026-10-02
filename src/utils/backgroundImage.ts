import { App, TFile } from 'obsidian';

/**
 * Fit modes offered in settings for the optional calendar background picture.
 * `tile` is ideal for seamless patterns (like the doodle pack), `cover` fills
 * the view, and `contain` letterboxes the whole image inside.
 */
export const BACKGROUND_FIT_OPTIONS: { value: string; label: string }[] = [
    { value: 'cover', label: 'Cover (fill the calendar)' },
    { value: 'tile', label: 'Tile (repeat pattern)' },
    { value: 'contain', label: 'Contain (fit whole image)' }
];

export const DEFAULT_BACKGROUND_FIT = 'cover';
export const DEFAULT_BACKGROUND_DIM = 45;

/**
 * Normalise the raw value a user typed/pasted into a background setting.
 * Accepts a plain vault path, an OS path, a full URL, or an Obsidian wiki
 * embed/link (e.g. `![[Attachments/doodles.png]]`) and returns the bare target.
 */
export function normalizeBackgroundInput(raw: string): string {
    let value = (raw || '').trim();
    if (!value) return '';

    // Strip Obsidian wiki-link/embed wrappers: ![[x.png]] or [[x.png|alias]].
    const wiki = value.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
    if (wiki) {
        value = wiki[1].trim();
    }

    return value;
}

/**
 * Turn a user-supplied background value into something usable inside a CSS
 * `url(...)`. Returns an empty string when nothing valid can be resolved so the
 * caller can fall back to the default solid theme background.
 */
export function resolveBackgroundUrl(app: App | undefined, raw: string): string {
    const value = normalizeBackgroundInput(raw);
    if (!value) return '';

    // Already a URL / data URI / Obsidian app:// resource.
    if (/^(https?:|data:|app:|file:|blob:)/i.test(value)) {
        return value;
    }

    if (!app?.vault) return '';

    // 1) Try as a vault-relative path (the common case: Attachments/doodles.png).
    for (const candidate of [value, value.replace(/^\/+/, '')]) {
        const file = app.vault.getAbstractFileByPath(candidate);
        if (file instanceof TFile) {
            try {
                return app.vault.getResourcePath(file);
            } catch {
                /* fall through to the absolute-path attempt */
            }
        }
    }

    // 2) Try as an absolute path on disk (desktop only).
    const adapter: any = app.vault.adapter;
    if (adapter?.getResourcePath) {
        try {
            return adapter.getResourcePath(value);
        } catch {
            /* fall through */
        }
    }

    return '';
}

/**
 * Build the CSS background list used by the live preview in settings, mirroring
 * the calendar itself: the picture is anchored bottom-left and read as a soft
 * corner wash. A SQUARE vignette (not a circle) melts the picture into the
 * calendar from all FOUR edges — because the four edge ramps overlap at the
 * corners, the corners fade harder than the mid-edges and the shape reads as a
 * slightly "rounded cube" rather than an oval. The TOP edge is deliberately cut
 * deeper than the other three sides (46% vs 24%), and on top of that a strong
 * darker ramp holds across the upper half (releasing past 34%, gone by 62%) so
 * the top always reads heavier and darker than the bottom. The "Background dim"
 * setting lays a neutral tint over whatever survives the vignette.
 */
export function buildBackgroundLayers(raw: string, app: App | undefined, fit: string, dimPercent: number): {
    url: string;
    backgroundImage: string;
    backgroundSize: string;
    backgroundRepeat: string;
    backgroundPosition: string;
} | null {
    const url = resolveBackgroundUrl(app, raw);
    if (!url) return null;

    const dim = Math.min(100, Math.max(0, dimPercent)) / 100;
    const size = fit === 'tile' ? 'auto' : fit === 'contain' ? 'contain' : 'cover';
    const repeat = fit === 'tile' ? 'repeat' : 'no-repeat';

    // Mirror the calendar (see .week-grid-container::after in styles.css). The
    // picture reads as a square vignette: the left/right/bottom edges fade from
    // the app background to transparent across the first 24%, while the TOP edge
    // is cut DEEPER (a 6% hold, then out to 46%) so the picture always feels
    // heavier along the top. The ramps overlap at the corners (darker corners
    // than mid-edges — a "rounded cube" feel). On top of that a strong dark ramp
    // holds across the upper half (releasing past 34%, gone by 62%) so it reads
    // clearly darker than the lower half; the dim setting lays a flat tint over
    // the visible centre.
    const leftVignette = 'linear-gradient(to right, var(--background-primary) 0%, transparent 24%)';
    const rightVignette = 'linear-gradient(to left, var(--background-primary) 0%, transparent 24%)';
    // The TOP edge is intentionally deeper than the other three sides.
    const topEdgeVignette = 'linear-gradient(to bottom, var(--background-primary) 0%, var(--background-primary) 6%, transparent 46%)';
    const bottomEdgeVignette = 'linear-gradient(to top, var(--background-primary) 0%, transparent 24%)';
    const topShadeDark = Math.min(dim * 2, 1).toFixed(3);
    const topShade = `linear-gradient(to bottom, rgba(0, 0, 0, ${topShadeDark}) 0%, rgba(0, 0, 0, ${topShadeDark}) 34%, transparent 62%)`;
    const dimTint = `linear-gradient(rgba(0, 0, 0, ${dim}), rgba(0, 0, 0, ${dim}))`;

    return {
        url,
        backgroundImage: `${leftVignette}, ${rightVignette}, ${topEdgeVignette}, ${bottomEdgeVignette}, ${topShade}, ${dimTint}, url("${url}")`,
        backgroundSize: `auto, auto, auto, auto, auto, auto, ${size}`,
        backgroundRepeat: `no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, ${repeat}`,
        backgroundPosition: `left bottom, left bottom, left bottom, left bottom, left bottom, left bottom, left bottom`
    };
}
