import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Notice } from 'obsidian';
import { CalendarEvent, CalendarProfile, CustomRepeat, EventTodo } from '../../types';
import { format, differenceInMinutes, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import SleekCalendarPlugin from '../../main';
import { extractObsidianDoc, getVaultNotes } from '../../utils/dragDrop';
import { AUTO_TIME_ZONE, getNowInTimeZone, getTimeZoneDisplayLabel, getTimeZoneOffsetMinutes, resolveTimeZone, TIME_ZONE_OPTIONS } from '../../utils/timezone';
import { eventOccursOnDay } from '../../utils/events';
import { randomEventDotColor, accentColorForId, resolveAccentHex, DEFAULT_ACCENT_HEX, hexToRgba, ACCENT_CHIP_TINT_ALPHA } from '../../utils/colors';
import { AddressSuggestion, buildGoogleMapsUrl, searchAddresses } from '../../utils/maps';
import { buildPlannerNoteName, createPlannerNote, PLANNER_NOTES_FOLDER } from '../../utils/plannerNotes';
import { CustomRepeatModal } from './CustomRepeatModal';
import { NoteComposer } from './NoteComposer';

/* The two note actions in the attachment section share one look: a quiet dashed chip
   that only warms up on hover. Kept here rather than inline twice so the pair reads as
   a set — the same border, the same muted ink, the same reveal. */
const NOTE_ACTION_BTN_STYLE: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	padding: '4px 10px',
	borderRadius: '5px',
	border: '1px dashed var(--background-modifier-border)',
	background: 'transparent',
	color: 'var(--text-muted)',
	fontSize: '12px',
	cursor: 'pointer',
	transition: 'all 0.15s ease'
};

const noteActionHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
	e.currentTarget.style.borderColor = 'var(--background-modifier-border-hover, var(--text-muted))';
	e.currentTarget.style.color = 'var(--text-normal)';
	e.currentTarget.style.background = 'var(--background-modifier-hover)';
};

const noteActionHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
	e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
	e.currentTarget.style.color = 'var(--text-muted)';
	e.currentTarget.style.background = 'transparent';
};

interface RightPaneProps {
	event: CalendarEvent | null;
	onClose: () => void;
	onUpdate: (updatedEvent: CalendarEvent) => void;
	onDateSelect?: (date: Date) => void;
	onDelete?: (id: string) => void;
	plugin?: SleekCalendarPlugin;
	timers?: any[];
	accentColor?: string | null;
	timeZone?: string;
	events?: CalendarEvent[];
	setTimers?: React.Dispatch<React.SetStateAction<any[]>>;
}


const ALL_TIME_SLOTS = Array.from({ length: 96 }).map((_, i) => ({
	hour: Math.floor(i / 4),
	min: (i % 4) * 15
}));

const ALL_END_TIME_SLOTS = [
	...Array.from({ length: 95 }).map((_, i) => ({
		hour: Math.floor((i + 1) / 4),
		min: ((i + 1) % 4) * 15
	})),
	{ hour: 23, min: 59 }
];

/* Reminder lead times. The stored values are the ones the pane has always used; the
	  menu simply spells them out as rows instead of native options. */
const REMINDER_OPTIONS = ['10min before', '30min before', '1h before'];


const InlineMiniCalendar = ({ currentDate, onSelect, accentColor, timeZone, events }: { currentDate: Date, onSelect: (date: Date) => void, accentColor?: string | null, timeZone?: string, events?: CalendarEvent[] }) => {
	const [month, setMonth] = useState(currentDate);
	const nowInTz = getNowInTimeZone(timeZone);
	const monthStart = startOfMonth(month);
	const monthEnd = endOfMonth(monthStart);
	const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
	const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
	const days = eachDayOfInterval({ start: startDate, end: endDate });
	const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

	return (
		<div className="inline-mini-calendar" style={{ background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: '12px', padding: '20px', marginTop: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', width: '280px' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
				<div style={{ fontWeight: 500, fontSize: '15px', color: 'var(--text-normal)' }}>{format(month, 'MMMM yyyy')}</div>
				<div style={{ display: 'flex', gap: '8px' }}>
					<button onClick={() => setMonth(subMonths(month, 1))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>&lt;</button>
					<button onClick={() => setMonth(addMonths(month, 1))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>&gt;</button>
				</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', fontWeight: 500 }}>
				{weekDays.map((d, i) => <div key={i}>{d}</div>)}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '14px', rowGap: '12px', columnGap: '4px' }}>
				{days.map((day, i) => {
					const isCurrentMonth = isSameMonth(day, monthStart);
					const isSelected = isSameDay(day, currentDate);
					const isToday = isSameDay(day, nowInTz);
					const hasEvent = eventOccursOnDay(events, day);
					return (
						<div
							key={i}
							onClick={() => onSelect(day)}
							style={{
								cursor: 'pointer',
								color: isSelected ? (accentColor || 'var(--text-normal)') : isToday ? (accentColor || 'var(--text-normal)') : isCurrentMonth ? 'var(--text-normal)' : 'var(--text-faint)',
								// A whisper of the accent as a background wash: just enough to read
								// as "this day carries the accent", never a solid block of colour.
								background: isSelected
									? (accentColor ? hexToRgba(accentColor, ACCENT_CHIP_TINT_ALPHA) : 'var(--background-modifier-hover)')
									: 'transparent',
								border: !isSelected && isToday ? `1.5px solid ${accentColor || 'var(--background-modifier-border)'}` : '1.5px solid transparent',
								boxSizing: 'border-box',
								position: 'relative',
								width: '32px', height: '32px', lineHeight: '29px', margin: '0 auto', borderRadius: '8px', fontWeight: isSelected || isToday ? 600 : 400
							}}
							onMouseEnter={(e) => !isSelected && (e.currentTarget.style.background = 'var(--background-modifier-hover)')}
							onMouseLeave={(e) => !isSelected && (e.currentTarget.style.background = 'transparent')}
						>
							{format(day, 'd')}
							{hasEvent && (
								<span
									aria-hidden="true"
									style={{
										position: 'absolute',
										bottom: '2px',
										left: '50%',
										transform: 'translateX(-50%)',
										width: '4px',
										height: '4px',
										borderRadius: '50%',
										background: randomEventDotColor(day),
										pointerEvents: 'none'
									}}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};

// Recurrence choices shown in the "Repeat" row.
const REPEAT_OPTIONS = [
	{ value: 'none', label: 'Does not repeat' },
	{ value: 'daily', label: 'Every day' },
	{ value: 'every-other-day', label: 'Every other day' },
	{ value: 'weekly', label: 'Every week' },
	{ value: 'biweekly', label: 'Every two weeks' },
	{ value: 'monthly', label: 'Every month' },
	{ value: 'yearly', label: 'Every year' },
	{ value: 'custom', label: 'Custom' }
];

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const ordinal = (n: number): string => {
	const suffixes = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
};

// Muted trailing detail for a repeat choice, mirroring Notion Calendar
// (e.g. "Every week  on Sat", "Every month  on the 3rd", "Every year  on Oct 3").
const repeatDetail = (value: string, date: Date): string => {
	switch (value) {
		case 'weekly':
		case 'biweekly':
			return `on ${format(date, 'EEE')}`;
		case 'monthly':
			return `on the ${ordinal(date.getDate())}`;
		case 'yearly':
			return `on ${format(date, 'MMM d')}`;
		default:
			return '';
	}
};

const describeCustomRepeat = (custom?: CustomRepeat | null): string => {
	if (!custom) return 'Custom';
	const every = custom.interval > 1 ? `Every ${custom.interval} ${custom.unit}s` : `Every ${custom.unit}`;
	let summary = every;
	if (custom.unit === 'week' && custom.weekdays && custom.weekdays.length > 0) {
		const days = custom.weekdays.slice().sort((a, b) => a - b).map(d => WEEKDAY_LABELS[d]).join(', ');
		summary = `${every} on ${days}`;
	}
	if (custom.ends === 'on' && custom.endDate) summary += ` until ${custom.endDate}`;
	else if (custom.ends === 'after' && custom.count) summary += `, ${custom.count} times`;
	return summary;
};

export const RightPane = ({ event, onClose, onUpdate, onDateSelect, onDelete, plugin, timers, accentColor, timeZone, events, setTimers }: RightPaneProps) => {
	const nowInTz = getNowInTimeZone(timeZone);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [reminders, setReminders] = useState('30min before');
	const [linkedNotes, setLinkedNotes] = useState<string[]>([]);
	const [eventTodos, setEventTodos] = useState<EventTodo[]>([]);
	const [isAddingEventTodo, setIsAddingEventTodo] = useState(false);
	const [newEventTodoInput, setNewEventTodoInput] = useState('');
	const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
	const [editingTodoText, setEditingTodoText] = useState<string>('');
	const [miniCalendarMonth, setMiniCalendarMonth] = useState(new Date());
	const [openDropdown, setOpenDropdown] = useState<'none' | 'start' | 'end' | 'date' | 'color' | 'timezone' | 'repeat' | 'reminders'>('none');
	const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);
	const [showCustomRepeat, setShowCustomRepeat] = useState(false);
	const [isComposingNote, setIsComposingNote] = useState(false);
	const titleInputRef = useRef<HTMLTextAreaElement>(null);
	const descTextareaRef = useRef<HTMLTextAreaElement>(null);
	const currentEventIdRef = useRef<string | null>(null);
	const latestEventRef = useRef<CalendarEvent | null>(null);

	useEffect(() => {
		latestEventRef.current = event || null;
	}, [event]);
	const startTimeListRef = useRef<HTMLDivElement>(null);
	const endTimeListRef = useRef<HTMLDivElement>(null);
	// Note mention & linking state
	const [isLinkingNote, setIsLinkingNote] = useState(false);
	const [noteSearchInput, setNoteSearchInput] = useState('');
	const [noteSelectedIdx, setNoteSelectedIdx] = useState(0);
	const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());
	const isSelectingNoteRef = useRef(false);

	const [titleSelectedIdx, setTitleSelectedIdx] = useState(0);
	const [descSelectedIdx, setDescSelectedIdx] = useState(0);
	const isSelectingTitleRef = useRef(false);
	const isSelectingDescRef = useRef(false);

	// Location search (free OpenStreetMap/Photon autocomplete — no API key)
	const [isEditingLocation, setIsEditingLocation] = useState(false);
	const [locationInput, setLocationInput] = useState('');
	const [locationSuggestions, setLocationSuggestions] = useState<AddressSuggestion[]>([]);
	const [locationSelectedIdx, setLocationSelectedIdx] = useState(0);
	const [isLoadingLocation, setIsLoadingLocation] = useState(false);
	const locationInputRef = useRef<HTMLInputElement>(null);
	const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const locationRequestIdRef = useRef(0);

	// --- Calendar profiles (Work, Hobby, School, …) ---
	// Profiles are created, renamed, deleted and recoloured in the default right
	// pane (the Sidebar). Here an event only ever *attaches* one, through the
	// picker under its title, so this pane needs nothing but that popover's state.
	const [profilePickerOpen, setProfilePickerOpen] = useState(false);

	const vaultNotes = getVaultNotes(plugin);

	// Attachment section search
	const noteSearchQuery = noteSearchInput.replace(/^@/, '').toLowerCase().trim();
	const noteSuggestions = isLinkingNote
		? vaultNotes.filter(n => n.basename.toLowerCase().includes(noteSearchQuery) || n.path.toLowerCase().includes(noteSearchQuery)).slice(0, 8)
		: [];

	useEffect(() => {
		setNoteSelectedIdx(0);
	}, [noteSearchQuery]);

	// Title mention
	const titleLastAt = title.lastIndexOf('@');
	const showTitleSuggestions = titleLastAt !== -1;
	const titleQuery = showTitleSuggestions ? title.substring(titleLastAt + 1).toLowerCase() : '';
	const titleSuggestions = showTitleSuggestions
		? vaultNotes.filter(n => n.basename.toLowerCase().includes(titleQuery) || n.path.toLowerCase().includes(titleQuery)).slice(0, 8)
		: [];

	useEffect(() => {
		setTitleSelectedIdx(0);
	}, [titleQuery]);

	// Description mention
	const descLastAt = description.lastIndexOf('@');
	const descAfterAt = descLastAt !== -1 ? description.substring(descLastAt + 1) : '';
	const showDescSuggestions = descLastAt !== -1 && !descAfterAt.includes('\n') && descAfterAt.length < 50;
	const descQuery = showDescSuggestions ? descAfterAt.toLowerCase() : '';
	const descSuggestions = showDescSuggestions
		? vaultNotes.filter(n => n.basename.toLowerCase().includes(descQuery) || n.path.toLowerCase().includes(descQuery)).slice(0, 8)
		: [];

	useEffect(() => {
		setDescSelectedIdx(0);
	}, [descQuery]);

	useEffect(() => {
		if (event) {
			const isDifferentEvent = currentEventIdRef.current !== event.id;
			currentEventIdRef.current = event.id;

			if (isDifferentEvent) {
				setTitle(event.title || '');
				// Strip any legacy [[Note]] links so description is purely clean typed text
				const rawDesc = event.description || '';
				const legacyMatches = [...rawDesc.matchAll(/\[\[(.*?)\]\]/g)].map(m => m[1].split('|')[0].trim());
				const cleanDesc = rawDesc
					.replace(/(\s*[-*•]\s+(\[[ xX]\]\s+)?)?\[\[([^\]]+)\]\]\n?/g, '');
				setDescription(cleanDesc);

				const initialNotes = Array.from(new Set([...(event.linkedNotes || []), ...legacyMatches].filter(Boolean)));
				setLinkedNotes(initialNotes);
				setEventTodos(event.todos || []);
				setIsAddingEventTodo(false);
				setNewEventTodoInput('');
			} else {
				// Same event: only sync if user is not actively typing in the respective input
				const isTypingTitle = document.activeElement === titleInputRef.current;
				const isTypingDesc = document.activeElement === descTextareaRef.current;

				if (!isTypingTitle && event.title !== undefined && event.title !== title) {
					setTitle(event.title || '');
				}
				if (!isTypingDesc && event.description !== undefined && event.description !== description) {
					const rawDesc = event.description || '';
					const cleanDesc = rawDesc.replace(/(\s*[-*•]\s+(\[[ xX]\]\s+)?)?\[\[([^\]]+)\]\]\n?/g, '');
					setDescription(cleanDesc);
				}
				if (event.todos && event.todos !== eventTodos) {
					setEventTodos(event.todos);
				}
				if (event.linkedNotes && event.linkedNotes !== linkedNotes) {
					setLinkedNotes(event.linkedNotes);
				}
			}
		} else {
			currentEventIdRef.current = null;
			setTitle('');
			setDescription('');
			setLinkedNotes([]);
			setEventTodos([]);
			setIsAddingEventTodo(false);
			setNewEventTodoInput('');
		}
	}, [event?.id, event?.description, event?.linkedNotes, event?.title, event?.todos]);

	// Anticipate user typing: don't draw focus until they start typing
	useEffect(() => {
		if (!event) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			const active = document.activeElement;
			if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape' || e.key === 'Tab') {
				return;
			}

			// Single printable key or backspace starts typing in title
			if (e.key.length === 1 || e.key === 'Backspace') {
				if (titleInputRef.current) {
					titleInputRef.current.focus();
					const val = titleInputRef.current.value.trim().toLowerCase();
					if (val === 'event' || val === 'new event') {
						titleInputRef.current.select();
					} else {
						const len = titleInputRef.current.value.length;
						titleInputRef.current.setSelectionRange(len, len);
					}
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [event?.id]);

	useEffect(() => {
		if (openDropdown === 'none') return;
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.time-picker-wrapper') && !target.closest('.date-display-wrapper') && !target.closest('.color-picker-wrapper') && !target.closest('.event-option-row')) {
				setOpenDropdown('none');
			}
		};
		// Capture phase so any click in Obsidian dismisses the dropdown, even if a
		// deeper handler stops propagation.
		window.addEventListener('pointerdown', handleClickOutside, true);
		return () => window.removeEventListener('pointerdown', handleClickOutside, true);
	}, [openDropdown]);

	// Close the profile attach picker (under the title) when clicking outside it.
	// Profile creation/management lives in the default right pane, not here.
	useEffect(() => {
		if (!profilePickerOpen) return;
		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.profile-picker-wrapper')) setProfilePickerOpen(false);
		};
		// Capture phase: a click anywhere else in Obsidian must dismiss the menu
		// even when an inner handler calls stopPropagation() on the same gesture.
		window.addEventListener('pointerdown', handlePointerDown, true);
		return () => window.removeEventListener('pointerdown', handlePointerDown, true);
	}, [profilePickerOpen]);

	useEffect(() => {
		try {
			if (openDropdown === 'start' && startTimeListRef.current) {
				const container = startTimeListRef.current;
				const activeEl = container.querySelector('.selected') as HTMLElement;
				if (activeEl) {
					container.scrollTop = Math.max(0, activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2);
				}
			} else if (openDropdown === 'end' && endTimeListRef.current) {
				const container = endTimeListRef.current;
				const activeEl = container.querySelector('.selected') as HTMLElement;
				if (activeEl) {
					container.scrollTop = Math.max(0, activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2);
				}
			}
		} catch (err) { }
	}, [openDropdown]);

	// --- Location search (free OpenStreetMap/Photon autocomplete, no API key) ---
	useEffect(() => {
		if (!isEditingLocation) return;
		const q = locationInput.trim();
		if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
		if (q.length < 3) {
			setLocationSuggestions([]);
			setIsLoadingLocation(false);
			return;
		}
		setIsLoadingLocation(true);
		const requestId = ++locationRequestIdRef.current;
		locationDebounceRef.current = setTimeout(async () => {
			const results = await searchAddresses(q);
			if (requestId !== locationRequestIdRef.current) return;
			setLocationSuggestions(results);
			setLocationSelectedIdx(0);
			setIsLoadingLocation(false);
		}, 350);
		return () => {
			if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
		};
	}, [locationInput, isEditingLocation]);

	// Close the location editor when clicking outside of its row.
	useEffect(() => {
		if (!isEditingLocation) return;
		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.location-detail-row')) {
				setIsEditingLocation(false);
				setLocationSuggestions([]);
			}
		};
		window.addEventListener('pointerdown', handlePointerDown);
		return () => window.removeEventListener('pointerdown', handlePointerDown);
	}, [isEditingLocation]);

	// Focus the location input (cursor at end) when the editor opens.
	useEffect(() => {
		if (!isEditingLocation) return;
		const id = setTimeout(() => {
			const el = locationInputRef.current;
			if (el) {
				el.focus();
				const len = el.value.length;
				el.setSelectionRange(len, len);
			}
		}, 0);
		return () => clearTimeout(id);
	}, [isEditingLocation]);

	const applyLocation = (value: string) => {
		if (!event) return;
		const trimmed = (value || '').trim();
		onUpdate({ ...event, location: trimmed || undefined });
		setIsEditingLocation(false);
		setLocationSuggestions([]);
		setLocationInput('');
	};

	const openLocationEditor = () => {
		if (!event) return;
		setLocationInput(event.location || '');
		setLocationSuggestions([]);
		setIsEditingLocation(true);
	};

	const closeLocationEditor = () => {
		setIsEditingLocation(false);
		setLocationSuggestions([]);
	};

	const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();
		if (e.key === 'ArrowDown' && locationSuggestions.length > 0) {
			e.preventDefault();
			setLocationSelectedIdx(i => (i + 1) % locationSuggestions.length);
		} else if (e.key === 'ArrowUp' && locationSuggestions.length > 0) {
			e.preventDefault();
			setLocationSelectedIdx(i => (i - 1 + locationSuggestions.length) % locationSuggestions.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const selected = locationSuggestions[locationSelectedIdx];
			if (selected) {
				applyLocation(selected.label);
			} else if (locationInput.trim()) {
				applyLocation(locationInput);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeLocationEditor();
		}
	};

	if (!event) {
		const monthStart = startOfMonth(miniCalendarMonth);
		const monthEnd = endOfMonth(monthStart);
		const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
		const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
		const dateFormat = "d";
		const days = eachDayOfInterval({ start: startDate, end: endDate });

		const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

		return (
			<div className="sleek-right-pane empty-pane">
				<div className="mini-calendar">
					<div className="mini-calendar-header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-normal)' }}>
							{format(miniCalendarMonth, 'MMMM yyyy')}
						</div>
						<div className="window-actions" style={{ display: 'flex', gap: '4px' }}>
							<button onClick={() => setMiniCalendarMonth(subMonths(miniCalendarMonth, 1))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>&lt;</button>
							<button onClick={() => setMiniCalendarMonth(addMonths(miniCalendarMonth, 1))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>&gt;</button>
						</div>
					</div>

					<div className="mini-calendar-grid">
						<div className="mini-calendar-weekdays">
							{weekDays.map(day => <div key={day} className="weekday">{day}</div>)}
						</div>
						<div className="mini-calendar-days">
							{days.map((day, i) => {
								const isToday = isSameDay(day, nowInTz);
								const isCurrentMonth = isSameMonth(day, monthStart);
								const hasEvent = eventOccursOnDay(events, day);
								return (
									<div
										key={i}
										className={`mini-day ${!isCurrentMonth ? 'dimmed' : ''} ${isToday ? 'today' : ''}`}
										onClick={() => onDateSelect && onDateSelect(day)}
										style={{ cursor: 'pointer', position: 'relative' }}
									>
										{format(day, dateFormat)}
										{hasEvent && (
											<span
												aria-hidden="true"
												style={{
													position: 'absolute',
													bottom: '1px',
													left: '50%',
													transform: 'translateX(-50%)',
													width: '4px',
													height: '4px',
													borderRadius: '50%',
													background: randomEventDotColor(day),
													pointerEvents: 'none'
												}}
											/>
										)}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// --- Calendar profile helpers ---
	const calendarProfiles: CalendarProfile[] = React.useMemo(
		() => (Array.isArray(plugin?.settings?.calendarProfiles) ? plugin!.settings.calendarProfiles : []),
		[plugin]
	);

	const profileHex = (profile?: CalendarProfile | null): string =>
		resolveAccentHex(profile?.color) || DEFAULT_ACCENT_HEX;

	const activeProfile = calendarProfiles.find(p => p.id === event.profileId) || null;

	// Assigning a profile also tints the tile with that profile's color so the
	// association is visible on the grid. Clicking the active swatch again
	// clears the association (the color already picked is left untouched).
	const assignProfile = (profile: CalendarProfile) => {
		if (!event) return;
		const isActive = event.profileId === profile.id;
		onUpdate({
			...event,
			profileId: isActive ? undefined : profile.id,
			colorTheme: isActive ? event.colorTheme : profile.color
		});
	};

	// Detach whichever profile the event carries — the explicit "None" entry in
	// the picker. The tile's own color is deliberately left untouched.
	const clearProfile = () => {
		if (!event || !event.profileId) return;
		onUpdate({ ...event, profileId: undefined });
	};

	useEffect(() => {
		if (titleInputRef.current) {
			titleInputRef.current.style.height = 'auto';
			titleInputRef.current.style.height = `${Math.max(titleInputRef.current.scrollHeight, 38)}px`;
		}
	}, [title]);

	const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setTitle(e.target.value);
		e.target.style.height = 'auto';
		e.target.style.height = `${Math.max(e.target.scrollHeight, 38)}px`;
		onUpdate({ ...event, title: e.target.value });
	};

	// A brand-new event is titled "Event" so its tile never renders blank, but that
	// stand-in is in the way the instant the user goes to rename it. Clear it on focus
	// so whatever they type from there is the real title. Compared with a regex rather
	// than `.trim()` so nothing rewrites the value while typing. The field also carries
	// no placeholder: the only text ever seen in it is a title the user can actually
	// keep, so a dim hint can never be mistaken for a default that has to be deleted.
	const handleTitleFocus = () => {
		if (!event) return;
		if (/^\s*(event|new event)\s*$/i.test(title || '')) {
			setTitle('');
			if (titleInputRef.current) titleInputRef.current.style.height = 'auto';
			onUpdate({ ...event, title: '' });
		}
	};

	// Erasing the title outright would leave a nameless event, so the "Event" stand-in
	// comes back the moment the field is left — the same default a new event is born
	// with. It is checked from the field's own blur and from a capture-phase
	// pointerdown on the document, because clicking a spot that cannot take focus (the
	// grid background) never blurs the textarea — without that second path an erased
	// title would simply sit there blank. Nothing here runs on change, so it can never
	// fight the user mid-edit, and the emptiness test is a regex, not a `.trim()`.
	const restoreTitleIfEmpty = () => {
		if (!event) return;
		const el = titleInputRef.current;
		if (!/^\s*$/.test(el ? el.value : title)) return;
		setTitle('Event');
		if (el) {
			el.style.height = 'auto';
			el.style.height = `${Math.max(el.scrollHeight, 38)}px`;
		}
		onUpdate({ ...event, title: 'Event' });
	};

	const handleTitleBlur = () => restoreTitleIfEmpty();

	// The listener exists only while the title is empty: the first press anywhere other
	// than inside the field is the user leaving it, so the stand-in goes back then.
	useEffect(() => {
		if (!event || !/^\s*$/.test(title)) return;
		const onPointerDown = (e: PointerEvent) => {
			const el = titleInputRef.current;
			if (!el || e.target === el) return;
			restoreTitleIfEmpty();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, [event, title]);

	const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newDesc = e.target.value;
		setDescription(newDesc);
		if (event) {
			onUpdate({ ...event, description: newDesc, linkedNotes, todos: eventTodos });
		}
	};

	const handleOpenNote = (noteTitle: string) => {
		if (plugin?.app?.workspace) {
			plugin.app.workspace.openLinkText(noteTitle, '', false);
		}
	};

	const handleRemoveNote = (noteTitle: string) => {
		if (!event) return;
		const updatedNotes = linkedNotes.filter(n => n !== noteTitle);
		setLinkedNotes(updatedNotes);
		onUpdate({ ...event, description, linkedNotes: updatedNotes, todos: eventTodos });
	};

	// --- Creating a note from the event -----------------------------------------
	// The one place in the plugin that writes to the vault at all, and it only ever
	// *creates*: a brand-new file in the plugin's own folder, named with the date and
	// the event tile's title. No existing note is opened, edited or appended to, and the
	// note text lives only in the popup until the moment the file is written.
	const plannerNoteName = buildPlannerNoteName(new Date(), title || event?.title || 'Event');

	const handleCreatePlannerNote = async (noteBody: string) => {
		const file = await createPlannerNote(plugin?.app, { name: plannerNoteName, body: noteBody });
		setIsComposingNote(false);
		if (file) {
			new Notice(`Note created: ${file.path}`);
		} else {
			new Notice('Could not create the note — check the vault folder.');
		}
	};

	const handleAttachmentDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsAttachmentDragOver(false);
		if (!event) return;

		// Check if this is an internal todo being dropped (not a note)
		const todoData = e.dataTransfer.getData('application/x-obsidian-calendar-todo');
		if (todoData) {
			try {
				const parsed = JSON.parse(todoData);
				if (parsed && parsed.type === 'todo' && parsed.title) {
					const todoTitle = String(parsed.title).trim();
					const alreadyExists = eventTodos.some(t => t.title.toLowerCase() === todoTitle.toLowerCase());
					if (!alreadyExists) {
						const newTodo: EventTodo = {
							id: Math.random().toString(36).substring(7),
							title: todoTitle,
							completed: !!parsed.completed
						};
						const updated = [...eventTodos, newTodo];
						setEventTodos(updated);
						onUpdate({ ...event, todos: updated, linkedNotes });
					}
					return;
				}
			} catch (err) { }
		}

		// Otherwise treat as a note attachment
		const doc = extractObsidianDoc(e.dataTransfer);
		if (doc) {
			const updatedNotes = Array.from(new Set([...linkedNotes, doc.title]));
			setLinkedNotes(updatedNotes);
			onUpdate({ ...event, description, linkedNotes: updatedNotes, todos: eventTodos });
		}
	};

	const handleAttachNote = (note: { basename: string, path: string }) => {
		if (!event) return;
		isSelectingNoteRef.current = true;
		const updatedNotes = Array.from(new Set([...linkedNotes, note.basename]));
		setLinkedNotes(updatedNotes);
		onUpdate({ ...event, description, linkedNotes: updatedNotes, todos: eventTodos });
		setNoteSearchInput('');
		setIsLinkingNote(false);
		setNoteSelectedIdx(0);
		setTimeout(() => {
			isSelectingNoteRef.current = false;
		}, 250);
	};

	const handleSelectTitleNote = (note: { basename: string, path: string }) => {
		if (!event) return;
		isSelectingTitleRef.current = true;
		const before = title.substring(0, titleLastAt).trim();
		const newTitle = before ? `${before} ${note.basename}` : note.basename;
		setTitle(newTitle);
		const updatedNotes = Array.from(new Set([...linkedNotes, note.basename]));
		setLinkedNotes(updatedNotes);
		onUpdate({ ...event, title: newTitle, description, linkedNotes: updatedNotes, todos: eventTodos });
		setTitleSelectedIdx(0);
		setTimeout(() => {
			isSelectingTitleRef.current = false;
		}, 250);
	};

	const handleSelectDescNote = (note: { basename: string, path: string }) => {
		if (!event) return;
		isSelectingDescRef.current = true;
		const before = description.substring(0, descLastAt);
		const newDesc = `${before}${note.basename} `;
		setDescription(newDesc);
		onUpdate({ ...event, description: newDesc, linkedNotes, todos: eventTodos });
		setDescSelectedIdx(0);
		setTimeout(() => {
			isSelectingDescRef.current = false;
		}, 250);
	};

	// --- All-day / time zone / repeat handlers ---
	const handleToggleAllDay = () => {
		if (!event) return;
		if (!event.isAllDay) {
			const start = new Date(event.startTime);
			start.setHours(0, 0, 0, 0);
			const end = new Date(start);
			end.setDate(end.getDate() + 1);
			onUpdate({ ...event, isAllDay: true, startTime: start, endTime: end });
		} else {
			const start = new Date(event.startTime);
			start.setHours(9, 0, 0, 0);
			const end = new Date(start);
			end.setHours(10, 0, 0, 0);
			onUpdate({ ...event, isAllDay: false, startTime: start, endTime: end });
		}
	};

	const handleSelectTimeZone = (tz: string) => {
		if (!event) return;
		// Move the event into the chosen zone by shifting it by the offset delta,
		// so its tile lands at the matching time on the local calendar.
		const oldZone = resolveTimeZone(event.timeZone || timeZone);
		const newZone = resolveTimeZone(tz);
		const deltaMin = getTimeZoneOffsetMinutes(newZone, event.startTime) - getTimeZoneOffsetMinutes(oldZone, event.startTime);
		const deltaMs = deltaMin * 60000;
		onUpdate({
			...event,
			timeZone: tz,
			startTime: deltaMs ? new Date(event.startTime.getTime() + deltaMs) : event.startTime,
			endTime: deltaMs ? new Date(event.endTime.getTime() + deltaMs) : event.endTime
		});
		setOpenDropdown('none');
	};

	const handleSelectRepeat = (value: string) => {
		if (!event) return;
		if (value === 'custom') {
			setOpenDropdown('none');
			setShowCustomRepeat(true);
			return;
		}
		onUpdate({ ...event, repeat: value });
		setOpenDropdown('none');
	};

	const handleCustomRepeatDone = (value: CustomRepeat) => {
		if (!event) return;
		onUpdate({ ...event, repeat: 'custom', repeatCustom: value });
		setShowCustomRepeat(false);
	};

	// --- Event To-Do handlers ---
	const handleToggleEventTodo = (todoId: string) => {
		if (!event) return;
		const targetTodo = eventTodos.find(t => t.id === todoId);
		const isCompleting = targetTodo && !targetTodo.completed;

		const updated = eventTodos.map(t => t.id === todoId ? { ...t, completed: !t.completed } : t);

		if (isCompleting) {
			// Save in place immediately without sorting
			setEventTodos(updated);
			onUpdate({ ...event, todos: updated, linkedNotes });

			setRecentlyCompleted(prev => {
				const next = new Set(prev);
				next.add(todoId);
				return next;
			});

			setTimeout(() => {
				setRecentlyCompleted(prev => {
					const next = new Set(prev);
					next.delete(todoId);
					return next;
				});

				setEventTodos(prevTodos => {
					const incomplete = prevTodos.filter(t => !t.completed);
					const completed = prevTodos.filter(t => t.completed);
					const sorted = [...incomplete, ...completed];

					if (latestEventRef.current) {
						onUpdate({ ...latestEventRef.current, todos: sorted });
					}
					return sorted;
				});
			}, 1000);
		} else {
			// If un-completing, sort immediately
			const incomplete = updated.filter(t => !t.completed);
			const completed = updated.filter(t => t.completed);
			const sorted = [...incomplete, ...completed];
			setEventTodos(sorted);
			onUpdate({ ...event, todos: sorted, linkedNotes });
		}
	};

	const handleDeleteEventTodo = (todoId: string) => {
		if (!event) return;
		const updated = eventTodos.filter(t => t.id !== todoId);
		setEventTodos(updated);
		onUpdate({ ...event, todos: updated, linkedNotes });
	};

	const handleClearCompletedEventTodos = () => {
		if (!event) return;
		const updated = eventTodos.filter(t => !t.completed);
		setEventTodos(updated);
		onUpdate({ ...event, todos: updated, linkedNotes });
	};

	const handleEditEventTodo = (todoId: string, newTitle: string) => {
		if (!event) return;
		const trimmed = newTitle.trim();
		if (!trimmed) {
			handleDeleteEventTodo(todoId);
			return;
		}
		const updated = eventTodos.map(t => t.id === todoId ? { ...t, title: trimmed } : t);
		setEventTodos(updated);
		onUpdate({ ...event, todos: updated, linkedNotes });
		// Reflect the rename on any timer tile created from this to-do.
		if (setTimers) {
			setTimers(prev => prev.map(t => (t.todoId === todoId && t.eventId === event.id) ? { ...t, title: trimmed } : t));
		}
	};

	const handleAddEventTodo = () => {
		if (!event) return;
		const text = newEventTodoInput.trim();
		if (!text) return;
		const newTodo: EventTodo = {
			id: Math.random().toString(36).substring(7),
			title: text,
			completed: false
		};
		const updated = [...eventTodos, newTodo];
		setEventTodos(updated);
		onUpdate({ ...event, todos: updated, linkedNotes });
		setNewEventTodoInput('');
	};

	// Calculate duration
	const effectiveEndForDuration = (event.endTime.getHours() === 23 && event.endTime.getMinutes() === 59)
		? new Date(event.endTime).setHours(24, 0, 0, 0)
		: event.endTime.getTime();
	const durationMins = differenceInMinutes(effectiveEndForDuration, event.startTime);
	const hours = Math.floor(durationMins / 60);
	const mins = durationMins % 60;
	const durationString = hours > 0 ? `${hours}h ${mins > 0 ? mins + 'min' : ''}` : `${mins}min`;
	const handleStartTimeSelect = (hour: number, minute: number) => {
		const newStart = new Date(event.startTime);
		newStart.setHours(hour, minute, 0, 0);

		const duration = Math.max(30 * 60 * 1000, event.endTime.getTime() - event.startTime.getTime());
		let newEnd = new Date(newStart.getTime() + duration);
		const dayEnd = new Date(newStart);
		dayEnd.setHours(23, 59, 0, 0);
		if (newEnd.getTime() > dayEnd.getTime()) {
			newEnd = dayEnd;
		}

		onUpdate({ ...event, startTime: newStart, endTime: newEnd });
		setOpenDropdown('none');
	};

	const handleEndTimeSelect = (hour: number, minute: number) => {
		const newEnd = new Date(event.startTime);
		newEnd.setHours(hour, minute, 0, 0);

		const dayEnd = new Date(event.startTime);
		dayEnd.setHours(23, 59, 0, 0);

		if (newEnd.getTime() > dayEnd.getTime()) {
			newEnd.setTime(dayEnd.getTime());
		}

		if (newEnd.getTime() <= event.startTime.getTime()) {
			newEnd.setTime(Math.min(dayEnd.getTime(), event.startTime.getTime() + 30 * 60 * 1000));
		}

		onUpdate({ ...event, endTime: newEnd });
		setOpenDropdown('none');
	};

	const handleDateSelect = (date: Date) => {
		const newStart = new Date(event.startTime);
		newStart.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());

		let newEnd = new Date(event.endTime);
		newEnd.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
		const dayEnd = new Date(newStart);
		dayEnd.setHours(23, 59, 0, 0);
		if (newEnd.getTime() > dayEnd.getTime()) {
			newEnd = dayEnd;
		}

		onUpdate({ ...event, startTime: newStart, endTime: newEnd });
		setOpenDropdown('none');
	};

	return (
		<div className="sleek-right-pane">
			{showCustomRepeat && createPortal(
				<CustomRepeatModal
					initial={event.repeatCustom || null}
					accentColor={accentColor}
					onCancel={() => setShowCustomRepeat(false)}
					onDone={handleCustomRepeatDone}
				/>,
				document.body
			)}
			{isComposingNote && createPortal(
				<NoteComposer
					noteName={plannerNoteName}
					folder={PLANNER_NOTES_FOLDER}
					accentColor={accentColor}
					onCancel={() => setIsComposingNote(false)}
					onCreate={handleCreatePlannerNote}
				/>,
				document.body
			)}
			<div className="pane-header">
				<button
					className="close-pane-btn"
					onClick={() => {
						if (onDelete && event?.id) {
							onDelete(event.id);
						} else {
							onClose();
						}
					}}
					title="Delete event"
					style={{
						marginLeft: 'auto',
						cursor: 'pointer',
						background: 'transparent',
						border: 'none',
						color: 'var(--text-muted)',
						padding: '4px',
						borderRadius: '4px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						transition: 'all 0.15s ease'
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.color = 'var(--text-error, #f87171)';
						e.currentTarget.style.background = 'var(--background-modifier-hover)';
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.color = 'var(--text-muted)';
						e.currentTarget.style.background = 'transparent';
					}}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						<line x1="10" y1="11" x2="10" y2="17"></line>
						<line x1="14" y1="11" x2="14" y2="17"></line>
					</svg>
				</button>
			</div>

			<div className="pane-content">
				<div className="pane-section title-section" style={{ position: 'relative' }}>
					<textarea
						ref={titleInputRef}
						className="pane-title-input"
						value={title}
						onChange={handleTitleChange}
						onFocus={handleTitleFocus}
						onBlur={handleTitleBlur}
						rows={1}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === 'ArrowDown' && showTitleSuggestions && titleSuggestions.length > 0) {
								e.preventDefault();
								setTitleSelectedIdx(prev => (prev + 1) % titleSuggestions.length);
							} else if (e.key === 'ArrowUp' && showTitleSuggestions && titleSuggestions.length > 0) {
								e.preventDefault();
								setTitleSelectedIdx(prev => (prev - 1 + titleSuggestions.length) % titleSuggestions.length);
							} else if (e.key === 'Enter') {
								e.preventDefault();
								if (showTitleSuggestions && titleSuggestions.length > 0) {
									const sel = titleSuggestions[titleSelectedIdx] || titleSuggestions[0];
									handleSelectTitleNote(sel);
								} else {
									e.currentTarget.blur();
								}
							} else if (e.key === 'Escape' && showTitleSuggestions) {
								setTitle(prev => prev.substring(0, titleLastAt));
							}
						}}
					/>
					{showTitleSuggestions && titleSuggestions.length > 0 && (
						<div className="note-mention-popover">
							<div className="note-mention-header">Vault Notes</div>
							{titleSuggestions.map((note, idx) => (
								<div
									key={note.path}
									className={`note-mention-item ${idx === titleSelectedIdx ? 'is-selected' : ''}`}
									onMouseDown={(e) => {
										e.preventDefault();
										isSelectingTitleRef.current = true;
										handleSelectTitleNote(note);
										setTimeout(() => { isSelectingTitleRef.current = false; }, 200);
									}}
									onMouseEnter={() => setTitleSelectedIdx(idx)}
								>
									<svg className="note-mention-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
										<polyline points="14 2 14 8 20 8"></polyline>
										<line x1="16" y1="13" x2="8" y2="13"></line>
										<line x1="16" y1="17" x2="8" y2="17"></line>
										<polyline points="10 9 9 9 8 9"></polyline>
									</svg>
									<div className="note-mention-info">
										<span className="note-mention-title">{note.basename}</span>
										{note.path !== `${note.basename}.md` && (
											<span className="note-mention-path">{note.path}</span>
										)}
									</div>
								</div>
							))}
						</div>
					)}
					{/* Profile row, tucked under the title: the swatch sits immediately to the
					    left of the attached profile's name. It starts as an empty "+" and,
					    once a profile is attached, the button *becomes* that profile's
					    swatch. Only ever one profile — picking another just recolours it.
					    The whole row stays hidden until at least one profile exists. */}
					{calendarProfiles.length > 0 && (
						<div className="title-profile-row">
							<div className="profile-picker-wrapper">
								<button
									type="button"
									className={`profile-title-btn ${activeProfile ? 'is-assigned' : ''} ${profilePickerOpen ? 'is-open' : ''}`}
									style={activeProfile ? { background: profileHex(activeProfile) } : undefined}
									title={activeProfile ? `Select calendar — ${activeProfile.name}` : 'Select calendar'}
									onClick={() => setProfilePickerOpen(prev => !prev)}
								>
									{/* Never a glyph once a profile is attached — the button is purely
									    the colour indicator of the associated profile. */}
									{!activeProfile && <span className="profile-title-plus">+</span>}
								</button>
								{profilePickerOpen && (
									<div className="sleek-menu profile-picker-popover" onClick={(e) => e.stopPropagation()}>
										{calendarProfiles.map(p => {
											const isActive = event.profileId === p.id;
											return (
												<div
													key={p.id}
													className="profile-picker-item"
													title={isActive ? `${p.name} — click to remove` : `${p.name} — click to attach`}
													onClick={() => {
														assignProfile(p);
														setProfilePickerOpen(false);
													}}
												>
													<div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
														<span className="profile-menu-dot" style={{ background: profileHex(p), borderRadius: '4px' }} />
														<span className="profile-menu-name">{p.name}</span>
													</div>
													{isActive && (
														<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
															<polyline points="20 6 9 17 4 12"></polyline>
														</svg>
													)}
												</div>
											);
										})}
										<div className="sleek-menu-divider" />
										{/* Explicit "None" so the association can be dropped from the
										    menu itself instead of only by re-clicking the swatch. */}
										<div
											className="profile-picker-item"
											title="Remove the calendar profile from this event"
											onClick={() => {
												clearProfile();
												setProfilePickerOpen(false);
											}}
										>
											<div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
												<span className="profile-menu-dot profile-menu-dot--none" />
												<span className="profile-menu-name">None</span>
											</div>
											{!activeProfile && (
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
													<polyline points="20 6 9 17 4 12"></polyline>
												</svg>
											)}
										</div>
									</div>
								)}
							</div>
							{/* The placeholder is deliberately near-invisible until a profile is
							    attached; only a real profile name gets the normal treatment. */}
							<span className={`title-profile-hint ${activeProfile ? '' : 'is-empty'}`}>
								{activeProfile ? activeProfile.name : 'Add profile'}
							</span>
						</div>
					)}
				</div>

				<div className="pane-section time-section">
					<div className="time-row">
						<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
						<div className="time-details">
							{!event.isAllDay && (
								<div className="time-range-display" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									<div className="time-picker-wrapper" style={{ position: 'relative' }}>
										<button
											type="button"
											className={`sleek-time-btn ${openDropdown === 'start' ? 'active' : ''}`}
											onClick={() => setOpenDropdown(prev => prev === 'start' ? 'none' : 'start')}
										>
											{format(event.startTime, 'h:mm a')}
										</button>
										{openDropdown === 'start' && (
											<div ref={startTimeListRef} className="sleek-time-dropdown-menu">
												{ALL_TIME_SLOTS.map(slot => {
													const isSelected = slot.hour === event.startTime.getHours() && slot.min === event.startTime.getMinutes();
													const slotDate = new Date(event.startTime);
													slotDate.setHours(slot.hour, slot.min, 0, 0);
													return (
														<div
															key={`${slot.hour}-${slot.min}`}
															className={`sleek-time-dropdown-item ${isSelected ? 'selected' : ''}`}
															onClick={() => handleStartTimeSelect(slot.hour, slot.min)}
														>
															<span>{format(slotDate, 'h:mm a')}</span>
														</div>
													);
												})}
											</div>
										)}
									</div>

									<span className="time-arrow" style={{ opacity: 0.5 }}>→</span>

									<div className="time-picker-wrapper" style={{ position: 'relative' }}>
										<button
											type="button"
											className={`sleek-time-btn ${openDropdown === 'end' ? 'active' : ''}`}
											onClick={() => setOpenDropdown(prev => prev === 'end' ? 'none' : 'end')}
										>
											{format(
												(event.endTime.getHours() === 0 && event.endTime.getMinutes() === 0 && event.endTime.getDate() !== event.startTime.getDate()) ||
													(event.endTime.getTime() > new Date(event.startTime).setHours(23, 59, 0, 0))
													? new Date(new Date(event.startTime).setHours(23, 59, 0, 0))
													: event.endTime,
												'h:mm a'
											)}
										</button>
										{openDropdown === 'end' && (
											<div ref={endTimeListRef} className="sleek-time-dropdown-menu end-time-menu">
												{ALL_END_TIME_SLOTS.map(slot => {
													const isSelected = (slot.hour === event.endTime.getHours() && slot.min === event.endTime.getMinutes()) ||
														(slot.hour === 23 && slot.min === 59 && (
															(event.endTime.getHours() === 23 && event.endTime.getMinutes() === 59) ||
															(event.endTime.getHours() === 0 && event.endTime.getMinutes() === 0 && event.endTime.getDate() !== event.startTime.getDate()) ||
															(event.endTime.getTime() >= new Date(event.startTime).setHours(23, 59, 0, 0))
														));
													const slotDate = new Date(event.startTime);
													slotDate.setHours(slot.hour, slot.min, 0, 0);

													let diff = differenceInMinutes(slotDate, event.startTime);
													if (slot.hour === 23 && slot.min === 59) {
														const dayEndMs = new Date(event.startTime).setHours(24, 0, 0, 0);
														diff = differenceInMinutes(dayEndMs, event.startTime);
													}
													let durLabel = '';
													if (diff > 0) {
														const dh = Math.floor(diff / 60);
														const dm = diff % 60;
														durLabel = dh > 0 ? `${dh}h${dm > 0 ? ` ${dm}m` : ''}` : `${dm}m`;
													}

													return (
														<div
															key={`${slot.hour}-${slot.min}`}
															className={`sleek-time-dropdown-item ${isSelected ? 'selected' : ''}`}
															onClick={() => handleEndTimeSelect(slot.hour, slot.min)}
														>
															<span>{format(slotDate, 'h:mm a')}</span>
															{durLabel && (
																<span style={{ fontSize: '11px', opacity: 0.5, marginLeft: '8px' }}>
																	{durLabel}
																</span>
															)}
														</div>
													);
												})}
											</div>
										)}
									</div>

									<span className="time-duration" style={{ opacity: 0.5, fontSize: '13px' }}>{durationString}</span>
								</div>
							)}

							{event.isAllDay && (
								<div className="time-range-display" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									<span className="time-duration" style={{ fontSize: '13px' }}>All day</span>
								</div>
							)}

							<div className="date-display-wrapper" style={{ position: 'relative' }}>
								<div
									className={`date-display ${openDropdown === 'date' ? 'active' : ''}`}
									onClick={() => setOpenDropdown(prev => prev === 'date' ? 'none' : 'date')}
									style={{ display: 'flex', alignItems: 'center', gap: '8px', width: 'fit-content', marginTop: '8px' }}
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
									{format(event.startTime, 'MMM d, yyyy')}
								</div>
								{openDropdown === 'date' && (
									<div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100 }}>
										<InlineMiniCalendar currentDate={event.startTime} onSelect={handleDateSelect} accentColor={accentColor} timeZone={timeZone} events={events} />
									</div>
								)}
							</div>

						</div>
					</div>

					<div className="event-options-stack">
						{/* All-day */}
						<div className="event-option-row" onClick={handleToggleAllDay} title="Toggle all-day">
							<button
								type="button"
								className={`sleek-switch ${event.isAllDay ? 'is-on' : ''}`}
								aria-pressed={!!event.isAllDay}
								aria-label="All-day"
								onClick={(e) => {
									e.stopPropagation();
									handleToggleAllDay();
								}}
								style={{
									border: 'none',
									padding: 0,
									// Deliberately neutral, never the accent: the switch is a plain on/off state.
									background: event.isAllDay ? 'var(--text-muted)' : 'var(--background-modifier-border)'
								}}
							>
								<span className="sleek-switch-knob" />
							</button>
							<span className="event-option-label">All-day</span>
						</div>

						{/* Time zone */}
						<div
							className="event-option-row"
							onClick={() => setOpenDropdown(prev => prev === 'timezone' ? 'none' : 'timezone')}
						>
							<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
							<span className="event-option-label">{getTimeZoneDisplayLabel(event.timeZone || timeZone || AUTO_TIME_ZONE)}</span>
							<svg className="event-option-trailing" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
							{openDropdown === 'timezone' && (
								<div className="event-option-dropdown" onClick={(e) => e.stopPropagation()}>
									{TIME_ZONE_OPTIONS.map(tz => (
										<div
											key={tz.value}
											className={`event-option-dropdown-item ${(event.timeZone || AUTO_TIME_ZONE) === tz.value ? 'is-selected' : ''}`}
											onClick={() => handleSelectTimeZone(tz.value)}
										>
											{tz.label}
										</div>
									))}
								</div>
							)}
						</div>

						{/* Repeat */}
						<div
							className="event-option-row"
							onClick={() => setOpenDropdown(prev => prev === 'repeat' ? 'none' : 'repeat')}
						>
							<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
							<span className="event-option-label">
								{event.repeat === 'custom'
									? describeCustomRepeat(event.repeatCustom)
									: (REPEAT_OPTIONS.find(o => o.value === (event.repeat || 'none'))?.label || 'Repeat')}
							</span>
							{openDropdown === 'repeat' && (
								<div className="event-option-dropdown" onClick={(e) => e.stopPropagation()}>
									{REPEAT_OPTIONS.map(opt => (
										<div
											key={opt.value}
											className={`event-option-dropdown-item ${(event.repeat || 'none') === opt.value ? 'is-selected' : ''}`}
											onClick={() => handleSelectRepeat(opt.value)}
										>
											<span>{opt.label}</span>{repeatDetail(opt.value, event.startTime) && <span className="event-option-dropdown-detail">{repeatDetail(opt.value, event.startTime)}</span>}
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>

				<div className="pane-section text-section" style={{ position: 'relative' }}>
					<textarea
						ref={descTextareaRef}
						className="description-textarea"
						placeholder="Description"
						value={description}
						onChange={handleDescriptionChange}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === 'ArrowDown' && showDescSuggestions && descSuggestions.length > 0) {
								e.preventDefault();
								setDescSelectedIdx(prev => (prev + 1) % descSuggestions.length);
							} else if (e.key === 'ArrowUp' && showDescSuggestions && descSuggestions.length > 0) {
								e.preventDefault();
								setDescSelectedIdx(prev => (prev - 1 + descSuggestions.length) % descSuggestions.length);
							} else if (e.key === 'Enter' && showDescSuggestions && descSuggestions.length > 0) {
								e.preventDefault();
								const sel = descSuggestions[descSelectedIdx] || descSuggestions[0];
								handleSelectDescNote(sel);
							} else if (e.key === 'Escape' && showDescSuggestions) {
								setDescription(prev => prev.substring(0, descLastAt));
							}
						}}
					/>
					{showDescSuggestions && descSuggestions.length > 0 && (
						<div className="note-mention-popover" style={{ bottom: 'calc(100% - 10px)', top: 'auto', marginBottom: '4px' }}>
							<div className="note-mention-header">Vault Notes</div>
							{descSuggestions.map((note, idx) => (
								<div
									key={note.path}
									className={`note-mention-item ${idx === descSelectedIdx ? 'is-selected' : ''}`}
									onMouseDown={(e) => {
										e.preventDefault();
										isSelectingDescRef.current = true;
										handleSelectDescNote(note);
										setTimeout(() => { isSelectingDescRef.current = false; }, 200);
									}}
									onMouseEnter={() => setDescSelectedIdx(idx)}
								>
									<svg className="note-mention-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
										<polyline points="14 2 14 8 20 8"></polyline>
										<line x1="16" y1="13" x2="8" y2="13"></line>
										<line x1="16" y1="17" x2="8" y2="17"></line>
										<polyline points="10 9 9 9 8 9"></polyline>
									</svg>
									<div className="note-mention-info">
										<span className="note-mention-title">{note.basename}</span>
										{note.path !== `${note.basename}.md` && (
											<span className="note-mention-path">{note.path}</span>
										)}
									</div>
								</div>
							))}
						</div>
					)}

				</div>

				<div className="pane-section details-section">
					<div className="detail-row">
						<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
						<span>Conferencing</span>
					</div>
					<div className="detail-row location-detail-row" style={{ position: 'relative' }} onClick={isEditingLocation ? undefined : openLocationEditor}>
						<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
						{isEditingLocation ? (
							<div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
								<input
									ref={locationInputRef}
									type="text"
									placeholder="Search an address or paste a link"
									value={locationInput}
									onChange={(e) => setLocationInput(e.target.value)}
									onKeyDown={handleLocationKeyDown}
									onClick={(e) => e.stopPropagation()}
									style={{
										width: '100%',
										fontSize: '13px',
										color: 'var(--text-normal)',
										background: 'transparent',
										border: 'none',
										outline: 'none',
										boxShadow: 'none',
										padding: '4px 0'
									}}
								/>
								{(locationSuggestions.length > 0 || isLoadingLocation) && (
									<div className="note-mention-popover" style={{ top: 'calc(100% + 6px)' }}>
										{locationSuggestions.length === 0 ? (
											<div className="note-mention-header">Searching…</div>
										) : (
											<>
												<div className="note-mention-header">Addresses</div>
												{locationSuggestions.map((s, idx) => (
													<div
														key={`${s.label}-${idx}`}
														className={`note-mention-item ${idx === locationSelectedIdx ? 'is-selected' : ''}`}
														onMouseDown={(e) => {
															e.preventDefault();
															applyLocation(s.label);
														}}
														onMouseEnter={() => setLocationSelectedIdx(idx)}
													>
														<svg className="note-mention-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
															<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
															<circle cx="12" cy="10" r="3"></circle>
														</svg>
														<div className="note-mention-info">
															<span className="note-mention-title">{s.label}</span>
														</div>
													</div>
												))}
											</>
										)}
									</div>
								)}
							</div>
						) : event.location ? (
							<>
								<a
									href={buildGoogleMapsUrl(event.location as string)}
									target="_blank"
									rel="noopener noreferrer"
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										window.open(buildGoogleMapsUrl(event.location as string), '_blank');
									}}
									className="location-link"
									title={event.location}
								>
									{event.location}
								</a>
								<span
									onClick={(e) => {
										e.stopPropagation();
										openLocationEditor();
									}}
									title="Edit location"
									style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
								</span>
								<span
									onClick={(e) => {
										e.stopPropagation();
										applyLocation('');
									}}
									title="Remove location"
									style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
								</span>
							</>
						) : (
							<span style={{ flex: 1 }}>Location</span>
						)}
					</div>
				</div>

				<div
					className={`pane-section attachment-section ${isAttachmentDragOver ? 'attachment-drag-over' : ''}`}
					onDragOver={(e) => {
						e.preventDefault();
						e.stopPropagation();
						e.dataTransfer.dropEffect = 'copy';
						if (!isAttachmentDragOver) setIsAttachmentDragOver(true);
					}}
					onDragLeave={(e) => {
						e.preventDefault();
						e.stopPropagation();
						if (!e.currentTarget.contains(e.relatedTarget as Node)) {
							setIsAttachmentDragOver(false);
						}
					}}
					onDrop={handleAttachmentDrop}
				>
					{isLinkingNote ? (
						<div style={{ position: 'relative', width: '100%', marginBottom: linkedNotes.length > 0 ? '8px' : '0' }}>
							<input
								type="text"
								autoFocus
								placeholder="Search note or type @..."
								value={noteSearchInput}
								onChange={(e) => setNoteSearchInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'ArrowDown' && noteSuggestions.length > 0) {
										e.preventDefault();
										setNoteSelectedIdx(prev => (prev + 1) % noteSuggestions.length);
									} else if (e.key === 'ArrowUp' && noteSuggestions.length > 0) {
										e.preventDefault();
										setNoteSelectedIdx(prev => (prev - 1 + noteSuggestions.length) % noteSuggestions.length);
									} else if (e.key === 'Enter') {
										e.preventDefault();
										if (noteSuggestions.length > 0) {
											handleAttachNote(noteSuggestions[noteSelectedIdx] || noteSuggestions[0]);
										}
									} else if (e.key === 'Escape') {
										setNoteSearchInput('');
										setIsLinkingNote(false);
									}
								}}
								onBlur={() => {
									setTimeout(() => {
										if (!isSelectingNoteRef.current) {
											setIsLinkingNote(false);
											setNoteSearchInput('');
										}
									}, 150);
								}}
								style={{
									width: '100%',
									fontSize: '12px',
									padding: '5px 8px',
									borderRadius: '5px',
									background: 'var(--background-modifier-form-field)',
									border: '1px solid var(--background-modifier-border)',
									outline: 'none',
									boxShadow: 'none',
									color: 'var(--text-normal)',
									boxSizing: 'border-box'
								}}
							/>
							{noteSuggestions.length > 0 && (
								<div className="note-mention-popover">
									<div className="note-mention-header">Vault Notes</div>
									{noteSuggestions.map((note, idx) => (
										<div
											key={note.path}
											className={`note-mention-item ${idx === noteSelectedIdx ? 'is-selected' : ''}`}
											onMouseDown={(e) => {
												e.preventDefault();
												isSelectingNoteRef.current = true;
												handleAttachNote(note);
												setTimeout(() => { isSelectingNoteRef.current = false; }, 200);
											}}
											onMouseEnter={() => setNoteSelectedIdx(idx)}
										>
											<svg className="note-mention-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
												<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
												<polyline points="14 2 14 8 20 8"></polyline>
												<line x1="16" y1="13" x2="8" y2="13"></line>
												<line x1="16" y1="17" x2="8" y2="17"></line>
												<polyline points="10 9 9 9 8 9"></polyline>
											</svg>
											<div className="note-mention-info">
												<span className="note-mention-title">{note.basename}</span>
												{note.path !== `${note.basename}.md` && (
													<span className="note-mention-path">{note.path}</span>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<div className="attachment-actions" style={{ marginBottom: linkedNotes.length > 0 ? '8px' : '0' }}>
							<button
								type="button"
								onClick={() => setIsLinkingNote(true)}
								style={NOTE_ACTION_BTN_STYLE}
								onMouseEnter={noteActionHoverIn}
								onMouseLeave={noteActionHoverOut}
							>
								<span style={{ fontSize: '13px', lineHeight: 1 }}>+</span>
								<span>Link note (@)</span>
							</button>
							<button
								type="button"
								onClick={() => setIsComposingNote(true)}
								title={`Write a new note into ${PLANNER_NOTES_FOLDER}`}
								style={NOTE_ACTION_BTN_STYLE}
								onMouseEnter={noteActionHoverIn}
								onMouseLeave={noteActionHoverOut}
							>
								<span style={{ fontSize: '13px', lineHeight: 1 }}>+</span>
								<span>Create note</span>
							</button>
						</div>
					)}

					{linkedNotes.length > 0 && (
						<ul className="linked-notes-list">
							{linkedNotes.map((note, i) => (
								<li
									key={i}
									className="linked-note-chip"
									onClick={() => handleOpenNote(note)}
									title={`Click to open "${note}" in Obsidian`}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
									<span className="linked-note-title">{note}</span>
									<span
										className="remove-note-btn"
										title="Remove link"
										onClick={(e) => {
											e.stopPropagation();
											handleRemoveNote(note);
										}}
									>
										×
									</span>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* Event To Do Section */}
				<div className="pane-section todo-section" style={{ paddingTop: '6px', paddingBottom: '8px' }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', padding: '0 4px' }}>
						<span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-normal)', letterSpacing: '0.2px' }}>To Do</span>
						<button
							onClick={(e) => {
								e.stopPropagation();
								if (eventTodos.some(t => t.completed)) {
									handleClearCompletedEventTodos();
								}
							}}
							title={eventTodos.some(t => t.completed) ? "Clear completed tasks" : "Clear completed tasks (none completed)"}
							style={{
								background: 'transparent',
								border: 'none',
								cursor: eventTodos.some(t => t.completed) ? 'pointer' : 'default',
								color: 'var(--text-muted)',
								padding: '3px 5px',
								borderRadius: '4px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								lineHeight: 1,
								opacity: eventTodos.length === 0 ? 0 : (eventTodos.some(t => t.completed) ? 0.85 : 0.3),
								pointerEvents: eventTodos.some(t => t.completed) ? 'auto' : 'none',
								transition: 'all 0.15s ease'
							}}
							onMouseEnter={(e) => {
								if (eventTodos.some(t => t.completed)) {
									e.currentTarget.style.color = '#facc15';
									e.currentTarget.style.background = 'var(--background-modifier-hover)';
									e.currentTarget.style.opacity = '1';
								}
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.color = 'var(--text-muted)';
								e.currentTarget.style.background = 'transparent';
								e.currentTarget.style.opacity = eventTodos.length === 0 ? '0' : (eventTodos.some(t => t.completed) ? '0.85' : '0.3');
							}}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
						</button>
					</div>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
						{/* Always visible blank input box as first line */}
						<div style={{ position: 'relative', width: '100%', padding: '0 0 4px 0' }}>
							<input
								type="text"
								className={`todo-add-input ${newEventTodoInput ? 'has-value' : ''}`}
								placeholder="Add a to-do..."
								value={newEventTodoInput}
								onChange={(e) => setNewEventTodoInput(e.target.value)}
								onFocus={() => setIsAddingEventTodo(true)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === 'Enter') {
										e.preventDefault();
										handleAddEventTodo();
										setIsAddingEventTodo(false);
									} else if (e.key === 'Escape') {
										setNewEventTodoInput('');
										setIsAddingEventTodo(false);
									}
								}}
								onBlur={() => {
									setIsAddingEventTodo(false);
									if (newEventTodoInput.trim()) {
										handleAddEventTodo();
									}
								}}
								style={{
									backgroundColor: (isAddingEventTodo || Boolean(newEventTodoInput))
										? 'var(--background-modifier-form-field)'
										: 'transparent',
									borderColor: (isAddingEventTodo || Boolean(newEventTodoInput))
										? 'var(--background-modifier-border)'
										: 'transparent',
									borderWidth: '1px',
									borderStyle: 'solid',
									outline: 'none',
									boxShadow: 'none',
									width: '100%',
									padding: '10px 12px',
									fontSize: '14px',
									lineHeight: '1.45',
									borderRadius: '8px',
									color: 'var(--text-normal)',
									boxSizing: 'border-box'
								}}
							/>
						</div>

						{/* All existing to-do items listed below - completed items drop down to bottom */}
						{[...eventTodos].sort((a, b) => {
							const aCompleted = a.completed && !recentlyCompleted.has(a.id);
							const bCompleted = b.completed && !recentlyCompleted.has(b.id);
							return Number(aCompleted) - Number(bCompleted);
						}).map((todo, index) => {
							// Per-row accent derived from the todo id, so the color stays
							// identical when the list re-sorts (e.g. a completed item drops
							// to the bottom). Rows in the timer column keep their timer color.
							const rowAccent = accentColorForId(todo.id);
							const activeTimer = timers?.find(t => t.todoId === todo.id);
							// The circle takes the timer's own colour while the to-do sits in the
							// timer column, resolved through the shared palette so every swatch a
							// timer can wear resolves. A local shortlist was used here before, and
							// any name missing from it left both the ring and the fill fully
							// transparent — the row appeared to have no checkbox at all.
							const timerAccent = activeTimer ? (resolveAccentHex(activeTimer.colorTheme) || undefined) : undefined;
							const checkboxAccent = timerAccent || rowAccent;
							return (
								<div
									key={todo.id}
									draggable
									onDragStart={(e) => {
										const payload = JSON.stringify({ type: 'todo', title: todo.title, todoId: todo.id, eventId: event?.id });
										e.dataTransfer.setData('application/json', payload);
										e.dataTransfer.setData('application/x-obsidian-calendar-todo', payload);
										e.dataTransfer.setData('text/plain', payload);
										e.dataTransfer.effectAllowed = 'copy';
									}}
									className="sidebar-todo-row"
									style={{
										padding: '6px 8px',
										borderRadius: '6px',
										display: 'flex',
										alignItems: 'flex-start',
										gap: '10px',
										width: '100%',
										minWidth: 0,
										boxSizing: 'border-box',
										cursor: 'grab'
									}}
								>
									<div style={{ display: 'flex', alignItems: 'center', marginTop: '2px', opacity: 0.5 }}>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
									</div>
									<div
										onClick={(e) => {
											e.stopPropagation();
											handleToggleEventTodo(todo.id);
										}}
										style={{
											width: '18px',
											height: '18px',
											borderRadius: '50%',
											// Completed rows — and rows already sitting in the timer column —
											// render as a solid accent-filled circle with NO checkmark.
											border: (todo.completed || activeTimer) ? '1.5px solid transparent' : '1.5px solid var(--text-muted)',
											// A row in the timer column is drawn as a solid filled circle, so its
											// fill falls back to the row's own accent rather than to
											// transparency: there is no ring to fall back on, and an
											// unfilled circle with a transparent ring is nothing at all.
											backgroundColor: todo.completed
												? checkboxAccent
												: (activeTimer ? checkboxAccent : 'transparent'),
											flexShrink: 0,
											cursor: 'pointer',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											opacity: todo.completed ? 0.9 : 0.8,
											transition: 'all 0.15s ease',
											marginTop: '1px'
										}}
										title={todo.completed ? "Mark incomplete" : "Complete"}
									></div>
									{editingTodoId === todo.id ? (
										<input
											type="text"
											autoFocus
											className="todo-inline-edit-input"
											value={editingTodoText}
											onChange={(e) => setEditingTodoText(e.target.value)}
											onKeyDown={(e) => {
												e.stopPropagation();
												if (e.key === 'Enter') {
													e.preventDefault();
													handleEditEventTodo(todo.id, editingTodoText);
													setEditingTodoId(null);
												} else if (e.key === 'Escape') {
													setEditingTodoId(null);
												}
											}}
											onBlur={() => {
												handleEditEventTodo(todo.id, editingTodoText);
												setEditingTodoId(null);
											}}
											onClick={(e) => e.stopPropagation()}
											onFocus={(e) => {
												const val = e.currentTarget.value;
												e.currentTarget.setSelectionRange(val.length, val.length);
											}}
											style={{
												fontSize: '13px',
												fontWeight: 400,
												color: '#ffffff',
												background: 'var(--background-modifier-form-field, rgba(255, 255, 255, 0.05))',
												border: '1px solid var(--background-modifier-border)',
												borderRadius: '4px',
												padding: '2px 6px',
												outline: 'none',
												boxShadow: 'none',
												flex: 1,
												minWidth: 0,
												boxSizing: 'border-box',
												lineHeight: 1.35
											}}
										/>
									) : (
										<span
											onClick={(e) => {
												e.stopPropagation();
												setEditingTodoId(todo.id);
												setEditingTodoText(todo.title);
											}}
											style={{
												fontSize: '13px',
												fontWeight: 400,
												color: todo.completed ? 'var(--text-muted)' : 'var(--text-normal)',
												textDecoration: todo.completed ? 'line-through' : 'none',
												textDecorationColor: checkboxAccent,
												textDecorationThickness: '1.5px',
												opacity: todo.completed ? 0.6 : 1,
												display: '-webkit-box',
												WebkitLineClamp: 3,
												WebkitBoxOrient: 'vertical',
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												wordBreak: 'break-word',
												whiteSpace: 'normal',
												lineHeight: 1.35,
												flex: 1,
												minWidth: 0,
												cursor: 'default'
											}}
											title={`${todo.title} (Click to edit)`}
										>
											{todo.title}
										</span>
									)}
									<span
										className="todo-delete-btn"
										title="Delete"
										onClick={(e) => {
											e.stopPropagation();
											handleDeleteEventTodo(todo.id);
										}}
										style={{
											fontSize: '14px',
											lineHeight: 1,
											color: 'var(--text-muted)',
											cursor: 'pointer',
											padding: '2px 4px',
											borderRadius: '4px',
											marginTop: '1px',
											flexShrink: 0
										}}
									>
										×
									</span>
								</div>
							);
						})}
					</div>
				</div>

				<div className="pane-section bottom-section">
					<div className="status-row">
						<span className="status-item">Busy</span>
						<span className="status-item">Default visibility</span>
					</div>

					<div className="reminders-header">
						<svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
						<span>Reminders</span>
					</div>
					{/* The reminder lead time opens a menu of our own rather than the operating
					    system's native select popup (which on macOS is a plain system menu that
					    ignores the app's styling). It is the same row-and-menu pair the time
					    zone and repeat rows use, so it inherits their hover, selected and
					    divider-free treatment; the one difference is that the menu is anchored
					    upward, because this row sits at the very foot of the pane and would
					    otherwise open off the bottom edge. */}
					<div className="reminders-dropdown-row">
						<div
							className="event-option-row reminders-option-row"
							onClick={() => setOpenDropdown(prev => prev === 'reminders' ? 'none' : 'reminders')}
						>
							<span className="event-option-label">{reminders}</span>
							<svg className="event-option-trailing" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
							{openDropdown === 'reminders' && (
								<div className="event-option-dropdown reminders-dropdown-menu" onClick={(e) => e.stopPropagation()}>
									{REMINDER_OPTIONS.map(opt => (
										<div
											key={opt}
											className={`event-option-dropdown-item ${reminders === opt ? 'is-selected' : ''}`}
											onClick={() => { setReminders(opt); setOpenDropdown('none'); }}
										>
											{opt}
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
