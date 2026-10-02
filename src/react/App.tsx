import React, { useState } from 'react';
import SleekCalendarPlugin from '../main';
import { Sidebar } from './components/Sidebar';
import { MainGrid } from './components/MainGrid';
import { RightPane } from './components/RightPane';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CalendarEvent } from '../types';
import { resolveAccentHex, DEFAULT_ACCENT_HEX, hexToRgba, ACCENT_CHIP_TINT_ALPHA } from '../utils/colors';
import { resolveBackgroundUrl, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_DIM } from '../utils/backgroundImage';
import { getDoodlePatternUrl, DEFAULT_DOODLE_STYLE, DOODLE_TILE_SIZE, clampDoodleOpacity, isAnimatedDoodleStyle } from '../utils/doodleBackground';

export const App = ({ plugin }: { plugin: SleekCalendarPlugin }) => {
	const [currentDate, setCurrentDate] = useState(new Date());
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	const [updatedEvent, setUpdatedEvent] = useState<CalendarEvent | null>(null);
	const [deletedEventId, setDeletedEventId] = useState<string | null>(null);

	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [timers, setTimers] = useState<any[]>([]);

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
	const accentColor = accentEnabled ? (resolveAccentHex(accentName) || DEFAULT_ACCENT_HEX) : null;
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
				/>
			</ErrorBoundary>
			<div className="sleek-right-panel-wrapper" style={{ zIndex: 5, position: 'relative' }}>
				<div style={{ display: selectedEvent ? 'none' : 'flex', width: '100%', height: '100%', flexDirection: 'column' }}>
					<Sidebar currentDate={currentDate} setCurrentDate={setCurrentDate} plugin={plugin} timers={timers} setTimers={setTimers} accentColor={accentColor} timeZone={timeZone} events={events} />
				</div>
				{selectedEvent && (
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
