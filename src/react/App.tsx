import React, { useState } from 'react';
import SleekCalendarPlugin from '../main';
import { Sidebar } from './components/Sidebar';
import { MainGrid } from './components/MainGrid';
import { RightPane } from './components/RightPane';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CalendarEvent } from '../types';
import { resolveAccentHex, DEFAULT_ACCENT_HEX, hexToRgba, ACCENT_CHIP_TINT_ALPHA, toneDownAccent } from '../utils/colors';
import { resolveBackgroundUrl, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_DIM } from '../utils/backgroundImage';
import { getDoodlePatternUrl, DEFAULT_DOODLE_STYLE, DOODLE_TILE_SIZE, clampDoodleOpacity, isAnimatedDoodleStyle } from '../utils/doodleBackground';

export const App = ({ plugin }: { plugin: SleekCalendarPlugin }) => {
	const [currentDate, setCurrentDate] = useState(new Date());
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	// Which shape the grid is showing, mirrored up from MainGrid. The right pane reads
	// it to stay on its own default view for as long as the full month is up: the
	// event-details view is a day-view idea, and the month does its own dropping.
	const [gridMode, setGridMode] = useState<'days' | 'month'>(() => (plugin?.settings?.viewMode === 'month' ? 'month' : 'days'));
	const showEventDetails = Boolean(selectedEvent) && gridMode !== 'month';
	const [updatedEvent, setUpdatedEvent] = useState<CalendarEvent | null>(null);
	const [deletedEventId, setDeletedEventId] = useState<string | null>(null);

	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [timers, setTimers] = useState<any[]>([]);

	// Calendar profiles the user has switched *off* from the default right pane.
	// This is purely a view filter: no event is ever modified, added or removed —
	// the grid simply stops rendering the tiles whose `profileId` is in here.
	// Clicking a profile chip toggles its id in and out of this set.
	const [hiddenProfileIds, setHiddenProfileIds] = useState<Set<string>>(() => new Set());

	const toggleProfileVisibility = (profileId: string) => {
		setHiddenProfileIds(prev => {
			const next = new Set(prev);
			if (next.has(profileId)) {
				next.delete(profileId);
			} else {
				next.add(profileId);
			}
			return next;
		});
	};

	// Re-render whenever the user changes plugin settings (accent, time zone, ...).
	const [, settingsTick] = useState(0);
	React.useEffect(() => {
		const onChanged = () => settingsTick(t => t + 1);
		document.addEventListener('sleek-calendar-settings-changed', onChanged);
		return () => document.removeEventListener('sleek-calendar-settings-changed', onChanged);
	}, []);

	// Resolve accent (null when accents are disabled) and the effective time zone.
	const accentEnabled = plugin?.settings ? (plugin.settings.accentEnabled ?? true) : true;
	const accentName = plugin?.settings?.accentColor || plugin?.settings?.themeColor || 'blue';
	// The picked swatch is softened exactly once, here, before it becomes the
	// `--sleek-accent` CSS variables and the `accentColor` prop every component
	// below is handed. One mute at the source keeps the whole calendar — solid
	// fills, accent text and the tint wash — at the same, calmer strength.
	const accentColor = accentEnabled ? toneDownAccent(resolveAccentHex(accentName) || DEFAULT_ACCENT_HEX) : null;
	const timeZone = plugin?.settings?.timeZone || 'auto';

	// Optional picture background, resolved to a usable CSS url (vault path or URL).
	const backgroundRaw = plugin?.settings?.backgroundImage || '';
	const backgroundUrl = backgroundRaw ? resolveBackgroundUrl(plugin?.app, backgroundRaw) : '';
	const backgroundFit = plugin?.settings?.backgroundFit || DEFAULT_BACKGROUND_FIT;
	const backgroundDim = Math.min(100, Math.max(0, plugin?.settings?.backgroundDim ?? DEFAULT_BACKGROUND_DIM)) / 100;
	const backgroundInvert = plugin?.settings?.backgroundInvert ?? false;

	const appStyle: React.CSSProperties = {};
	if (accentColor) {
		(appStyle as any)['--sleek-accent'] = accentColor;
		(appStyle as any)['--sleek-accent-soft'] = hexToRgba(accentColor, ACCENT_CHIP_TINT_ALPHA);
	}
	if (backgroundUrl) {
		(appStyle as any)['--sleek-bg-image'] = `url("${backgroundUrl}")`;
		(appStyle as any)['--sleek-bg-dim'] = String(backgroundDim);
		(appStyle as any)['--sleek-bg-size'] = backgroundFit === 'tile' ? 'auto' : backgroundFit === 'contain' ? 'contain' : 'cover';
		(appStyle as any)['--sleek-bg-repeat'] = backgroundFit === 'tile' ? 'repeat' : 'no-repeat';
		(appStyle as any)['--sleek-bg-filter'] = backgroundInvert ? 'invert(1)' : 'none';
	}

	// Optional doodle backdrop. The artwork is a neutral-coloured mask (no picture
	// asset, no accent) that lingers behind the grid at a very low opacity. The
	// "Simple shapes" style is special-cased: it is drawn as an animated DOM layer
	// (see ShapesBackdrop) because animations inside a mask-image never run.
	const doodlesEnabled = plugin?.settings?.doodleEnabled ?? false;
	const doodleStyle = plugin?.settings?.doodleStyle ?? DEFAULT_DOODLE_STYLE;
	const doodleOpacity = clampDoodleOpacity(plugin?.settings?.doodleOpacity) / 100;
	if (doodlesEnabled) {
		(appStyle as any)['--sleek-doodle-image'] = getDoodlePatternUrl(doodleStyle);
		(appStyle as any)['--sleek-doodle-size'] = `${DOODLE_TILE_SIZE}px`;
		(appStyle as any)['--sleek-doodle-opacity'] = String(doodleOpacity);
	}
	const doodleAnimated = doodlesEnabled && isAnimatedDoodleStyle(doodleStyle);

	const appClassName = `sleek-calendar-app${accentColor ? '' : ' sleek-accent-off'}${backgroundUrl ? ' sleek-has-bg' : ''}${doodlesEnabled ? ' sleek-has-doodles' : ''}${doodleAnimated ? ' sleek-has-shapes' : ''}`;

	// Load timers on mount
	React.useEffect(() => {
		if (plugin && plugin.settings && plugin.settings.timers) {
			setTimers(plugin.settings.timers.map(t => ({ ...t, timeRemainingMin: t.timeRemainingMin ?? t.durationMin })));
		}
	}, [plugin]);

	// Save timers to plugin settings
	const saveTimersTimeoutRef = React.useRef<any>(null);
	React.useEffect(() => {
		if (plugin && timers !== plugin.settings.timers) {
			plugin.settings.timers = timers;
			if (saveTimersTimeoutRef.current) clearTimeout(saveTimersTimeoutRef.current);
			saveTimersTimeoutRef.current = setTimeout(() => {
				plugin.saveSettings();
			}, 500);
		}
	}, [timers, plugin]);

	// Load events from plugin settings on mount
	React.useEffect(() => {
		if (plugin && plugin.settings && plugin.settings.events) {
			const parsedEvents = plugin.settings.events.map(ev => ({
				...ev,
				startTime: new Date(ev.startTime),
				endTime: new Date(ev.endTime)
			}));
			setEvents(parsedEvents);
		}
	}, [plugin]);

	// Debounced save events to plugin settings
	const saveEventsTimeoutRef = React.useRef<any>(null);
	React.useEffect(() => {
		if (plugin && events !== plugin.settings.events) {
			plugin.settings.events = events;
			if (saveEventsTimeoutRef.current) clearTimeout(saveEventsTimeoutRef.current);
			saveEventsTimeoutRef.current = setTimeout(() => {
				plugin.saveSettings();
			}, 500);
		}
	}, [events, plugin]);

	const handleCreateEvent = () => {
		// Can add logic to create a blank default event
	};

	const handleEventSelect = (event: CalendarEvent) => {
		setSelectedEvent(event);
	};

	const handleEventUpdate = (newEvent: CalendarEvent) => {
		setSelectedEvent(newEvent);
		setUpdatedEvent(newEvent); // pass this down to MainGrid
	};

	const handleEventDelete = (id: string) => {
		if (selectedEvent?.id === id) {
			setSelectedEvent(null);
		}
		setDeletedEventId(id);
	};

	const handleGridEventModified = (updatedEvent: CalendarEvent) => {
		// Only refresh an event that is ALREADY open in the details pane. This keeps
		// the pane in sync (e.g. a to-do dropped onto the open event) without ever
		// auto-opening the pane — the details view only appears when the user
		// explicitly clicks a tile.
		setSelectedEvent(prev => (prev && prev.id === updatedEvent.id ? updatedEvent : prev));
	};

	const handleNavigate = (direction: 'prev' | 'next' | 'today') => {
		const newDate = new Date(currentDate);
		if (direction === 'today') {
			setCurrentDate(new Date());
		} else if (direction === 'prev') {
			newDate.setDate(newDate.getDate() - 1);
			setCurrentDate(newDate);
		} else if (direction === 'next') {
			newDate.setDate(newDate.getDate() + 1);
			setCurrentDate(newDate);
		}
	};

	return (
		<div
			className={appClassName}
			style={appStyle}
		>
			<ErrorBoundary fallback={
				<div style={{ padding: '40px', textAlign: 'center', flex: 1, color: '#ffffff', backgroundColor: '#cc0000', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
					<h2 style={{ color: 'white' }}>Calendar Grid Crash!</h2>
					<p>There was a critical error rendering the calendar grid.</p>
				</div>
			}>
				<MainGrid
					events={events}
					setEvents={setEvents}
					timers={timers}
					setTimers={setTimers}
					accentColor={accentColor}
					timeZone={timeZone}
					plugin={plugin}
					currentDate={currentDate}
					onCreateEvent={handleCreateEvent}
					onEventSelect={handleEventSelect}
					selectedEventId={selectedEvent?.id}
					externalUpdatedEvent={updatedEvent}
					externalDeletedEventId={deletedEventId}
					onEventModified={handleGridEventModified}
					onEventDelete={handleEventDelete}
					onNavigate={handleNavigate}
					onSelectDate={setCurrentDate}
					onViewModeChange={setGridMode}
					hiddenProfileIds={hiddenProfileIds}
				/>
			</ErrorBoundary>
			<div className="sleek-right-panel-wrapper" style={{ zIndex: 5, position: 'relative' }}>
				<div style={{ display: showEventDetails ? 'none' : 'flex', width: '100%', height: '100%', flexDirection: 'column' }}>
					<Sidebar currentDate={currentDate} setCurrentDate={setCurrentDate} plugin={plugin} timers={timers} setTimers={setTimers} accentColor={accentColor} timeZone={timeZone} events={events} mode={gridMode} hiddenProfileIds={hiddenProfileIds} onToggleProfileVisibility={toggleProfileVisibility} />
				</div>
				{showEventDetails && selectedEvent && (
					<div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column' }}>
						<ErrorBoundary fallback={
							<div style={{ padding: '20px', textAlign: 'center' }}>
								<p style={{ color: 'var(--text-muted)' }}>Could not display event details.</p>
								<button
									type="button"
									onClick={() => setSelectedEvent(null)}
									style={{ cursor: 'pointer', padding: '6px 12px', borderRadius: '6px' }}
								>
									Close
								</button>
							</div>
						}>
							<RightPane
								event={selectedEvent}
								onClose={() => setSelectedEvent(null)}
								onDelete={handleEventDelete}
								onUpdate={handleEventUpdate}
								onDateSelect={setCurrentDate}
								plugin={plugin}
								timers={timers}
								accentColor={accentColor}
								timeZone={timeZone}
								events={events}
								setTimers={setTimers}
							/>
						</ErrorBoundary>
					</div>
				)}
			</div>
		</div>
	);
};
