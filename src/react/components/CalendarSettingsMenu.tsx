import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SleekCalendarPlugin from '../../main';
import { ACCENT_SWATCHES, EVENT_COLOR_HEX, PALETTE_ORDER, resolveAccentHex, DEFAULT_ACCENT_HEX, toneDownAccent } from '../../utils/colors';
import { AUTO_TIME_ZONE, TIME_ZONE_OPTIONS, getNowInTimeZone, getTimeZoneLabel } from '../../utils/timezone';
import { BACKGROUND_FIT_OPTIONS, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_DIM } from '../../utils/backgroundImage';
import {
    DOODLE_STYLES,
    DEFAULT_DOODLE_STYLE,
    isAnimatedDoodleStyle,
    MAX_DOODLE_OPACITY,
    clampDoodleOpacity,
    MIN_DOODLE_SHAPE_COUNT,
    MAX_DOODLE_SHAPE_COUNT,
    clampDoodleShapeCount,
    MIN_DOODLE_SHAPE_SIZE,
    MAX_DOODLE_SHAPE_SIZE,
    clampDoodleShapeSize,
    MIN_DOODLE_SHAPE_ROTATION,
    MAX_DOODLE_SHAPE_ROTATION,
    clampDoodleShapeRotation,
    MIN_DOODLE_SHAPE_STROKE,
    MAX_DOODLE_SHAPE_STROKE,
    clampDoodleShapeStroke,
    MIN_DOODLE_SHAPE_SPREAD,
    MAX_DOODLE_SHAPE_SPREAD,
    clampDoodleShapeSpread
} from '../../utils/doodleBackground';
import { refreshAccessToken, fetchCalendarList } from '../../api/googleAuth';

/**
 * In-calendar settings menu.
 *
 * Everything the user tweaks to make the calendar look and behave how they want
 * (accent colour, tile detail lines, time zone, background picture, doodle
 * backdrop and which Google calendars are visible) lives here instead of buried
 * in Obsidian's plugin settings. The one thing that stays behind is the
 * bring-your-own-key Google connection, because it is account setup rather than
 * a calendar adjustment.
 *
 * The surface deliberately reuses the same dark, translucent "sleek-menu" shell
 * as the tile right-click menu and the profile popovers so every menu in the app
 * feels like one family: same radius, shadow, row height, hover wash and spacing.
 */

type Draft = {
    accentEnabled: boolean;
    accentColor: string;
    showTileDetails: boolean;
    /** Default palette colour for a quiet day tile in the month view. */
    monthViewDefaultColor: string;
    timeZone: string;
    backgroundImage: string;
    backgroundFit: string;
    backgroundDim: number;
    backgroundInvert: boolean;
    doodleEnabled: boolean;
    doodleStyle: string;
    doodleOpacity: number;
    doodleShapeCount: number;
    doodleShapeSize: number;
    doodleShapeRotation: number;
    doodleShapeStroke: number;
    doodleShapeSpread: number;
};

type GoogleCalendar = { id: string; summary: string; backgroundColor?: string };

const MENU_WIDTH = 344;

/** A titled block of related rows. */
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="sleek-settings-section">
        <div className="sleek-settings-section-title">{title}</div>
        <div className="sleek-settings-section-body">{children}</div>
    </div>
);

/** A label (+ optional hint) on the left, a control on the right. */
const Row = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
    <div className="sleek-settings-row">
        <div className="sleek-settings-row-text">
            <span className="sleek-settings-row-label">{label}</span>
            {desc ? <span className="sleek-settings-row-desc">{desc}</span> : null}
        </div>
        <div className="sleek-settings-row-control">{children}</div>
    </div>
);

/** Neutral switch — never Obsidian's purple default toggle. */
const Toggle = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`sleek-settings-toggle${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
    >
        <span className="sleek-settings-toggle-thumb" />
    </button>
);

const Slider = ({
    value,
    min,
    max,
    step,
    suffix,
    onChange
}: {
    value: number;
    min: number;
    max: number;
    step: number;
    suffix?: string;
    onChange: (v: number) => void;
}) => (
    <div className="sleek-settings-slider">
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="sleek-settings-slider-value">
            {value}
            {suffix || ''}
        </span>
    </div>
);

const Select = ({
    value,
    options,
    onChange
}: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
}) => (
    <select className="sleek-settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
            <option key={o.value} value={o.value}>
                {o.label}
            </option>
        ))}
    </select>
);

export const CalendarSettingsMenu = ({
    plugin,
    anchorRect,
    onClose
}: {
    plugin?: SleekCalendarPlugin;
    anchorRect: DOMRect | null;
    onClose: () => void;
}) => {
    const settings = plugin?.settings;

    const [draft, setDraft] = useState<Draft>(() => ({
        accentEnabled: settings?.accentEnabled ?? true,
        accentColor: settings?.accentColor || settings?.themeColor || 'blue',
        showTileDetails: settings?.showTileDetails !== false,
        monthViewDefaultColor: settings?.monthViewDefaultColor || 'pastel-blue',
        timeZone: settings?.timeZone || AUTO_TIME_ZONE,
        backgroundImage: settings?.backgroundImage || '',
        backgroundFit: settings?.backgroundFit || DEFAULT_BACKGROUND_FIT,
        backgroundDim: settings?.backgroundDim ?? DEFAULT_BACKGROUND_DIM,
        backgroundInvert: settings?.backgroundInvert ?? false,
        doodleEnabled: settings?.doodleEnabled ?? false,
        doodleStyle: settings?.doodleStyle || DEFAULT_DOODLE_STYLE,
        doodleOpacity: clampDoodleOpacity(settings?.doodleOpacity),
        doodleShapeCount: clampDoodleShapeCount(settings?.doodleShapeCount),
        doodleShapeSize: clampDoodleShapeSize(settings?.doodleShapeSize),
        doodleShapeRotation: clampDoodleShapeRotation(settings?.doodleShapeRotation),
        doodleShapeStroke: clampDoodleShapeStroke(settings?.doodleShapeStroke),
        doodleShapeSpread: clampDoodleShapeSpread(settings?.doodleShapeSpread)
    }));

    // ---- Visible calendars (fetched from Google, read-only list) ----
    const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
    const [calLoading, setCalLoading] = useState(false);
    const [calError, setCalError] = useState<string | null>(null);
    const [selectedCalendars, setSelectedCalendars] = useState<string[]>(() => [...(settings?.selectedCalendars || [])]);

    // Accent colour dropdown (compact) — collapsed by default so the swatch grid
    // no longer takes up a whole block of the panel. Dismissed on any click that
    // lands outside it (see the outside-click handler below).
    const [accentOpen, setAccentOpen] = useState(false);
    const accentRef = useRef<HTMLDivElement | null>(null);

    // Month-view day colour dropdown — same compact shell as the accent picker.
    const [monthColorOpen, setMonthColorOpen] = useState(false);
    const monthColorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!plugin?.settings?.refreshToken) return;
        let cancelled = false;
        setCalLoading(true);
        (async () => {
            try {
                const token = await refreshAccessToken(
                    plugin.settings.googleClientId,
                    plugin.settings.googleClientSecret,
                    plugin.settings.refreshToken
                );
                const list = await fetchCalendarList(token);
                if (!cancelled) setCalendars(list as GoogleCalendar[]);
            } catch (e: any) {
                if (!cancelled) setCalError(e?.message || 'Could not load calendars');
            } finally {
                if (!cancelled) setCalLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [plugin]);

    // ---- Position the panel under the gear, right-aligned to it ----
    const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

    useLayoutEffect(() => {
        const place = () => {
            if (!anchorRect) return;
            const margin = 10;
            const right = Math.max(margin, window.innerWidth - anchorRect.right);
            const top = anchorRect.bottom + 8;
            const maxHeight = Math.max(240, window.innerHeight - top - margin);
            setPos({ top, right, maxHeight });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [anchorRect]);

    // ---- Dismiss on outside click / Escape ----
    const menuRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('[data-sleek-settings-anchor]')) return;
            if (menuRef.current && !menuRef.current.contains(target as Node)) {
                onClose();
                return;
            }
            // A click elsewhere in the panel closes an open dropdown but leaves
            // the panel itself open.
            if (accentRef.current && !accentRef.current.contains(target as Node)) {
                setAccentOpen(false);
            }
            if (monthColorRef.current && !monthColorRef.current.contains(target as Node)) {
                setMonthColorOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [onClose]);

    // Persist a patch to plugin settings and let the calendar re-render live.
    const update = (patch: Partial<Draft>) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        if (plugin?.settings) {
            Object.assign(plugin.settings, patch);
            plugin.saveSettings();
            plugin.notifySettingsChanged();
        }
    };

    const chooseAccent = (name: string) => {
        // Picking a swatch also turns accents back on — mirrors the old settings tab.
        setDraft((prev) => ({ ...prev, accentColor: name, accentEnabled: true }));
        if (plugin?.settings) {
            plugin.settings.accentColor = name;
            plugin.settings.themeColor = name;
            plugin.settings.accentEnabled = true;
            plugin.saveSettings();
            plugin.notifySettingsChanged();
        }
    };

    const toggleCalendar = (id: string, checked: boolean) => {
        const next = new Set(selectedCalendars);
        if (checked) next.add(id);
        else next.delete(id);
        const arr = Array.from(next);
        setSelectedCalendars(arr);
        if (plugin?.settings) {
            plugin.settings.selectedCalendars = arr;
            plugin.saveSettings();
        }
    };

    const tz = draft.timeZone || AUTO_TIME_ZONE;
    const nowLabel = (() => {
        try {
            const now = getNowInTimeZone(tz);
            const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            return `Current time: ${time} (${getTimeZoneLabel(tz)})`;
        } catch {
            return '';
        }
    })();

    const shapesVisible = isAnimatedDoodleStyle(draft.doodleStyle);
    // The panel is portaled to <body>, i.e. OUTSIDE .sleek-calendar-app, so the
    // accent CSS variable has to be re-declared here for the toggles/checkboxes.
    // Softened the same way `App` softens the app-wide accent, so the panel's
    // toggles/checkboxes never preview the raw, more intense swatch.
    const accentHex = draft.accentEnabled
        ? (toneDownAccent(resolveAccentHex(draft.accentColor) || DEFAULT_ACCENT_HEX) || DEFAULT_ACCENT_HEX)
        : 'rgba(255, 255, 255, 0.5)';

    const panel = (
        <div
            ref={menuRef}
            className="sleek-menu sleek-settings-menu"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
                ['--sleek-accent' as any]: accentHex,
                position: 'fixed',
                top: pos ? pos.top : -9999,
                right: pos ? pos.right : 10,
                width: MENU_WIDTH,
                maxHeight: pos ? pos.maxHeight : undefined,
                visibility: pos ? 'visible' : 'hidden',
                zIndex: 3000
            }}
        >
            <div className="sleek-settings-head">
                <span className="sleek-settings-title">Calendar settings</span>
                <button type="button" className="sleek-settings-close" title="Close" onClick={onClose}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <div className="sleek-settings-scroll">
                {/* ---- Appearance ---- */}
                <Section title="Appearance">
                    <Row label="Enable accent color" desc="Today's date and the current hour use your accent colour.">
                        <Toggle checked={draft.accentEnabled} onChange={(v) => update({ accentEnabled: v })} />
                    </Row>
                    <Row label="Accent color" desc="Used for today's date and the current hour.">
                        <div className="sleek-settings-colors" ref={accentRef}>
                            <button
                                type="button"
                                className="sleek-settings-colors-btn"
                                disabled={!draft.accentEnabled}
                                onClick={() => setAccentOpen((o) => !o)}
                                title="Choose accent colour"
                            >
                                <span
                                    className="sleek-settings-colors-dot"
                                    style={{ background: EVENT_COLOR_HEX[draft.accentColor] || 'rgba(255, 255, 255, 0.2)' }}
                                />
                                <span className="sleek-settings-colors-label">{draft.accentColor.replace(/-/g, ' ')}</span>
                                <svg className="sleek-settings-colors-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                            {accentOpen && draft.accentEnabled && (
                                <div className="sleek-settings-colors-menu">
                                    {ACCENT_SWATCHES.map((name) => (
                                        <button
                                            key={name}
                                            type="button"
                                            className={`sleek-settings-swatch${draft.accentColor === name ? ' is-selected' : ''}`}
                                            style={{ background: EVENT_COLOR_HEX[name] || 'rgba(255, 255, 255, 0.2)' }}
                                            title={name}
                                            onClick={() => {
                                                chooseAccent(name);
                                                setAccentOpen(false);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </Row>
                </Section>

                {/* ---- Event tiles ---- */}
                <Section title="Event tiles">
                    <Row label="Show details on tiles" desc="Print to-do items and description lines inside tiles.">
                        <Toggle checked={draft.showTileDetails} onChange={(v) => update({ showTileDetails: v })} />
                    </Row>
                </Section>

                {/* ---- Month view ---- */}
                <Section title="Month view">
                    <Row
                        label="Default day colour"
                        desc="Day tiles with no events wear this colour. Days with events get their own random colour."
                    >
                        <div className="sleek-settings-colors" ref={monthColorRef}>
                            <button
                                type="button"
                                className="sleek-settings-colors-btn"
                                onClick={() => setMonthColorOpen((o) => !o)}
                                title="Choose the default day-tile colour"
                            >
                                <span
                                    className="sleek-settings-colors-dot"
                                    style={{ background: EVENT_COLOR_HEX[draft.monthViewDefaultColor] || 'rgba(255, 255, 255, 0.2)' }}
                                />
                                <span className="sleek-settings-colors-label">{draft.monthViewDefaultColor.replace(/-/g, ' ')}</span>
                                <svg className="sleek-settings-colors-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                            {monthColorOpen && (
                                <div className="sleek-settings-colors-menu">
                                    {PALETTE_ORDER.map((name) => (
                                        <button
                                            key={name}
                                            type="button"
                                            className={`sleek-settings-swatch${draft.monthViewDefaultColor === name ? ' is-selected' : ''}`}
                                            style={{ background: EVENT_COLOR_HEX[name] || 'rgba(255, 255, 255, 0.2)' }}
                                            title={name}
                                            onClick={() => {
                                                update({ monthViewDefaultColor: name });
                                                setMonthColorOpen(false);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </Row>
                </Section>

                {/* ---- Time zone ---- */}
                <Section title="Time zone">
                    <Row label="Time zone" desc={nowLabel}>
                        <Select value={tz} options={TIME_ZONE_OPTIONS} onChange={(v) => update({ timeZone: v })} />
                    </Row>
                </Section>

                {/* ---- Background picture ---- */}
                <Section title="Calendar background">
                    <div className="sleek-settings-field">
                        <span className="sleek-settings-row-label">Background image</span>
                        <span className="sleek-settings-row-desc">Vault path, wiki link, absolute path or https URL.</span>
                        <div className="sleek-settings-input-row">
                            <input
                                className="sleek-settings-input"
                                type="text"
                                placeholder="Attachments/doodles.png"
                                value={draft.backgroundImage}
                                onChange={(e) => update({ backgroundImage: e.target.value })}
                            />
                            <button
                                type="button"
                                className="sleek-settings-btn"
                                onClick={() =>
                                    plugin?.pickBackgroundImage?.((file) => update({ backgroundImage: file.path }))
                                }
                            >
                                Browse…
                            </button>
                            {draft.backgroundImage ? (
                                <button
                                    type="button"
                                    className="sleek-settings-icon-btn"
                                    title="Clear background picture"
                                    onClick={() => update({ backgroundImage: '' })}
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <Row label="Fit" desc="How the picture fills the calendar.">
                        <Select
                            value={draft.backgroundFit}
                            options={BACKGROUND_FIT_OPTIONS}
                            onChange={(v) => update({ backgroundFit: v })}
                        />
                    </Row>
                    <Row label="Dim" desc="Darken the picture so events stay readable.">
                        <Slider value={draft.backgroundDim} min={0} max={100} step={5} suffix="%" onChange={(v) => update({ backgroundDim: v })} />
                    </Row>
                    <Row label="Invert colors" desc="Flip black/white for dark themes.">
                        <Toggle checked={draft.backgroundInvert} onChange={(v) => update({ backgroundInvert: v })} />
                    </Row>
                </Section>

                {/* ---- Doodle backdrop ---- */}
                <Section title="Doodle backdrop">
                    <Row label="Enable doodle backdrop" desc="Faint hand-drawn lines behind the calendar.">
                        <Toggle checked={draft.doodleEnabled} onChange={(v) => update({ doodleEnabled: v })} />
                    </Row>
                    <Row label="Style">
                        <Select value={draft.doodleStyle} options={DOODLE_STYLES} onChange={(v) => update({ doodleStyle: v })} />
                    </Row>
                    <Row label="Intensity" desc="How faint the lines are.">
                        <Slider
                            value={draft.doodleOpacity}
                            min={0}
                            max={MAX_DOODLE_OPACITY}
                            step={1}
                            suffix="%"
                            onChange={(v) => update({ doodleOpacity: clampDoodleOpacity(v) })}
                        />
                    </Row>
                    {shapesVisible ? (
                        <>
                            <Row label="Shape amount">
                                <Slider
                                    value={draft.doodleShapeCount}
                                    min={MIN_DOODLE_SHAPE_COUNT}
                                    max={MAX_DOODLE_SHAPE_COUNT}
                                    step={2}
                                    onChange={(v) => update({ doodleShapeCount: clampDoodleShapeCount(v) })}
                                />
                            </Row>
                            <Row label="Shape size">
                                <Slider
                                    value={draft.doodleShapeSize}
                                    min={MIN_DOODLE_SHAPE_SIZE}
                                    max={MAX_DOODLE_SHAPE_SIZE}
                                    step={5}
                                    suffix="%"
                                    onChange={(v) => update({ doodleShapeSize: clampDoodleShapeSize(v) })}
                                />
                            </Row>
                            <Row label="Shape rotation">
                                <Slider
                                    value={draft.doodleShapeRotation}
                                    min={MIN_DOODLE_SHAPE_ROTATION}
                                    max={MAX_DOODLE_SHAPE_ROTATION}
                                    step={5}
                                    suffix="°"
                                    onChange={(v) => update({ doodleShapeRotation: clampDoodleShapeRotation(v) })}
                                />
                            </Row>
                            <Row label="Shape stroke">
                                <Slider
                                    value={draft.doodleShapeStroke}
                                    min={MIN_DOODLE_SHAPE_STROKE}
                                    max={MAX_DOODLE_SHAPE_STROKE}
                                    step={0.5}
                                    onChange={(v) => update({ doodleShapeStroke: clampDoodleShapeStroke(v) })}
                                />
                            </Row>
                            <Row label="Shape spread" desc="Push the shapes apart, or draw them together.">
                                <Slider
                                    value={draft.doodleShapeSpread}
                                    min={MIN_DOODLE_SHAPE_SPREAD}
                                    max={MAX_DOODLE_SHAPE_SPREAD}
                                    step={0.05}
                                    suffix="×"
                                    onChange={(v) => update({ doodleShapeSpread: clampDoodleShapeSpread(v) })}
                                />
                            </Row>
                        </>
                    ) : null}
                </Section>

                {/* ---- Visible calendars ---- */}
                <Section title="Visible calendars">
                    {!settings?.refreshToken ? (
                        <div className="sleek-settings-note">
                            Connect Google Calendar in the plugin settings to choose which calendars show here.
                        </div>
                    ) : calLoading ? (
                        <div className="sleek-settings-note">Loading calendars…</div>
                    ) : calError ? (
                        <div className="sleek-settings-note is-error">{calError}</div>
                    ) : calendars && calendars.length > 0 ? (
                        <div className="sleek-settings-calendars">
                            {calendars.map((cal) => (
                                <label key={cal.id} className="sleek-settings-calendar">
                                    <input
                                        type="checkbox"
                                        checked={selectedCalendars.includes(cal.id)}
                                        onChange={(e) => toggleCalendar(cal.id, e.target.checked)}
                                    />
                                    <span
                                        className="sleek-settings-calendar-dot"
                                        style={{ background: cal.backgroundColor || 'rgba(255, 255, 255, 0.3)' }}
                                    />
                                    <span className="sleek-settings-calendar-name">{cal.summary}</span>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <div className="sleek-settings-note">No calendars found.</div>
                    )}
                </Section>
            </div>
        </div>
    );

    return createPortal(panel, document.body);
};
