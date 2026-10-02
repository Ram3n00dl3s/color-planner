import React, { useState, useEffect, useRef } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { TFile } from 'obsidian';
import SleekCalendarPlugin from '../../main';
import {
	getTodaysDailyNoteFile,
	parseDailyNoteTasks,
	DailyTodoItem
} from '../../utils/dailyNotes';
import { getNowInTimeZone } from '../../utils/timezone';
import { CalendarEvent, CalendarProfile } from '../../types';
import { eventOccursOnDay } from '../../utils/events';
import { randomEventDotColor, accentColorForId, resolveAccentHex, DEFAULT_ACCENT_HEX, hexToRgba, ACCENT_CHIP_TINT_ALPHA } from '../../utils/colors';


// Full colour palette offered by the profile creator's "more colours" droplet.
const ALL_PALETTE_COLORS = [
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

// Inline quick-pick swatches, mirroring the right pane's colour row.
const RECENT_COLORS = [
	'blue', 'green', 'purple', 'orange', 'red', 'pink', 'teal', 'yellow',
	'cyan', 'indigo', 'lime'
];

// Only a handful of swatches are shown inline — the rest stay behind the
// "more colours" droplet so the row never overflows the narrow pane.
const PROFILE_SWATCH_COLORS = RECENT_COLORS.slice(0, 7);
// Fallback for a profile created without the user ever picking a colour.
const DEFAULT_PROFILE_COLOR = PROFILE_SWATCH_COLORS[0];

// Sentinel "id" for the Default row at the top of the creator list. It is NOT a
// profile: it only carries the colour new tiles are created in, so it is kept out
// of `calendarProfiles` and never shows up in an event's profile picker.
const DEFAULT_ROW_ID = '__default__';

export const Sidebar = ({ currentDate, setCurrentDate, plugin, timers, setTimers, accentColor, timeZone, events }: { currentDate: Date, setCurrentDate: (d: Date) => void, plugin?: SleekCalendarPlugin, timers?: any[], setTimers?: React.Dispatch<React.SetStateAction<any[]>>, accentColor?: string | null, timeZone?: string, events?: CalendarEvent[] }) => {

	// "Now" in the configured time zone (drives today's highlight + day rollover)
	const nowInTz = getNowInTimeZone(timeZone);

	// Mini Calendar State
	const [miniMonth, setMiniMonth] = useState(currentDate);

	useEffect(() => {
		setMiniMonth(currentDate);
	}, [currentDate.getFullYear(), currentDate.getMonth()]);

	// Clear any pending completion-drop timers on unmount.
	useEffect(() => {
		const timersMap = completionTimersRef.current;
		return () => {
			timersMap.forEach(t => clearTimeout(t));
			timersMap.clear();
		};
	}, []);

	// Notebook events (dragged from vault)
	const [notebookEvents, setNotebookEvents] = useState<{ id: string, title: string, link?: string, completed?: boolean }[]>([
		{ id: '1', title: 'Design onboarding', link: '[[Design onboarding]]' },
		{ id: '2', title: 'Write hiring criteria', link: '[[Write hiring criteria]]' },
		{ id: '3', title: 'Publish blog post', link: '[[Publish blog post]]' }
	]);

	// Regular to-do items (synced with Daily Note for currentDate)
	const [regularTodos, setRegularTodos] = useState<DailyTodoItem[]>([]);
	const [dailyNoteFile, setDailyNoteFile] = useState<TFile | null>(null);
	const dailyNoteFileRef = useRef<TFile | null>(null);
	const [newRegularTodoInput, setNewRegularTodoInput] = useState('');
	const [isAddTodoFocused, setIsAddTodoFocused] = useState(false);
	const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
	const [editingTodoText, setEditingTodoText] = useState<string>('');
	// To-dos that were just completed: shown struck-through immediately, but held
	// in place (not yet dropped to the bottom) for a brief moment.
	const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());
	const completionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	// Calendar-level state overrides (scoped and strictly read-only to vault notes)
	const completedOverridesRef = useRef<Map<string, boolean>>(new Map());
	const deletedIdsRef = useRef<Set<string>>(new Set());
	const customTodosByDayRef = useRef<Map<string, DailyTodoItem[]>>(new Map());

	// Sync daily note on open, date change, and whenever vault changes (strictly read-only)
	const syncDailyNoteTasks = async (targetDate: Date = currentDate) => {
		if (!plugin?.app) return;
		try {
			const dayKey = format(targetDate, 'yyyy-MM-dd');
			const file = getTodaysDailyNoteFile(plugin.app, targetDate);
			dailyNoteFileRef.current = file;
			setDailyNoteFile(file);

			const customTasks = customTodosByDayRef.current.get(dayKey) || [];
			const activeCustomTasks = customTasks.filter(t => !deletedIdsRef.current.has(t.id));

			if (file) {
				const content = await plugin.app.vault.read(file);
				const tasks = parseDailyNoteTasks(content, file);

				// Merge parsed tasks with calendar-level state without ever modifying the note file
				const activeNoteTasks = tasks
					.filter(t => !deletedIdsRef.current.has(t.id))
					.map(t => {
						if (completedOverridesRef.current.has(t.id)) {
							return { ...t, completed: completedOverridesRef.current.get(t.id)! };
						}
						return t;
					});

				const allTasks = [...activeNoteTasks, ...activeCustomTasks];
				const incomplete = allTasks.filter(t => !t.completed);
				const completed = allTasks.filter(t => t.completed);
				setRegularTodos([...incomplete, ...completed]);
			} else {
				// No daily note for this date: only show custom tasks added for this specific date
				const incomplete = activeCustomTasks.filter(t => !t.completed);
				const completed = activeCustomTasks.filter(t => t.completed);
				setRegularTodos([...incomplete, ...completed]);
			}
		} catch (err) {
			console.error('Error syncing daily note tasks:', err);
		}
	};

	useEffect(() => {
		syncDailyNoteTasks(currentDate);

		if (!plugin?.app?.vault) return;

		const modifyRef = plugin.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				syncDailyNoteTasks(currentDate);
			}
		});

		const createRef = plugin.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				syncDailyNoteTasks(currentDate);
			}
		});

		const deleteRef = plugin.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				if (dailyNoteFileRef.current && file.path === dailyNoteFileRef.current.path) {
					dailyNoteFileRef.current = null;
					setDailyNoteFile(null);
				}
				syncDailyNoteTasks(currentDate);
			}
		});

		return () => {
			plugin.app.vault.offref(modifyRef);
			plugin.app.vault.offref(createRef);
			plugin.app.vault.offref(deleteRef);
		};
	}, [plugin, currentDate]);

	// Detect day change / midnight passing or window focus
	useEffect(() => {
		let lastCheckedDay = format(getNowInTimeZone(timeZone), 'yyyy-MM-dd');

		const checkDayRollover = () => {
			const currentToday = format(getNowInTimeZone(timeZone), 'yyyy-MM-dd');
			if (currentToday !== lastCheckedDay) {
				lastCheckedDay = currentToday;
				// If calendar was displaying yesterday's today, advance it
				if (isSameDay(currentDate, getNowInTimeZone(timeZone, new Date(Date.now() - 24 * 60 * 60 * 1000)))) {
					setCurrentDate(getNowInTimeZone(timeZone));
				} else {
					syncDailyNoteTasks(currentDate);
				}
			}
		};

		const interval = setInterval(checkDayRollover, 15000);

		const handleFocus = () => {
			checkDayRollover();
			syncDailyNoteTasks(currentDate);
		};
		window.addEventListener('focus', handleFocus);

		return () => {
			clearInterval(interval);
			window.removeEventListener('focus', handleFocus);
		};
	}, [currentDate, setCurrentDate, timeZone]);

	const handleDeleteNotebookEvent = (id: string) => {
		setNotebookEvents(prev => prev.filter(t => t.id !== id));
	};

	const handleToggleRegularTodo = (id: string) => {
		const target = regularTodos.find(t => t.id === id);
		if (!target) return;
		const nextCompleted = !target.completed;
		completedOverridesRef.current.set(id, nextCompleted);

		const dayKey = format(currentDate, 'yyyy-MM-dd');
		const existing = customTodosByDayRef.current.get(dayKey) || [];
		customTodosByDayRef.current.set(
			dayKey,
			existing.map(t => t.id === id ? { ...t, completed: nextCompleted } : t)
		);

		// Update the flag in place so the strikethrough shows immediately...
		setRegularTodos(prev => prev.map(t => t.id === id ? { ...t, completed: nextCompleted } : t));

		const pendingDrop = completionTimersRef.current.get(id);
		if (pendingDrop) {
			clearTimeout(pendingDrop);
			completionTimersRef.current.delete(id);
		}

		if (nextCompleted) {
			// ...but hold the row in place for a beat before it drops to the bottom.
			setRecentlyCompleted(prev => {
				const next = new Set(prev);
				next.add(id);
				return next;
			});
			const timeout = setTimeout(() => {
				setRecentlyCompleted(prev => {
					const next = new Set(prev);
					next.delete(id);
					return next;
				});
				completionTimersRef.current.delete(id);
			}, 1000);
			completionTimersRef.current.set(id, timeout);
		} else {
			setRecentlyCompleted(prev => {
				if (!prev.has(id)) return prev;
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		}
	};

	const handleDeleteRegularTodo = (id: string) => {
		deletedIdsRef.current.add(id);
		completedOverridesRef.current.delete(id);
		const dayKey = format(currentDate, 'yyyy-MM-dd');
		const existing = customTodosByDayRef.current.get(dayKey) || [];
		customTodosByDayRef.current.set(
			dayKey,
			existing.filter(t => t.id !== id)
		);
		setRegularTodos(prev => prev.filter(t => t.id !== id));
	};

	const handleEditRegularTodo = (id: string, newTitle: string) => {
		const trimmed = newTitle.trim();
		if (!trimmed) {
			handleDeleteRegularTodo(id);
			return;
		}
		const dayKey = format(currentDate, 'yyyy-MM-dd');
		const existing = customTodosByDayRef.current.get(dayKey) || [];
		customTodosByDayRef.current.set(
			dayKey,
			existing.map(t => t.id === id ? { ...t, title: trimmed } : t)
		);
		setRegularTodos(prev => prev.map(t => t.id === id ? { ...t, title: trimmed } : t));
		// Reflect the rename on any timer tile created from this to-do.
		if (setTimers) {
			setTimers(prev => prev.map(t => (t.todoId === id && !t.eventId) ? { ...t, title: trimmed } : t));
		}
	};

	const handleClearCompletedRegularTodos = () => {
		const completedItems = regularTodos.filter(t => t.completed);
		completedItems.forEach(item => {
			deletedIdsRef.current.add(item.id);
			completedOverridesRef.current.delete(item.id);
		});
		const dayKey = format(currentDate, 'yyyy-MM-dd');
		const existing = customTodosByDayRef.current.get(dayKey) || [];
		customTodosByDayRef.current.set(
			dayKey,
			existing.filter(t => !t.completed)
		);
		setRegularTodos(prev => prev.filter(t => !t.completed));
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();

		// Guard: If dragging an internal todo item within the sidebar, ignore it completely!
		const internalTodo = e.dataTransfer.getData('application/x-obsidian-calendar-todo');
		if (internalTodo) return;

		let text = e.dataTransfer.getData('text/plain');
		if (!text) return;

		if (text.trim().startsWith('{')) {
			try {
				const parsed = JSON.parse(text);
				if (parsed && (parsed.type === 'todo' || parsed.id)) return;
			} catch (err) { }
		}

		let title = text;
		let link = '';
		if (text.includes('obsidian://open')) {
			try {
				const url = new URL(text);
				const fileParam = url.searchParams.get('file');
				if (fileParam) {
					title = decodeURIComponent(fileParam).split('/').pop() || fileParam;
					title = title.replace(/\.md$/i, '');
					link = `[[${title}]]`;
				}
			} catch (err) { }
		} else {
			title = text.replace(/\[\[|\]\]/g, '').trim();
			link = `[[${title}]]`;
		}

		if (title && !title.startsWith('{')) {
			setNotebookEvents(prev => [...prev.filter(t => !t.title.trim().startsWith('{')), { id: Math.random().toString(36).substring(7), title, link: link || `[[${title}]]` }]);
		}
	};

	const [draggedIndex, setDraggedIndex] = useState<{ list: 'notebook' | 'regular', index: number } | null>(null);

	const handleItemDragStart = (e: React.DragEvent, todo: { id: string, title: string, link?: string, completed?: boolean }, list: 'notebook' | 'regular', index: number) => {
		e.stopPropagation();
		setDraggedIndex({ list, index });
		const isNote = list === 'notebook';
		const cleanTitle = todo.title.replace(/\[\[|\]\]/g, '');
		const payload = JSON.stringify({
			type: isNote ? 'notebook-note' : 'regular-todo',
			title: cleanTitle,
			link: isNote ? (todo.link || `[[${cleanTitle}]]`) : undefined,
			completed: !!todo.completed,
			todoId: todo.id
		});
		e.dataTransfer.setData('application/x-obsidian-calendar-todo', payload);
		e.dataTransfer.setData('application/json', payload);
		e.dataTransfer.setData('text/plain', payload);
		e.dataTransfer.effectAllowed = 'copyMove';
	};

	const handleItemDragOver = (e: React.DragEvent, list: 'notebook' | 'regular', targetIndex: number) => {
		e.preventDefault();
		e.stopPropagation();
		if (!draggedIndex || draggedIndex.list !== list || draggedIndex.index === targetIndex) return;

		if (list === 'notebook') {
			setNotebookEvents(prev => {
				const updated = [...prev];
				const [moved] = updated.splice(draggedIndex.index, 1);
				updated.splice(targetIndex, 0, moved);
				return updated;
			});
		} else {
			setRegularTodos(prev => {
				const updated = [...prev];
				const [moved] = updated.splice(draggedIndex.index, 1);
				updated.splice(targetIndex, 0, moved);
				return updated;
			});
		}
		setDraggedIndex({ list, index: targetIndex });
	};

	const handleItemDragEnd = () => {
		setDraggedIndex(null);
	};

	const handleOpenNote = (link?: string, title?: string) => {
		const noteName = (link ? link.replace(/\[\[|\]\]/g, '') : title) || '';
		if (plugin?.app?.workspace && noteName) {
			plugin.app.workspace.openLinkText(noteName, '', false);
		}
	};

	const handleAddRegularTodo = () => {
		const trimmed = newRegularTodoInput.trim();
		if (trimmed) {
			const cleanTitle = trimmed.replace(/\[\[|\]\]/g, '');
			const dayKey = format(currentDate, 'yyyy-MM-dd');
			const newTodo: DailyTodoItem = {
				id: `custom-${dayKey}-${Math.random().toString(36).substring(2, 9)}`,
				title: cleanTitle,
				completed: false,
				lineIndex: -1,
				sourceFile: ''
			};
			const existing = customTodosByDayRef.current.get(dayKey) || [];
			customTodosByDayRef.current.set(dayKey, [...existing, newTodo]);
			setRegularTodos(prev => {
				const incomplete = [...prev.filter(t => !t.completed), newTodo];
				const completed = prev.filter(t => t.completed);
				return [...incomplete, ...completed];
			});
			setNewRegularTodoInput('');
		}
	};

	// ---------- Calendar profiles (moved here from the event details pane) ----------
	// Profiles are calendar-wide, so they are created, renamed, recoloured and
	// deleted in this default right pane; an event then simply *attaches* one from
	// the swatch picker under its title.
	const [profilesRevision, setProfilesRevision] = useState(0);
	const [profileCreatorOpen, setProfileCreatorOpen] = useState(false);
	const [profilePaletteOpen, setProfilePaletteOpen] = useState(false);
	const [newProfileName, setNewProfileName] = useState('');
	// null = nothing chosen yet: no colour swatch is ticked until the user arms an
	// existing profile or picks a colour for the profile they are naming.
	const [newProfileColor, setNewProfileColor] = useState<string | null>(null);
	// The profile whose colour is being changed from the COLOR row (null = the row
	// is picking the colour a brand-new profile will be created with).
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const newProfileInputRef = useRef<HTMLInputElement>(null);
	const profileSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// The colour every newly created tile is born in — held by the "Default" row at
	// the top of the list below. '' means nothing has been chosen yet: that row's
	// swatch renders empty and new tiles fall back to pastel blue.
	const [defaultEventColor, setDefaultEventColor] = useState<string>(
		plugin?.settings?.defaultEventColor || ''
	);

	const calendarProfiles: CalendarProfile[] = React.useMemo(
		() => (Array.isArray(plugin?.settings?.calendarProfiles) ? plugin!.settings.calendarProfiles : []),
		[plugin, profilesRevision]
	);

	const profileHex = (profile?: CalendarProfile | null): string =>
		resolveAccentHex(profile?.color) || DEFAULT_ACCENT_HEX;

	// Persist to plugin settings (debounced: renaming writes per keystroke) and bump
	// the local revision so this pane re-reads the array straight away.
	const persistProfiles = (next: CalendarProfile[]) => {
		if (plugin?.settings) {
			plugin.settings.calendarProfiles = next;
			if (profileSaveRef.current) clearTimeout(profileSaveRef.current);
			profileSaveRef.current = setTimeout(() => {
				plugin.saveSettings();
				plugin.notifySettingsChanged();
			}, 400);
		}
		setProfilesRevision(r => r + 1);
	};

	const makeProfileId = () => `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

	// Every shape-related property of a colour swatch is set inline — including a
	// circular clip path — so these swatches always render as perfect circles,
	// whatever any stylesheet says. Selection is a subtle size bump, never a border.
	const colorSwatchStyle: React.CSSProperties = {
		width: 20,
		height: 20,
		minWidth: 20,
		borderRadius: '50%',
		clipPath: 'circle(50%)',
		WebkitClipPath: 'circle(50%)',
		padding: 0,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		boxSizing: 'border-box',
		flexShrink: 0,
		cursor: 'pointer',
		border: 'none',
		outline: 'none',
		boxShadow: 'none'
	};

	// Clicking a profile's own swatch never assigns anything and never ticks: it
	// arms that profile so the COLOR row below recolours it. Arming also drops any
	// half-typed draft name, so the menu is unambiguously in "recolour" mode.
	const startEditingProfileColor = (profile: CalendarProfile) => {
		const willArm = editingProfileId !== profile.id;
		setEditingProfileId(willArm ? profile.id : null);
		setProfilePaletteOpen(false);
		if (willArm) {
			setNewProfileName('');
			setNewProfileColor(profile.color);
		} else {
			setNewProfileColor(null);
		}
	};

	// The Default row is armed for a colour change exactly like a profile swatch, so
	// the menu keeps a single swatch picker (the COLOR row) for everything.
	const startEditingDefaultColor = () => {
		const willArm = editingProfileId !== DEFAULT_ROW_ID;
		setEditingProfileId(willArm ? DEFAULT_ROW_ID : null);
		setProfilePaletteOpen(false);
		if (willArm) {
			setNewProfileName('');
			setNewProfileColor(defaultEventColor || null);
		} else {
			setNewProfileColor(null);
		}
	};

	// The COLOR row stays inert until the user is either naming a new profile, has
	// armed an existing profile's swatch, or has armed the Default row.
	const colorSelectionArmed = editingProfileId !== null || newProfileName.trim().length > 0;
	const isColorChosen = (color: string) => colorSelectionArmed && newProfileColor === color;
	// A colour picked from the droplet palette keeps the droplet highlighted.
	const paletteColorChosen = newProfileColor !== null && !PROFILE_SWATCH_COLORS.includes(newProfileColor);

	const chooseColor = (color: string) => {
		if (!colorSelectionArmed) return;
		setNewProfileColor(color);
		setProfilePaletteOpen(false);
		if (!editingProfileId) return;
		// The Default row is not a profile: the pick stores the setting every new
		// tile reads and stops there.
		if (editingProfileId === DEFAULT_ROW_ID) {
			setDefaultEventColor(color);
			if (plugin?.settings) {
				plugin.settings.defaultEventColor = color;
				plugin.saveSettings();
				plugin.notifySettingsChanged();
			}
			return;
		}
		const target = calendarProfiles.find(p => p.id === editingProfileId);
		if (!target || target.color === color) return;
		persistProfiles(calendarProfiles.map(p => (p.id === editingProfileId ? { ...p, color } : p)));
	};

	const openProfileCreator = () => {
		setNewProfileName('');
		setNewProfileColor(null);
		setProfilePaletteOpen(false);
		setEditingProfileId(null);
		setProfileCreatorOpen(prev => !prev);
	};

	const createProfile = () => {
		const name = newProfileName.trim();
		if (!name) return;
		const profile: CalendarProfile = { id: makeProfileId(), name, color: newProfileColor ?? DEFAULT_PROFILE_COLOR };
		persistProfiles([...calendarProfiles, profile]);
		setNewProfileName('');
		setNewProfileColor(null);
		setProfilePaletteOpen(false);
		setEditingProfileId(null);
	};

	// Live rename. Whitespace-only input is ignored so a profile can never end up
	// nameless (the last good name is kept).
	const renameProfile = (id: string, name: string) => {
		if (!name.trim()) return;
		persistProfiles(calendarProfiles.map(p => (p.id === id ? { ...p, name } : p)));
	};

	const deleteProfile = (id: string) => {
		persistProfiles(calendarProfiles.filter(p => p.id !== id));
	};

	// Dismiss the creator (and its palette) on any click outside of it.
	useEffect(() => {
		if (!profileCreatorOpen && !profilePaletteOpen) return;
		const handlePointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.profile-creator-wrapper')) setProfileCreatorOpen(false);
			if (!target.closest('.profile-palette-wrapper')) setProfilePaletteOpen(false);
		};
		// Capture phase: a click anywhere else in Obsidian must dismiss the menu
		// even when an inner handler calls stopPropagation() on the same gesture.
		window.addEventListener('pointerdown', handlePointerDown, true);
		return () => window.removeEventListener('pointerdown', handlePointerDown, true);
	}, [profileCreatorOpen, profilePaletteOpen]);

	// Focus the profile-name field when the creator opens. The cursor goes to the
	// end of the value — never auto-select — so typing continues the name.
	useEffect(() => {
		if (!profileCreatorOpen) return;
		const id = setTimeout(() => {
			const el = newProfileInputRef.current;
			if (el) {
				el.focus();
				const len = el.value.length;
				el.setSelectionRange(len, len);
			}
		}, 0);
		return () => clearTimeout(id);
	}, [profileCreatorOpen]);

	// The creator itself: the profile list (swatch to recolour, inline rename,
	// delete), then the colour row with the "more colours" droplet, then the
	// name field and the Cancel/Create actions. Same "sleek menu" surface as the
	// grid's right-click menu, rendered inline instead of floating.
	const renderProfileCreator = () => (
		<div className="sleek-menu profile-creator-popover is-inline" onClick={(e) => e.stopPropagation()}>
			{/* Heading row with an explicit close affordance. Clicking anywhere else
			    still dismisses the menu, but an "X" makes that obvious. */}
			<div className="profile-creator-head">
				<div className="profile-creator-heading">Calendar</div>
				<button
					type="button"
					className="profile-creator-close"
					title="Close"
					aria-label="Close"
					onClick={() => setProfileCreatorOpen(false)}
				>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div className="profile-creator-list">
				{/* The "Default" row: the colour every newly created tile starts in. It
				    sits at the top of the list and arms the shared COLOR row below just
				    like a profile swatch — but it is NOT a profile, so it never joins
				    `calendarProfiles` and is never offered in an event's profile picker.
				    Its swatch stays empty until a colour has been chosen. */}
				<div className="profile-creator-row">
					<button
						type="button"
						className={`profile-creator-row-swatch ${editingProfileId === DEFAULT_ROW_ID ? 'is-editing' : ''}`}
						style={{
							background: defaultEventColor ? (resolveAccentHex(defaultEventColor) || DEFAULT_ACCENT_HEX) : 'rgba(128, 128, 128, 0.16)',
							borderRadius: '4px'
						}}
						title="Default — the colour every new tile is created in"
						onClick={startEditingDefaultColor}
					/>
					<div className="profile-creator-row-label">Default</div>
					<span className="profile-creator-row-note">new tiles</span>
				</div>
				{calendarProfiles.map(p => {
					const isEditing = editingProfileId === p.id;
					return (
						<div key={p.id} className="profile-creator-row">
							{/* Selecting the profile's swatch arms it for a colour change —
								    it is highlighted with a neutral size bump and NEVER ticked. */}
							<button
								type="button"
								className={`profile-creator-row-swatch ${isEditing ? 'is-editing' : ''}`}
								style={{ background: profileHex(p), borderRadius: '4px' }}
								title={`${p.name} — click to change this profile's color`}
								onClick={() => startEditingProfileColor(p)}
							/>
							<input
								className="profile-creator-row-input"
								value={p.name}
								onChange={(e) => renameProfile(p.id, e.target.value)}
								onKeyDown={(e) => e.stopPropagation()}
							/>
							<button
								type="button"
								className="profile-creator-row-del"
								title="Delete profile"
								onClick={() => deleteProfile(p.id)}
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="3 6 5 6 21 6"></polyline>
									<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
								</svg>
							</button>
						</div>
					);
				})}
			</div>
			{calendarProfiles.length === 0 && (
				<div className="profile-creator-empty">No profiles yet — create one below.</div>
			)}
			<div className="sleek-menu-divider" />
			<div className="profile-creator-heading">Color</div>
			<div className="sleek-menu-color-row">
				{PROFILE_SWATCH_COLORS.map(c => (
					<button
						key={c}
						type="button"
						className={`event-${c} profile-color-swatch ${isColorChosen(c) ? 'is-selected' : ''}`}
						style={colorSwatchStyle}
						title={colorSelectionArmed ? c : 'Name the profile first, then pick its color'}
						disabled={!colorSelectionArmed}
						onClick={() => chooseColor(c)}
					>
						{isColorChosen(c) && (
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(0, 0, 0, 0.8)', pointerEvents: 'none' }}>
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
						)}
					</button>
				))}
				<div className="profile-palette-wrapper">
					<button
						type="button"
						className={`sleek-menu-more ${colorSelectionArmed && (profilePaletteOpen || paletteColorChosen) ? 'is-active' : ''}`}
						title={colorSelectionArmed ? 'More colors' : 'Name the profile first, then pick its color'}
						disabled={!colorSelectionArmed}
						onClick={() => setProfilePaletteOpen(prev => !prev)}
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
						</svg>
					</button>
					{profilePaletteOpen && (
						<div className="sleek-menu-palette" onClick={(e) => e.stopPropagation()}>
							{ALL_PALETTE_COLORS.map(c => (
								<button
									key={c}
									type="button"
									className={`event-${c} profile-color-swatch ${isColorChosen(c) ? 'is-selected' : ''}`}
									style={colorSwatchStyle}
									title={colorSelectionArmed ? c.replace('-', ' ') : 'Name the profile first, then pick its color'}
									disabled={!colorSelectionArmed}
									onClick={() => chooseColor(c)}
								>
									{isColorChosen(c) && (
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(0, 0, 0, 0.8)', pointerEvents: 'none' }}>
											<polyline points="20 6 9 17 4 12"></polyline>
										</svg>
									)}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
			<input
				ref={newProfileInputRef}
				className="profile-creator-input"
				type="text"
				placeholder="Profile name"
				value={newProfileName}
				onChange={(e) => {
					const nextName = e.target.value;
					// Typing a brand-new name immediately detaches any armed profile and
					// clears the tick, so a new profile can never inherit the colour the
					// user was about to change on an existing one.
					if (!newProfileName.trim() && nextName.trim()) {
						setEditingProfileId(null);
						setNewProfileColor(null);
					}
					setNewProfileName(nextName);
				}}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') {
						e.preventDefault();
						createProfile();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						setProfileCreatorOpen(false);
					}
				}}
			/>
			<div className="profile-creator-actions">
				<button type="button" className="profile-creator-btn" onClick={() => setProfileCreatorOpen(false)}>Cancel</button>
				<button
					type="button"
					className="profile-creator-btn is-primary"
					disabled={!newProfileName.trim()}
					onClick={createProfile}
				>
					Create
				</button>
			</div>
		</div>
	);

	const monthStart = startOfMonth(miniMonth);
	const monthEnd = endOfMonth(monthStart);
	const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
	const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
	const days = eachDayOfInterval({ start: startDate, end: endDate });
	const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

	return (
		<div className="sleek-sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
			{/* Notion-style Mini Calendar */}
			<div className="sidebar-mini-calendar" style={{ display: 'flex', flexDirection: 'column', userSelect: 'none', padding: '0 2px' }}>
				{/* Month Header with Navigation */}
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 10px 2px' }}>
					<span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-normal)', letterSpacing: '-0.1px' }}>
						{format(miniMonth, 'MMMM yyyy')}
					</span>
					<div style={{ display: 'flex', gap: '2px' }}>
						<button
							onClick={() => setMiniMonth(subMonths(miniMonth, 1))}
							style={{
								background: 'transparent',
								border: 'none',
								borderRadius: '4px',
								width: '22px',
								height: '22px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								cursor: 'pointer',
								color: 'var(--text-muted)',
								padding: 0,
								transition: 'background-color 0.15s ease'
							}}
							onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
							onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
							title="Previous month"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="18 15 12 9 6 15"></polyline>
							</svg>
						</button>
						<button
							onClick={() => setMiniMonth(addMonths(miniMonth, 1))}
							style={{
								background: 'transparent',
								border: 'none',
								borderRadius: '4px',
								width: '22px',
								height: '22px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								cursor: 'pointer',
								color: 'var(--text-muted)',
								padding: 0,
								transition: 'background-color 0.15s ease'
							}}
							onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
							onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
							title="Next month"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="6 9 12 15 18 9"></polyline>
							</svg>
						</button>
					</div>
				</div>

				{/* Weekdays */}
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '6px' }}>
					{weekDays.map(d => (
						<div key={d} style={{ height: '20px', lineHeight: '20px' }}>{d}</div>
					))}
				</div>

				{/* Days Grid */}
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', rowGap: '6px' }}>
					{days.map((day, i) => {
						const isCurrentMonth = isSameMonth(day, monthStart);
						const isSelected = isSameDay(day, currentDate);
						const isToday = isSameDay(day, nowInTz);
						const hasEvent = eventOccursOnDay(events, day);
						return (
							<div
								key={i}
								onClick={() => {
									setCurrentDate(day);
									setMiniMonth(day);
								}}
								style={{
									cursor: 'pointer',
									height: '26px',
									width: '26px',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									position: 'relative',
									borderRadius: '6px',
									fontSize: '12px',
									fontWeight: isSelected ? 600 : isToday ? 600 : 400,
									color: isSelected
										? (accentColor || 'var(--text-normal)')
										: isToday
											? (accentColor || 'var(--text-normal)')
											: isCurrentMonth
												? 'var(--text-normal)'
												: 'var(--text-faint)',
									// A whisper of the accent as a background wash: just enough to read
									// as "this day carries the accent", never a solid block of colour.
									background: isSelected
										? (accentColor ? hexToRgba(accentColor, ACCENT_CHIP_TINT_ALPHA) : 'var(--background-modifier-hover)')
										: 'transparent',
									border: !isSelected && isToday ? `1.5px solid ${accentColor || 'var(--background-modifier-border)'}` : '1.5px solid transparent',
									boxSizing: 'border-box',
									transition: 'background-color 0.12s ease',
									userSelect: 'none',
									margin: '0 auto'
								}}
								onMouseEnter={(e) => {
									if (!isSelected) {
										e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									}
								}}
								onMouseLeave={(e) => {
									if (!isSelected) {
										e.currentTarget.style.backgroundColor = 'transparent';
									}
								}}
								title={format(day, 'EEEE, MMMM d, yyyy')}
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

			{/* Divider between mini-calendar and todo list */}
			<div style={{ height: '1px', background: 'var(--background-modifier-border)', margin: '12px 2px 8px 2px' }} />

			{/* Drop Zone Area */}
			<div
				onDragOver={handleDragOver}
				onDrop={handleDrop}
				className="sidebar-drop-zone"
				style={{
					flex: 1,
					overflowY: 'auto',
					overflowX: 'hidden',
					overscrollBehavior: 'contain',
					display: 'flex',
					flexDirection: 'column',
					gap: '24px',
					padding: '0 2px'
				}}
			>
				{/* 0. Calendar Profiles. Profiles are calendar-wide, so they are managed
				    here in the default pane — an event only attaches one from the swatch
				    picker under its title. */}
				<div className="profile-creator-wrapper" style={{ display: 'block', width: '100%' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
						<span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-normal)', letterSpacing: '0.2px' }}>Calendar Profiles</span>
						<button
							type="button"
							className={`profile-select-btn ${profileCreatorOpen ? 'is-open' : ''}`}
							title="Calendar profiles"
							onClick={openProfileCreator}
						>
							+
						</button>
					</div>

					<div className="sidebar-profile-chips">
						{calendarProfiles.length === 0 ? (
							<span style={{ fontSize: '12.5px', color: 'var(--text-faint)' }}>No profiles yet</span>
						) : (
							calendarProfiles.map(p => (
								<span key={p.id} className="sidebar-profile-chip">
									<span className="sidebar-profile-chip-dot" style={{ background: profileHex(p) }} />
									{p.name}
								</span>
							))
						)}
					</div>

					{profileCreatorOpen && renderProfileCreator()}
				</div>

				{/* 1. Attach Notes Section */}
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
						<span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-normal)', letterSpacing: '0.2px' }}>Attach Notes</span>
					</div>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
						{notebookEvents.filter(t => !t.title.trim().startsWith('{')).sort((a, b) => {
							const isActiveA = timers?.some(t => t.todoId === a.id);
							const isActiveB = timers?.some(t => t.todoId === b.id);
							if (isActiveA !== isActiveB) return isActiveA ? -1 : 1;
							return 0;
						}).map((todo, index) => (
							<div
								key={todo.id}
								className="sidebar-todo-row"
								draggable
								onDragStart={(e) => handleItemDragStart(e, todo, 'notebook', index)}
								onDragOver={(e) => handleItemDragOver(e, 'notebook', index)}
								onDragEnd={handleItemDragEnd}
								style={{
									padding: '6px 8px',
									borderRadius: '6px',
									cursor: 'grab',
									display: 'flex',
									alignItems: 'flex-start',
									gap: '10px',
									width: '100%',
									minWidth: 0,
									boxSizing: 'border-box'
								}}
							>
								<span
									onClick={() => handleOpenNote(todo.link, todo.title)}
									style={{
										fontSize: '13px',
										fontWeight: 400,
										color: 'var(--text-normal)',
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
										cursor: 'pointer'
									}}
									title={todo.title}
								>
									{todo.title}
								</span>
								<button
									type="button"
									className="notebook-delete-btn"
									title="Delete attached note"
									onClick={(e) => {
										e.stopPropagation();
										handleDeleteNotebookEvent(todo.id);
									}}
									style={{
										background: 'transparent',
										border: 'none',
										cursor: 'pointer',
										padding: '4px',
										borderRadius: '4px',
										color: 'var(--text-muted)',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										marginLeft: 'auto',
										flexShrink: 0,
										marginTop: '1px',
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
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<polyline points="3 6 5 6 21 6"></polyline>
										<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
										<line x1="10" y1="11" x2="10" y2="17"></line>
										<line x1="14" y1="11" x2="14" y2="17"></line>
									</svg>
								</button>
							</div>
						))}
					</div>
				</div>

				{/* 2. To Do Section */}
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
						<span
							style={{
								fontSize: '14.5px',
								fontWeight: 600,
								color: 'var(--text-normal)',
								letterSpacing: '0.2px',
								display: 'flex',
								alignItems: 'center'
							}}
						>
							To Do
						</span>
						<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
							<button
								onClick={(e) => {
									e.stopPropagation();
									if (regularTodos.some(t => t.completed)) {
										handleClearCompletedRegularTodos();
									}
								}}
								title={regularTodos.some(t => t.completed) ? "Clear completed tasks" : "Clear completed tasks (none completed)"}
								style={{
									background: 'transparent',
									border: 'none',
									cursor: regularTodos.some(t => t.completed) ? 'pointer' : 'default',
									color: 'var(--text-muted)',
									padding: '3px 5px',
									borderRadius: '4px',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									lineHeight: 1,
									opacity: regularTodos.some(t => t.completed) ? 0.85 : 0.3,
									transition: 'all 0.15s ease'
								}}
								onMouseEnter={(e) => {
									if (regularTodos.some(t => t.completed)) {
										e.currentTarget.style.color = '#facc15';
										e.currentTarget.style.background = 'var(--background-modifier-hover)';
										e.currentTarget.style.opacity = '1';
									}
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.color = 'var(--text-muted)';
									e.currentTarget.style.background = 'transparent';
									e.currentTarget.style.opacity = regularTodos.some(t => t.completed) ? '0.85' : '0.3';
								}}
							>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							</button>
						</div>
					</div>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
						{/* Always visible blank input box as first line */}
						<div style={{ position: 'relative', width: '100%', padding: '2px 0 6px 0' }}>
							<input
								type="text"
								className={`todo-add-input ${newRegularTodoInput ? 'has-value' : ''}`}
								placeholder="Add a to-do..."
								value={newRegularTodoInput}
								onChange={(e) => setNewRegularTodoInput(e.target.value)}
								onFocus={() => setIsAddTodoFocused(true)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										handleAddRegularTodo();
										setIsAddTodoFocused(false);
									} else if (e.key === 'Escape') {
										setNewRegularTodoInput('');
										setIsAddTodoFocused(false);
									}
								}}
								onBlur={() => {
									setIsAddTodoFocused(false);
									if (newRegularTodoInput.trim()) {
										handleAddRegularTodo();
									}
								}}
								style={{
									backgroundColor: (isAddTodoFocused || Boolean(newRegularTodoInput))
										? 'var(--background-modifier-form-field)'
										: 'transparent',
									borderColor: (isAddTodoFocused || Boolean(newRegularTodoInput))
										? 'var(--background-modifier-border)'
										: 'transparent',
									borderWidth: '1px',
									borderStyle: 'solid',
									outline: 'none',
									boxShadow: 'none',
									width: '100%',
									padding: '6px 10px',
									fontSize: '13px',
									lineHeight: '1.45',
									borderRadius: '6px',
									color: 'var(--text-normal)',
									boxSizing: 'border-box'
								}}
							/>
						</div>

						{/* All existing to-do items listed below - completed items drop down to bottom */}
						{[...regularTodos.filter(t => !t.title.trim().startsWith('{'))].sort((a, b) => {
							const aCompleted = a.completed && !recentlyCompleted.has(a.id);
							const bCompleted = b.completed && !recentlyCompleted.has(b.id);
							if (aCompleted !== bCompleted) return Number(aCompleted) - Number(bCompleted);
							const isActiveA = timers?.some(t => t.todoId === a.id);
							const isActiveB = timers?.some(t => t.todoId === b.id);
							if (isActiveA !== isActiveB) return isActiveA ? -1 : 1;
							return 0;
						}).map((todo, index) => {
							// Each row's accent is derived from its id, so the color stays
							// identical when the list re-sorts (e.g. a completed item
							// dropping to the bottom). Rows in the timer column keep their
							// timer color instead.
							const rowAccent = accentColorForId(todo.id);
							const activeTimer = timers?.find(t => t.todoId === todo.id);
							// Resolved through the shared palette so every swatch a timer can
							// wear resolves. A local shortlist stood here before, and any name
							// missing from it left the circle both unfilled and unringed — the
							// row looked as though it had no checkbox at all.
							const timerAccent = activeTimer ? (resolveAccentHex(activeTimer.colorTheme) || undefined) : undefined;
							const checkboxAccent = timerAccent || rowAccent;
							return (
								<div
									key={todo.id}
									className="sidebar-todo-row"
									draggable={editingTodoId !== todo.id}
									onDragStart={(e) => handleItemDragStart(e, todo, 'regular', index)}
									onDragOver={(e) => handleItemDragOver(e, 'regular', index)}
									onDragEnd={handleItemDragEnd}
									style={{
										padding: '6px 8px',
										borderRadius: '6px',
										cursor: editingTodoId === todo.id ? 'default' : 'grab',
										display: 'flex',
										alignItems: 'flex-start',
										gap: '10px',
										width: '100%',
										minWidth: 0,
										boxSizing: 'border-box'
									}}
								>
									<div
										onClick={(e) => {
											e.stopPropagation();
											handleToggleRegularTodo(todo.id);
										}}
										style={{
											width: '18px',
											height: '18px',
											borderRadius: '50%',
											// Completed rows — and rows already sitting in the timer column —
											// render as a solid accent-filled circle with NO checkmark.
											border: (todo.completed || activeTimer) ? '1.5px solid transparent' : '1.5px solid var(--text-muted)',
											// A row in the timer column is a solid filled circle, so its fill
											// falls back to the row's own accent rather than to transparency:
											// there is no ring to fall back on, and an unfilled circle with a
											// transparent ring is nothing at all.
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
													handleEditRegularTodo(todo.id, editingTodoText);
													setEditingTodoId(null);
												} else if (e.key === 'Escape') {
													setEditingTodoId(null);
												}
											}}
											onBlur={() => {
												handleEditRegularTodo(todo.id, editingTodoText);
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
												setEditingTodoText(todo.title.replace(/\[\[|\]\]/g, ''));
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
											title={`${todo.title.replace(/\[\[|\]\]/g, '')} (Click to edit)`}
										>
											{todo.title.replace(/\[\[|\]\]/g, '')}
										</span>
									)}
									<span
										className="todo-delete-btn"
										title="Delete completely"
										onClick={(e) => {
											e.stopPropagation();
											handleDeleteRegularTodo(todo.id);
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
			</div>
		</div>
	);
};
