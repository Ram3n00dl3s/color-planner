import { createPortal } from 'react-dom';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { format, addDays, addMonths, differenceInCalendarDays, isSameDay } from 'date-fns';
import { DndContext, DragEndEvent, DragStartEvent, DragMoveEvent, CollisionDetection, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarEvent, EventTodo, TimerTile, CalendarProfile } from '../../types';
import { extractObsidianDoc } from '../../utils/dragDrop';
import { getNowInTimeZone } from '../../utils/timezone';
import { LocationMiniMap } from './LocationMiniMap';
import { NoteIcon } from './NoteIcon';
import { ShapesBackdrop } from './ShapesBackdrop';
import { DuplicateDropCalendar } from './DuplicateDropCalendar';
import { CalendarSettingsMenu } from './CalendarSettingsMenu';
import { MonthView } from './MonthView';
import { resolveAccentHex, DEFAULT_ACCENT_HEX, toneDownAccent } from '../../utils/colors';
import {
	clampDoodleShapeCount,
	clampDoodleShapeSize,
	clampDoodleShapeRotation,
	clampDoodleShapeStroke,
	clampDoodleShapeSpread
} from '../../utils/doodleBackground';

const snapTo15 = (date: Date) => {
	const ms = 1000 * 60 * 15;
	return new Date(Math.round(date.getTime() / ms) * ms);
};
import { TimerColumn } from "./TimerColumn";


const RECENT_COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'pink', 'teal'];
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

/**
	* Fixed size (px) of the corner "note" affordance on an event tile. It never
	* scales with the tile — the icon looks identical on every tile it appears on.
	*/
const NOTE_ICON_SIZE = 17;

/**
	* The note affordance is dropped entirely on tiles shorter than this, where it
	* would crowd the title/time. It is never shrunk to fit — it is simply omitted.
	*/
const NOTE_ICON_MIN_TILE_HEIGHT = 40;

/** The swatch colour of a calendar profile (a palette name or a raw hex). */
const profileHex = (profile?: CalendarProfile | null): string =>
	resolveAccentHex(profile?.color) || DEFAULT_ACCENT_HEX;

/** How many swatches the tile menu's quick row shows. It holds this length whatever
	the profiles withhold, so the row never opens up a gap. */
const QUICK_SWATCH_COUNT = RECENT_COLORS.length;

/** Does a swatch describe the colour a tile is already wearing? Matched exactly, or
	through the `pastel-` prefix the older palette used. A loose "contains" test was
	used here before, which let a `bluegrey` tile light up the `blue` swatch. */
const isCurrentSwatch = (name: string, colorTheme?: string): boolean =>
	colorTheme === name || colorTheme === `pastel-${name}`;

// Helper component for Draggable Event Block
const EventBlock = ({
	event,
	onResizeEnd,
	isSelected,
	onClick,
	pxPerHour,
	hasOverlap,
	overlapIndex = 0,
	overlapTotal = 1,
	onDropOnEvent,
	isStationaryClone,
	isDuplicating,
	onDelete,
	onUpdateEvent,
	onDuplicateEvent,
	dragTimes,
	isDraggingNow,
	collapsed,
	revealDelay = 0,
	justBegun,
	revealActive,
	showDetails = true,
	calendarProfiles = [],
	onResizeIndicator
}: {
	event: CalendarEvent,
	onResizeEnd: (id: string, newStart: Date, newEnd: Date) => void,
	isSelected: boolean,
	onClick: () => void,
	pxPerHour: number,
	hasOverlap?: boolean,
	overlapIndex?: number,
	overlapTotal?: number,
	onDropOnEvent?: (e: React.DragEvent, targetEvent: CalendarEvent) => void,
	isStationaryClone?: boolean,
	isDuplicating?: boolean,
	onDelete?: (id: string) => void,
	onUpdateEvent?: (updated: CalendarEvent) => void,
	onDuplicateEvent?: (event: CalendarEvent) => void,
	dragTimes?: { startTime: Date; endTime: Date } | null,
	isDraggingNow?: boolean,
	collapsed?: boolean,
	revealDelay?: number,
	justBegun?: boolean,
	/**
	 * True for a short beat after the grid changes shape (month ↔ days, or the
	 * number of days in view). One-shot: every tile then plays the same gentle
	 * drop-and-fade entrance a day-header click already uses, staggered into a
	 * soft wave by `revealDelay`.
	 */
	revealActive?: boolean,
	/**
	 * When false the tile renders only its title and time: no to-do items, no
	 * description lines. Driven by the "Show details on tiles" setting.
	 */
	showDetails?: boolean,
	/** Profiles offered in the tile's right-click menu. */
	calendarProfiles?: CalendarProfile[],
	/**
	 * While an edge-resize handle is dragged, reports the px offset (within the
	 * 24-hour scale) of the edge being moved so the grid can place its temporary
	 * timeline marker there: the tile's bottom for the end handle, its top for the
	 * start handle. `null` releases the marker back to the current time.
	 */
	onResizeIndicator?: (topPx: number | null) => void
}) => {
	const isDraft = event.id === 'draft';

	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: isStationaryClone ? `${event.id}-stationary-clone` : event.id,
		data: event,
		disabled: isDraft || Boolean(isStationaryClone),
	});

	const isCurrentlyMoving = (isDragging || Boolean(transform) || Boolean(isDraggingNow) || isDraft) && !isStationaryClone;

	const [isResizingTop, setIsResizingTop] = useState(false);
	const [isResizingBottom, setIsResizingBottom] = useState(false);
	const [resizeStartOffset, setResizeStartOffset] = useState<number>(0);
	const [resizeEndOffset, setResizeEndOffset] = useState<number>(0);
	const [isDocDragOver, setIsDocDragOver] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	const [showContextMenu, setShowContextMenu] = useState(false);
	// One-shot acknowledgement for a right-click: the tile gives the tiniest press
	// before the context menu appears. Toggled false → next frame true so repeated
	// right-clicks replay it.
	const [isContextPulsing, setIsContextPulsing] = useState(false);
	const [menuPos, setMenuPos] = useState<{ x: number; y: number; flippedX?: boolean; flippedY?: boolean }>({ x: 0, y: 0 });
	const [showColorPicker, setShowColorPicker] = useState(false);
	// Name of the calendar swatch under the pointer, shown in place of a
	// permanent "Calendar" label.
	const [hoveredProfileName, setHoveredProfileName] = useState<string | null>(null);

	// Attaching a profile also tints the tile with that profile's colour, exactly
	// like the picker under the event title; clicking the active one detaches it.
	const assignProfile = (profile: CalendarProfile) => {
		if (!onUpdateEvent) return;
		const isActive = event.profileId === profile.id;
		// Attaching a profile takes the tile's colour over, so a palette the user had
		// open is dismissed at the same moment — the swatch row locks with the attach.
		if (!isActive) setShowColorPicker(false);
		onUpdateEvent({
			...event,
			profileId: isActive ? undefined : profile.id,
			colorTheme: isActive ? event.colorTheme : profile.color
		});
	};

	const handleContextMenu = (e: React.MouseEvent) => {
		if (isDraft || isStationaryClone) return;
		e.preventDefault();
		e.stopPropagation();

		let menuX = e.clientX;
		let menuY = e.clientY;

		let flippedX = false;
		let flippedY = false;

		if (menuX + 230 > window.innerWidth - 10) {
			menuX = e.clientX - 230;
			flippedX = true;
		}
		if (menuY + 200 > window.innerHeight - 10) {
			menuY = e.clientY - 200;
			flippedY = true;
		}

		setMenuPos({ x: menuX, y: menuY, flippedX, flippedY });
		setShowColorPicker(false);
		setShowContextMenu(true);

		// Acknowledge the click with the smallest possible motion. Dropping the class
		// for one frame and re-adding it on the next restarts the keyframe, so a rapid
		// second right-click still plays the pulse afresh instead of sitting still.
		setIsContextPulsing(false);
		requestAnimationFrame(() => setIsContextPulsing(true));
	};

	useEffect(() => {
		if (!showContextMenu) return;
		const handleClose = () => setShowContextMenu(false);
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setShowContextMenu(false);
			} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
				e.preventDefault();
				setShowContextMenu(false);
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(event.title || 'Event');
				}
				try { (window as any).__sleek_copied_event = event; } catch { }
			} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
				e.preventDefault();
				setShowContextMenu(false);
				if (onDuplicateEvent) onDuplicateEvent(event);
			} else if (e.key === 'Backspace' || e.key === 'Delete') {
				e.preventDefault();
				setShowContextMenu(false);
				if (onDelete) onDelete(event.id);
			}
		};
		window.addEventListener('click', handleClose);
		window.addEventListener('pointerdown', handleClose);
		window.addEventListener('contextmenu', handleClose);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('click', handleClose);
			window.removeEventListener('pointerdown', handleClose);
			window.removeEventListener('contextmenu', handleClose);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [showContextMenu, event, onDuplicateEvent, onDelete]);

	// Plain hover only lifts the tile (see the z-index below); it no longer reveals
	// any floating control. Deleting is done through the right-click context menu.
	const handleMouseEnter = () => {
		if (isDraft || isStationaryClone || showContextMenu) return;
		setIsHovered(true);
	};

	const handleMouseLeave = () => {
		setIsHovered(false);
	};

	useEffect(() => {
		if (transform || isDuplicating) {
			setShowContextMenu(false);
		}
	}, [transform, isDuplicating]);

	const startY = useRef<number>(0);

	const minDurationHours = 0.5; // 30 minutes minimum
	const minDurationMs = 28 * 60 * 1000;
	const minHeight = minDurationHours * pxPerHour;
	const effectiveEndTimeMs = (
		(event.endTime.getHours() === 23 && event.endTime.getMinutes() === 59) ||
		(event.endTime.getHours() === 0 && event.endTime.getMinutes() === 0 && event.endTime.getDate() !== event.startTime.getDate())
	)
		? new Date(event.startTime).setHours(24, 0, 0, 0)
		: event.endTime.getTime();
	const durationHours = Math.max(minDurationHours, (effectiveEndTimeMs - event.startTime.getTime()) / (1000 * 60 * 60));
	const baseHeight = durationHours * pxPerHour;
	const baseTop = (event.startTime.getHours() + event.startTime.getMinutes() / 60) * pxPerHour;
	const currentTop = Math.max(0, baseTop + resizeStartOffset);

	// Subtract 8px to create a larger gap between vertically adjacent events
	const minTileHeight = Math.max(22, minHeight - 8);
	const rawHeight = Math.max(minTileHeight, baseHeight - resizeStartOffset + resizeEndOffset - 8);
	// Clamp height so the tile never protrudes past the bottom of the column / time scale (24 hours)
	const maxAllowedHeight = Math.max(minTileHeight, (24 * pxPerHour - 8) - currentTop);
	const currentHeight = Math.min(maxAllowedHeight, rawHeight);
	const isSmallTile = currentHeight < 40;

	let tileLeft = '3.5%';
	let tileWidth = '93%';
	let baseZIndex = 1;

	if (hasOverlap && overlapTotal > 1) {
		// Only changes size ONCE when overlapped: stays at a constant 87% width regardless of stack depth
		tileWidth = '87%';
		// Alternates position: even index pokes out to the right (9.5%), odd index pokes out to the left (3.5%)
		const isRight = overlapIndex % 2 === 0;
		tileLeft = isRight ? '9.5%' : '3.5%';
		baseZIndex = 2 + overlapIndex;
	}

	// Clamp drag transform so the tile visually cannot be dragged past 12 AM (column bottom) or before 12 AM (column top)
	let clampedTransform = transform;
	if (transform && !isStationaryClone) {
		const minY = -currentTop;
		const maxY = (24 * pxPerHour - 8) - (currentTop + currentHeight);
		clampedTransform = {
			...transform,
			y: Math.max(minY, Math.min(maxY, transform.y))
		};
	}

	const style = {
		transform: isStationaryClone ? undefined : CSS.Translate.toString(clampedTransform),
		height: `${currentHeight}px`,
		top: `${currentTop}px`,
		// Whole-day events are a backdrop: at rest they sit behind every timed
		// tile in the column. Transient interactions (drag / resize / draft) still
		// lift them so they stay usable, but hover/selection never do — otherwise
		// hovering the backdrop would hide the events stacked on top of it.
		zIndex: showContextMenu
			? 150
			: isResizingTop || isResizingBottom || (transform && !isStationaryClone) || isDraft
				? 25
				: event.isAllDay
					? 0
					: isSelected
						? 25
						: isHovered
							? 20
							: baseZIndex,
		opacity: isDraft ? 0.7 : isStationaryClone ? 0.9 : undefined,
		pointerEvents: isDraft ? 'none' : 'auto' as any,
	};

	const handleBottomResizeStart = (e: React.PointerEvent) => {
		if (isDraft) return;
		e.stopPropagation();
		setIsResizingBottom(true);
		startY.current = e.clientY;
		// Mark the edge about to move — the tile's bottom — the instant the handle is
		// grabbed, so the marker is already on the edge before the first pointer move.
		onResizeIndicator?.((event.endTime.getHours() + event.endTime.getMinutes() / 60) * pxPerHour);
		window.addEventListener('pointermove', handleBottomResizeMove);
		window.addEventListener('pointerup', handleBottomResizeEnd);
	};

	const handleBottomResizeMove = (e: PointerEvent) => {
		const delta = e.clientY - startY.current;
		const maxAllowedDelta = (24 * pxPerHour - 8) - (baseTop + baseHeight - 8);
		const appliedDelta = Math.min(maxAllowedDelta, Math.max(delta, minHeight - baseHeight));
		setResizeEndOffset(appliedDelta);
		// The marker rides the bottom edge, snapped exactly as the tile's own end is,
		// so the landing time can be read straight off the time scale.
		const newEndHours = (baseHeight + appliedDelta) / pxPerHour;
		let markedEnd = snapTo15(new Date(event.startTime.getTime() + newEndHours * 60 * 60 * 1000));
		const markedDayEnd = new Date(event.startTime);
		markedDayEnd.setHours(23, 59, 0, 0);
		if (markedEnd.getTime() >= markedDayEnd.getTime()) markedEnd = markedDayEnd;
		if (markedEnd.getTime() - event.startTime.getTime() < minDurationMs) {
			markedEnd = new Date(event.startTime.getTime() + 30 * 60 * 1000);
		}
		onResizeIndicator?.((markedEnd.getHours() + markedEnd.getMinutes() / 60) * pxPerHour);
	};

	const handleBottomResizeEnd = (e: PointerEvent) => {
		setIsResizingBottom(false);
		window.removeEventListener('pointermove', handleBottomResizeMove);
		window.removeEventListener('pointerup', handleBottomResizeEnd);
		onResizeIndicator?.(null);

		const deltaY = e.clientY - startY.current;
		const maxAllowedDelta = (24 * pxPerHour - 8) - (baseTop + baseHeight - 8);
		const appliedDelta = Math.min(maxAllowedDelta, Math.max(deltaY, minHeight - baseHeight));
		const newEndHours = (baseHeight + appliedDelta) / pxPerHour;
		let newEndTime = new Date(event.startTime.getTime() + newEndHours * 60 * 60 * 1000);
		newEndTime = snapTo15(newEndTime);

		const dayEnd = new Date(event.startTime);
		dayEnd.setHours(23, 59, 0, 0);
		if (newEndTime.getTime() >= dayEnd.getTime()) {
			newEndTime = dayEnd;
		}

		if (newEndTime.getTime() - event.startTime.getTime() < minDurationMs) {
			newEndTime = new Date(event.startTime.getTime() + 30 * 60 * 1000);
			if (newEndTime.getTime() > dayEnd.getTime()) {
				newEndTime = dayEnd;
			}
		}

		setResizeEndOffset(0);
		onResizeEnd(event.id, event.startTime, newEndTime);
	};

	const handleTopResizeStart = (e: React.PointerEvent) => {
		if (isDraft) return;
		e.stopPropagation();
		setIsResizingTop(true);
		startY.current = e.clientY;
		// Mirror of the bottom handle: the marker is placed on the tile's top edge.
		onResizeIndicator?.((event.startTime.getHours() + event.startTime.getMinutes() / 60) * pxPerHour);
		window.addEventListener('pointermove', handleTopResizeMove);
		window.addEventListener('pointerup', handleTopResizeEnd);
	};

	const handleTopResizeMove = (e: PointerEvent) => {
		const delta = e.clientY - startY.current;
		const maxDelta = baseHeight - minHeight;
		const minAllowedDelta = -baseTop;
		const appliedDelta = Math.max(minAllowedDelta, Math.min(delta, maxDelta));
		setResizeStartOffset(appliedDelta);
		// The marker rides the top edge, snapped exactly as the tile's own start is.
		const newStartHoursDelta = appliedDelta / pxPerHour;
		let markedStart = snapTo15(new Date(event.startTime.getTime() + newStartHoursDelta * 60 * 60 * 1000));
		const markedDayStart = new Date(event.startTime);
		markedDayStart.setHours(0, 0, 0, 0);
		if (markedStart.getTime() < markedDayStart.getTime()) markedStart = markedDayStart;
		if (event.endTime.getTime() - markedStart.getTime() < minDurationMs) {
			markedStart = new Date(event.endTime.getTime() - minDurationMs);
		}
		onResizeIndicator?.((markedStart.getHours() + markedStart.getMinutes() / 60) * pxPerHour);
	};

	const handleTopResizeEnd = (e: PointerEvent) => {
		setIsResizingTop(false);
		window.removeEventListener('pointermove', handleTopResizeMove);
		window.removeEventListener('pointerup', handleTopResizeEnd);
		onResizeIndicator?.(null);

		const deltaY = e.clientY - startY.current;
		const maxDelta = baseHeight - minHeight;
		const minAllowedDelta = -baseTop;
		const appliedDelta = Math.max(minAllowedDelta, Math.min(deltaY, maxDelta));

		const newStartHoursDelta = appliedDelta / pxPerHour;
		let newStartTime = new Date(event.startTime.getTime() + newStartHoursDelta * 60 * 60 * 1000);
		newStartTime = snapTo15(newStartTime);

		const dayStart = new Date(event.startTime);
		dayStart.setHours(0, 0, 0, 0);
		if (newStartTime.getTime() < dayStart.getTime()) {
			newStartTime = dayStart;
		}

		if (event.endTime.getTime() - newStartTime.getTime() < minDurationMs) {
			newStartTime = new Date(event.endTime.getTime() - minDurationMs);
			if (newStartTime.getTime() < dayStart.getTime()) {
				newStartTime = dayStart;
			}
		}

		setResizeStartOffset(0);
		onResizeEnd(event.id, newStartTime, event.endTime);
	};

	const handleDocDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'copy';
		if (!isDocDragOver) {
			setIsDocDragOver(true);
		}
	};

	const handleDocDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDocDragOver(false);
		}
	};

	const handleDocDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDocDragOver(false);
		if (onDropOnEvent) {
			onDropOnEvent(e, event);
		}
	};

	let displayStartTime = (dragTimes && !isStationaryClone)
		? dragTimes.startTime
		: isResizingTop
			? snapTo15(new Date(event.startTime.getTime() + (resizeStartOffset / pxPerHour) * 60 * 60 * 1000))
			: event.startTime;

	let displayEndTime = (dragTimes && !isStationaryClone)
		? dragTimes.endTime
		: isResizingBottom
			? snapTo15(new Date(event.endTime.getTime() + (resizeEndOffset / pxPerHour) * 60 * 60 * 1000))
			: event.endTime;

	if (displayEndTime.getTime() - displayStartTime.getTime() < minDurationMs) {
		if (isResizingTop) {
			displayStartTime = new Date(displayEndTime.getTime() - 30 * 60 * 1000);
		} else {
			displayEndTime = new Date(displayStartTime.getTime() + 30 * 60 * 1000);
		}
	}

	const currentDayEnd = new Date(displayStartTime);
	currentDayEnd.setHours(23, 59, 0, 0);
	if (displayEndTime.getTime() >= currentDayEnd.getTime()) {
		displayEndTime = currentDayEnd;
	}

	// Extract todos, linked notes, and clean typed description
	const { tileItems, cleanDescription } = useMemo(() => {
		const rawDesc = event.description || '';
		// Extract any legacy [[Note]] links that might be in description
		const legacyLinks = [...rawDesc.matchAll(/\[\[(.*?)\]\]/g)].map(m => m[1].split('|')[0].trim());
		const strippedDesc = rawDesc
			.replace(/(\s*[-*•]\s+(\[[ xX]\]\s+)?)?\[\[([^\]]+)\]\]\n?/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		const todoItems: { title: string; completed?: boolean }[] = (event.todos || []).map(t => ({
			title: t.title,
			completed: !!t.completed
		}));
		const linkedItems = (event.linkedNotes || [])
			.filter(n => !todoItems.some(t => t.title === n))
			.map(n => ({ title: n, completed: false }));
		const legacyItems = legacyLinks
			.filter(l => !todoItems.some(t => t.title === l) && !linkedItems.some(n => n.title === l))
			.map(l => ({ title: l, completed: false }));

		const allItems = [...todoItems, ...linkedItems, ...legacyItems].filter(t => Boolean(t.title));

		return {
			tileItems: allItems,
			cleanDescription: strippedDesc
		};
	}, [event.description, event.linkedNotes, event.todos]);

	// A calendar profile's colour is what identifies it on the grid, so those swatches
	// are withheld from the tile's own picker: a tile wears one of those colours by
	// attaching the profile, and never by picking the swatch here. One colour belongs
	// to one of the two settings, never to both — so the withholding is absolute, with
	// no exception for the colour the tile happens to be wearing. Attaching a profile
	// sets the tile to the profile's colour, and that colour must not then reappear as
	// a swatch in this row with a tick of its own.
	const claimedColors = useMemo(
		() => new Set(calendarProfiles.map(p => p.color).filter(Boolean) as string[]),
		[calendarProfiles]
	);

	// The quick row keeps its shape: whatever the profiles withhold is replaced from
	// the palette behind the droplet, taken in palette order and skipping anything
	// already in the row, so the row is never short and never leaves a gap between
	// swatches. Only if the palette itself ran out would the row show fewer.
	const recentColors = useMemo(() => {
		const row = RECENT_COLORS.filter(c => !claimedColors.has(c));
		for (const c of ALL_PALETTE_COLORS) {
			if (row.length >= QUICK_SWATCH_COUNT) break;
			if (claimedColors.has(c) || row.includes(c)) continue;
			row.push(c);
		}
		return row.slice(0, QUICK_SWATCH_COUNT);
	}, [claimedColors]);

	const paletteColors = useMemo(
		() => ALL_PALETTE_COLORS.filter(c => !claimedColors.has(c)),
		[claimedColors]
	);

	// Attaching a profile hands the tile's colour over to that profile, so while one is
	// attached the tile's own swatches are held shut: they dim, they stop responding,
	// and the droplet will not open the palette. Detaching the profile — clicking its
	// swatch again — hands the colour back and the row comes alive.
	const activeProfile = calendarProfiles.find(p => p.id === event.profileId) || null;
	const colorsLocked = Boolean(activeProfile);

	const allList = cleanDescription && tileItems.length > 0
		? [{ title: cleanDescription, completed: false }, ...tileItems]
		: tileItems;
	// "Show details on tiles" can switch the detail lines off entirely, which leaves
	// a tile with nothing but its title and time. Both the list and the description
	// below hang off this, so flipping it empties the whole detail block.
	const hasList = showDetails && allList.length > 0;

	// Calculate how many items fit based on tile height without compromising font size
	const availableHeight = currentHeight - 54; // tile top/bottom padding (16px) + title (~18px) + time (~15px) + divider (~5px)
	const maxListItems = availableHeight >= 15 ? Math.min(Math.floor(availableHeight / 17), 8) : 0;
	const visibleListItems = hasList && maxListItems > 0
		? allList.slice(0, maxListItems)
		: [];

	let descLineClamp = 0;
	if (showDetails && !hasList && cleanDescription) {
		if (currentHeight >= 145) descLineClamp = 4;
		else if (currentHeight >= 115) descLineClamp = 3;
		else if (currentHeight >= 90) descLineClamp = 2;
		else if (currentHeight >= 68) descLineClamp = 1;
	}

	// Location affordance shown whenever the event carries a location: a neutral
	// monochrome "map + pin" icon (never a picture, never a framed box). It is
	// purely decorative — it never represents the real address.
	const hasLocation = Boolean(event.location && event.location.trim());
	// Note affordance shown whenever the event has one or more linked notes
	// (linked from the event details, or created there). Same neutral treatment.
	const hasNote = Boolean(event.linkedNotes && event.linkedNotes.some(n => Boolean(n && n.trim())));
	const locationMapSize = currentHeight >= 110 ? 30 : currentHeight >= 76 ? 24 : currentHeight >= 54 ? 19 : 14;
	const smallLocationMapSize = currentHeight >= 24 ? 13 : 0;
	// The note affordance has a FIXED size (see NOTE_ICON_SIZE) so it looks the
	// same on every tile. On tiles too short to hold it alongside the title/time
	// it is omitted entirely rather than shrunk.
	const showNoteIcon = hasNote && !isSmallTile && currentHeight >= NOTE_ICON_MIN_TILE_HEIGHT;
	// The note and map icons share the bottom-right corner and are stacked in a
	// column (note above map) so they never overlap one another. Because they are
	// stacked, only the widest of the two needs to be reserved on the tile's
	// right-hand gutter — text never runs underneath either icon.
	const cornerIconSize = hasLocation && showNoteIcon
		? Math.max(locationMapSize, NOTE_ICON_SIZE)
		: showNoteIcon
			? NOTE_ICON_SIZE
			: locationMapSize;
	const locationRightPad = (hasLocation || showNoteIcon) && !isSmallTile ? cornerIconSize + 10 : 0;
	const isPast = event.endTime.getTime() < Date.now();

	// The view-shape reveal reuses the gentle entrance a day-header click already
	// plays when it drops a column's tiles back in (`tile-reveal` keyframes: a
	// 34px fall, a whisper of scale and a soft fade). It is suppressed while the
	// tile is in flight, is a stationary duplicate clone, or sits in a collapsed
	// column, so it can never fight the drag layer or the collapse motion — both of
	// which own the very same independent properties.
	const isRevealing = Boolean(revealActive && !justBegun && !isStationaryClone && !collapsed && !isCurrentlyMoving);

	// The opacity this tile settles to at rest, mirroring the stylesheet: past
	// events dim to 0.65, all-day tiles sit at 0.85, and a selected past event
	// lifts to 0.9. The reveal keyframes fade *to* this value (handed over as a
	// custom property) rather than to a flat 1, so a past tile no longer animates
	// up to full opacity and then snaps back down the instant it finishes.
	const restOpacity = event.isAllDay
		? 0.85
		: isPast
			? (isSelected && !isStationaryClone ? 0.9 : 0.65)
			: 1;

	return (
		<div
			ref={isStationaryClone ? undefined : setNodeRef}
			className={`placeholder-event event-${event.colorTheme} ${isSelected && !isStationaryClone ? 'selected' : ''} ${hasOverlap ? 'has-overlap' : ''} ${isDocDragOver ? 'doc-drop-target' : ''} ${isSmallTile ? 'small-tile' : ''} ${isCurrentlyMoving ? 'is-dragging-tile' : ''} ${isPast ? 'is-past-event' : ''} ${event.isAllDay ? 'is-allday-event' : ''} ${justBegun ? 'tile-begun' : ''} ${isRevealing ? 'tile-reveal' : ''} ${isContextPulsing ? 'context-pulse' : ''}`}
			style={{
				...style,
				['--sleek-tile-rest-opacity' as any]: restOpacity,
				width: tileWidth,
				left: tileLeft,
				position: 'absolute',
				// NOTE: use `??`, not `||` — an all-day tile legitimately has z-index 0,
				// which `|| undefined` would drop (falling back to DOM order).
				zIndex: showContextMenu ? 1200 : style?.zIndex,
				// Collapsing a column (day-header click) is animated with the independent
				// `translate`/`scale` properties instead of `transform`, because the drag
				// layer owns the inline `transform`. That lets tiles drift up out of view
				// and later drop back in without ever fighting a drag. `revealDelay`
				// staggers the tiles into a soft wave.
				translate: collapsed ? '0 -34px' : '0 0',
				scale: collapsed ? '0.97' : undefined,
				opacity: collapsed ? 0 : (isDraft ? 0.7 : isStationaryClone ? 0.9 : undefined),
				transition: transform && !isStationaryClone
					? 'none'
					: `translate 0.42s cubic-bezier(0.22, 1, 0.36, 1) ${revealDelay}ms, scale 0.42s cubic-bezier(0.22, 1, 0.36, 1) ${revealDelay}ms, opacity 0.3s ease ${revealDelay}ms, filter 0.15s ease, box-shadow 0.15s ease`,
				pointerEvents: isDraft || collapsed ? 'none' : undefined,
				cursor: isDuplicating ? 'copy' : undefined,
				padding: isSmallTile
					? '0 8px'
					: currentHeight < 54
						? `3px ${locationRightPad || 8}px 4px 8px`
						: currentHeight < 70
							? `5px ${locationRightPad || 8}px 5px 8px`
							: `8px ${locationRightPad || 10}px 8px 10px`,
				display: isSmallTile ? 'flex' : undefined,
				alignItems: isSmallTile ? 'center' : undefined,
				borderRadius: isSmallTile || currentHeight < 68 ? '6px' : undefined,
			}}
			{...(isStationaryClone ? {} : attributes)}
			onPointerDown={isStationaryClone ? undefined : () => onClick()}
			onContextMenu={handleContextMenu}
			onMouseEnter={isStationaryClone ? undefined : handleMouseEnter}
			onMouseLeave={isStationaryClone ? undefined : handleMouseLeave}
			onDragOver={isStationaryClone ? undefined : handleDocDragOver}
			onDragEnter={isStationaryClone ? undefined : handleDocDragOver}
			onDragLeave={isStationaryClone ? undefined : handleDocDragLeave}
			onDrop={isStationaryClone ? undefined : handleDocDrop}
		>
			{showContextMenu && !isDraft && !isStationaryClone && createPortal(
				<div
					className="event-context-menu"
					onPointerDown={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
					style={{
						position: 'absolute',
						left: `${menuPos.x}px`,
						top: `${menuPos.y}px`,
						zIndex: 1000,
						transformOrigin: menuPos.flippedX ? (menuPos.flippedY ? 'bottom right' : 'top right') : (menuPos.flippedY ? 'bottom left' : 'top left'),
						minWidth: '224px',
						background: 'rgba(28, 29, 32, 0.95)',
						backdropFilter: 'blur(20px)',
						WebkitBackdropFilter: 'blur(20px)',
						border: '1px solid rgba(255, 255, 255, 0.12)',
						borderRadius: '12px',
						boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3)',
						padding: '8px 6px',
						userSelect: 'none',
						display: 'flex',
						flexDirection: 'column',
						gap: '2px'
					}}
				>
					{/* Recent Colors Row with Swatch Selector as the last option. Holds the
					    colours no profile has claimed — see `claimedColors` above — topped up
					    from the palette so the row is always full. While a profile is attached
					    the whole row is held shut: the tile's colour belongs to it then. */}
					<div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', padding: '4px 6px 8px 6px' }}>
						{recentColors.map(c => {
							const isSelected = isCurrentSwatch(c, event.colorTheme);
							const lockTitle = 'Detach the calendar profile to choose a colour';
							return (
								<div
									key={c}
									className={`event-${c}`}
									onClick={(e) => {
										e.stopPropagation();
										if (colorsLocked || !onUpdateEvent) return;
										onUpdateEvent({ ...event, colorTheme: c });
									}}
									title={colorsLocked ? `${c} — ${lockTitle}` : c}
									style={{
										width: '20px',
										height: '20px',
										borderRadius: '50%',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										cursor: colorsLocked ? 'default' : 'pointer',
										opacity: colorsLocked ? 0.3 : 1,
										border: isSelected ? '2px solid var(--text-normal, #ffffff)' : '2px solid transparent',
										boxShadow: isSelected ? '0 0 0 1px rgba(0, 0, 0, 0.45)' : 'none',
										boxSizing: 'border-box',
										transition: 'transform 0.12s ease, border-color 0.12s ease, opacity 0.15s ease',
										flexShrink: 0
									}}
									onMouseEnter={(e) => { if (!colorsLocked) e.currentTarget.style.transform = 'scale(1.15)'; }}
									onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
								>
									{isSelected && (
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="20 6 9 17 4 12"></polyline>
										</svg>)}
								</div>
							);
						})}

						{/* Swatch selector: opens the full color palette */}
						<div
							className="color-picker-wrapper"
							style={{
								position: 'relative',
								width: '22px',
								height: '22px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}}
						>
							<button
								type="button"
								className={`more-colors-btn ${showColorPicker ? 'active' : ''}`}
								title={colorsLocked ? 'Detach the calendar profile to choose a colour' : 'More colors'}
								disabled={colorsLocked}
								onClick={(e) => {
									e.stopPropagation();
									setShowColorPicker(prev => !prev);
								}}
								style={{
									width: '26px',
									height: '26px',
									cursor: colorsLocked ? 'default' : 'pointer',
									opacity: colorsLocked ? 0.3 : 1,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									boxSizing: 'border-box',
									padding: 0,
									outline: 'none',
									boxShadow: 'none',
									background: 'transparent',
									border: 'none',
									transition: 'color 0.15s ease, opacity 0.15s ease'
								}}
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									style={{
										color: (showColorPicker || !recentColors.includes(event.colorTheme || '')) ? 'var(--text-normal, #ffffff)' : 'var(--text-muted, rgba(255, 255, 255, 0.6))',
										pointerEvents: 'none'
									}}
								>
									<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
								</svg>
							</button>

							{showColorPicker && !colorsLocked && (
								<div
									className="color-palette-popover"
									onClick={(e) => e.stopPropagation()}
									style={{
										position: 'absolute',
										right: 0,
										top: menuPos.flippedY ? 'auto' : 'calc(100% + 10px)',
										bottom: menuPos.flippedY ? 'calc(100% + 10px)' : 'auto',
										zIndex: 1500,
										background: 'rgba(28, 29, 32, 0.98)',
										backdropFilter: 'blur(20px)',
										WebkitBackdropFilter: 'blur(20px)',
										border: '1px solid rgba(255, 255, 255, 0.12)',
										borderRadius: '10px',
										padding: '10px',
										boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
										width: '162px',
										maxHeight: '162px',
										overflowY: 'auto',
										overflowX: 'hidden',
										display: 'grid',
										gridTemplateColumns: 'repeat(5, 1fr)',
										justifyItems: 'center',
										alignItems: 'center',
										gap: '6px',
										boxSizing: 'border-box'
									}}
								>
									{paletteColors.map(c => {
										const isSelected = event.colorTheme === c;
										return (
											<div
												key={c}
												className={`event-${c}`}
												title={c.replace('-', ' ')}
												onClick={(e) => {
													e.stopPropagation();
													if (onUpdateEvent) {
														onUpdateEvent({ ...event, colorTheme: c });
													}
													setShowColorPicker(false);
													setShowContextMenu(false);
												}}
												style={{
													width: '22px',
													height: '22px',
													borderRadius: '50%',
													cursor: 'pointer',
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													boxSizing: 'border-box',
													border: isSelected ? '2px solid var(--text-normal, #ffffff)' : '1px solid rgba(0, 0, 0, 0.2)',
													position: 'relative'
												}}
											>
												{isSelected && (
													<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(0, 0, 0, 0.8)' }}>
														<polyline points="20 6 9 17 4 12"></polyline>
													</svg>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>

					{/* Divider between the tile's colours and the calendar profiles. */}
					{calendarProfiles.length > 0 && (
						<div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 4px 2px 4px' }} />
					)}

					{/* Calendar profile — the same picker that sits under the event title in the
					    right pane, offered here too. The swatches run left to right; beneath them
					    sits the "Profile" label and, under that, the name of whichever swatch the
					    pointer is on. Click a profile to attach it (the tile also adopts its
					    colour); click the active one again to detach it, so no separate clear
					    button is needed. The row stays hidden until at least one profile exists,
					    and the swatches are squares, matching the right pane. */}
					{calendarProfiles.length > 0 && (
						<div
							onMouseOver={(e) => {
								const chip = (e.target as HTMLElement).closest('[data-profile-name]');
								setHoveredProfileName(chip ? chip.getAttribute('data-profile-name') : null);
							}}
							onMouseLeave={() => setHoveredProfileName(null)}
							style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0px', padding: '2px 8px 0 8px' }}
						>
							{/* The swatch row: squares that match the right pane, running left to
							    right. The "Profile" label and the hovered name sit beneath it — see
							    the caption below. */}
							<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', flexWrap: 'wrap' }}>
								{calendarProfiles.map(p => {
									const isActive = event.profileId === p.id;
									return (
										/* The chosen swatch is marked by its tick alone: no ring or border is drawn
										   around the colour, so nothing about its size or shape moves. */
										<div
											key={p.id}
											data-profile-name={p.name}
											title={isActive ? `${p.name} — click again to detach` : `${p.name} — click to attach`}
											onClick={(e) => { e.stopPropagation(); assignProfile(p); }}
											style={{
												width: '20px',
												height: '20px',
												borderRadius: '4px',
												background: profileHex(p),
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												cursor: 'pointer',
												boxSizing: 'border-box',
												transition: 'transform 0.12s ease',
												flexShrink: 0
											}}
											onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
											onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
										>
											{isActive && (
												<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 0, 0, 0.8)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
													<polyline points="20 6 9 17 4 12"></polyline>
												</svg>
											)}
										</div>
									);
								})}
							</div>
							{/* The label sits beneath the swatches and shares its ink and size with
							    the caption that names a swatch on hover, so the two read as one
							    voice: "Profile", and directly under it the name the pointer is on.
							    Both ride an identical 16px line box, and the caption's line is always
							    present — empty when nothing is hovered — so the menu never grows or
							    jumps as the pointer moves across. The group carries no bottom padding
							    of its own, so the divider below lands right under the caption with
							    nothing between them but that reserved line. */}
							<div style={{ fontSize: '12px', lineHeight: '16px', marginTop: '6px', color: 'var(--text-muted, rgba(255, 255, 255, 0.6))' }}>
								Profile
							</div>
							<div
								style={{ width: '100%', height: '16px', lineHeight: '16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted, rgba(255, 255, 255, 0.6))', pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
							>
								{hoveredProfileName || ''}
							</div>
						</div>
					)}

					{/* Divider */}
					<div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '0 4px 4px 4px' }} />

					{/* Copy */}
					<div
						className="event-context-menu-item"
						onClick={(e) => {
							e.stopPropagation();
							setShowContextMenu(false);
							if (navigator.clipboard && navigator.clipboard.writeText) {
								navigator.clipboard.writeText(event.title || 'Event');
							}
							try {
								(window as any).__sleek_copied_event = event;
							} catch { }
						}}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '6px 8px',
							borderRadius: '6px',
							cursor: 'pointer',
							fontSize: '13px',
							color: 'var(--text-normal, #e2e8f0)',
							transition: 'background-color 0.1s ease'
						}}
						onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
						onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
							</svg>
							<span>Copy</span>
						</div>
						<span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>⌘ C</span>
					</div>

					{/* Duplicate */}
					<div
						className="event-context-menu-item"
						onClick={(e) => {
							e.stopPropagation();
							setShowContextMenu(false);
							if (onDuplicateEvent) {
								onDuplicateEvent(event);
							}
						}}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '6px 8px',
							borderRadius: '6px',
							cursor: 'pointer',
							fontSize: '13px',
							color: 'var(--text-normal, #e2e8f0)',
							transition: 'background-color 0.1s ease'
						}}
						onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
						onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<rect x="4" y="4" width="16" height="16" rx="2"></rect>
								<line x1="12" y1="9" x2="12" y2="15"></line>
								<line x1="9" y1="12" x2="15" y2="12"></line>
							</svg>
							<span>Duplicate</span>
						</div>
						<span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>⌘ D</span>
					</div>

					{/* Divider */}
					<div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 4px' }} />

					{/* Delete */}
					{onDelete && (
						<div
							className="event-context-menu-item"
							onClick={(e) => {
								e.stopPropagation();
								setShowContextMenu(false);
								onDelete(event.id);
							}}
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: '6px 8px',
								borderRadius: '6px',
								cursor: 'pointer',
								fontSize: '13px',
								color: 'var(--text-normal, #e2e8f0)',
								transition: 'background-color 0.1s ease'
							}}
							onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
							onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="3 6 5 6 21 6"></polyline>
									<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
								</svg>
								<span>Delete</span>
							</div>
							<span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>delete</span>
						</div>
					)}
				</div>, document.body
			)}

			{!isStationaryClone && (
				<div
					className="resize-handle top"
					onPointerDown={handleTopResizeStart}
					style={{ position: 'absolute', top: 0, left: 0, right: 0, height: isSmallTile ? '5px' : '8px', cursor: 'ns-resize', zIndex: 10 }}
				/>
			)}
			{(hasLocation || showNoteIcon) && !isSmallTile && (
				<div
					className="event-tile-icons"
					style={{
						position: 'absolute',
						bottom: '6px',
						right: '6px',
						zIndex: 20,
						lineHeight: 0,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '4px',
						opacity: 1,
						pointerEvents: 'none'
					}}
				>
					{/* The note sits above the map so the two corner affordances
					    never overlap one another when an event carries both. */}
					{showNoteIcon && (
						<div
							className="event-note-icon"
							style={{ lineHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
						>
							<NoteIcon size={NOTE_ICON_SIZE} />
						</div>
					)}
					{hasLocation && (
						<div
							className="event-location-map"
							style={{ lineHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
						>
							<LocationMiniMap size={locationMapSize} />
						</div>
					)}
				</div>
			)}
			<div
				className={`event-content ${isSmallTile ? 'small-tile-content' : ''} ${event.isAllDay && !isSmallTile ? 'all-day-content' : ''}`}
				{...(isStationaryClone ? {} : listeners)}
				style={{
					// A whole-day tile spans the entire day, so its title would scroll
					// far out of sight. `.all-day-content` pins this block to the top of
					// the visible area with `position: sticky`; that needs a
					// content-sized block rather than one stretched to fill the tile.
					height: event.isAllDay && !isSmallTile ? 'auto' : '100%',
					// No hand on plain hover: the cursor stays the default arrow until a
					// drag is actually under way, at which point it becomes a hand.
					// (Cmd/Ctrl-duplicating still shows the copy cursor.)
					cursor: isDraft || isStationaryClone
						? 'default'
						: isDuplicating
							? 'copy'
							: isCurrentlyMoving
								? 'grabbing'
								: 'default',
					display: 'flex',
					flexDirection: isSmallTile ? 'row' : 'column',
					alignItems: isSmallTile ? 'center' : undefined,
					justifyContent: isSmallTile ? 'space-between' : undefined,
					gap: isSmallTile ? '6px' : currentHeight < 68 ? '1px' : '2px',
					width: '100%',
					overflow: 'hidden'
				}}
			>
				{isDuplicating && (
					<div
						className="event-duplicate-badge"
						style={{
							position: 'absolute',
							top: isSmallTile ? '2px' : '5px',
							right: isSmallTile ? '2px' : '5px',
							backgroundColor: '#3b82f6',
							color: '#ffffff',
							borderRadius: '50%',
							width: isSmallTile ? '14px' : '18px',
							height: isSmallTile ? '14px' : '18px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: isSmallTile ? '10px' : '13px',
							fontWeight: 700,
							lineHeight: 1,
							boxShadow: '0 2px 5px rgba(0, 0, 0, 0.4)',
							zIndex: 35,
							pointerEvents: 'none',
							userSelect: 'none'
						}}
						title="Duplicating"
					>
						+
					</div>
				)}

				{isSmallTile ? (
					<>
						<span
							className="event-title"
							style={{
								fontSize: '13px',
								fontWeight: 600,
								lineHeight: 1.15,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								display: 'block',
								WebkitLineClamp: 'unset',
								WebkitBoxOrient: 'unset',
								flex: 1,
								minWidth: 0,
								margin: 0
							}}
						>
							{event.title || 'Event'}
						</span>
						<span
							className="event-time"
							style={{
								fontSize: '12px',
								fontWeight: 500,
								lineHeight: 1.15,
								whiteSpace: 'nowrap',
								flexShrink: 0,
								marginLeft: 'auto',
								marginTop: 0,
								opacity: 0.85,
								display: 'inline-block'
							}}
						>
							{event.isAllDay ? 'All Day' : format(displayStartTime, 'h:mm a')}
						</span>
						{hasLocation && smallLocationMapSize > 0 && (
							<span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginLeft: '4px' }}>
								<LocationMiniMap size={smallLocationMapSize} />
							</span>
						)}
					</>
				) : (
					<>
						<div
							className="event-title"
							style={currentHeight < 68 ? {
								WebkitLineClamp: 1,
								lineHeight: 1.18,
								fontSize: '14px',
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							} : {}}
						>
							{event.title || 'Event'}
						</div>
						<div
							className="event-time"
							style={currentHeight < 68 ? {
								marginTop: 0,
								lineHeight: 1.18,
								fontSize: '12.5px',
								whiteSpace: 'nowrap',
								flexWrap: 'nowrap'
							} : {}}
						>
							{event.isAllDay ? (
								<span>All Day</span>
							) : (
								<>
									<span>{format(displayStartTime, 'h:mm a')}</span>
									<span style={{ opacity: 0.6 }}>–</span>
									<span>{format(displayEndTime, 'h:mm a')}</span>
								</>
							)}
						</div>
						{((hasList && visibleListItems.length > 0) || (!hasList && descLineClamp > 0 && cleanDescription)) && (
							<div className="event-tile-divider" />
						)}

						{hasList && visibleListItems.length > 0 && (
							<div className="event-todo-list">
								{visibleListItems.map((item, idx) => {
									const isLast = idx === visibleListItems.length - 1;
									const hasMore = allList.length > visibleListItems.length;
									return (
										<div key={idx} className="event-todo-item" title={item.title}>
											<span
												className="event-todo-text"
												style={{
													textDecoration: item.completed ? 'line-through' : 'none',
													opacity: item.completed ? 0.45 : 0.85
												}}
											>
												{item.title}{isLast && hasMore ? ' ...' : ''}
											</span>
										</div>
									);
								})}
							</div>
						)}

						{!hasList && descLineClamp > 0 && cleanDescription && (
							<div
								className="event-description"
								style={{ WebkitLineClamp: descLineClamp }}
							>
								{cleanDescription}
							</div>
						)}

					</>
				)}
			</div>

			{!isStationaryClone && (
				<div
					className="resize-handle bottom"
					onPointerDown={handleBottomResizeStart}
					style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: isSmallTile ? '5px' : '8px', cursor: 'ns-resize', zIndex: 10 }}
				/>
			)}

		</div>
	);
};

const DayColumn = ({
	day,
	events,
	onResizeEnd,
	onBackgroundPointerDown,
	onEventClick,
	selectedEventId,
	pxPerHour,
	onNativeDrop,
	onDropOnEvent,
	activeDragId,
	isDuplicatingNow,
	onDeleteEvent,
	onUpdateEvent,
	onDuplicateEvent,
	draggingEventTimes,
	collapsed,
	begunEventIds,
	revealActive,
	showTileDetails,
	calendarProfiles,
	onResizeIndicator
}: {
	day: Date,
	events: CalendarEvent[],
	onResizeEnd: (id: string, s: Date, e: Date) => void,
	onBackgroundPointerDown: (e: React.PointerEvent, day: Date) => void,
	onEventClick: (e: CalendarEvent) => void,
	selectedEventId?: string,
	pxPerHour: number,
	onNativeDrop: (e: React.DragEvent, day: Date) => void,
	onDropOnEvent: (e: React.DragEvent, targetEvent: CalendarEvent) => void,
	activeDragId?: string | null,
	isDuplicatingNow?: boolean,
	onDeleteEvent?: (id: string) => void,
	onUpdateEvent?: (updated: CalendarEvent) => void,
	onDuplicateEvent?: (event: CalendarEvent) => void,
	draggingEventTimes?: { id: string; startTime: Date; endTime: Date } | null,
	collapsed?: boolean,
	begunEventIds?: Record<string, boolean>,
	/** Forwarded to each tile: true for a beat after the grid changes shape. */
	revealActive?: boolean,
	/** Forwarded to each tile: false hides the to-do/description lines. */
	showTileDetails?: boolean,
	/** Forwarded to each tile for its right-click profile picker. */
	calendarProfiles?: CalendarProfile[],
	/** Forwarded to each tile so an edge-resize can place the grid's edge marker. */
	onResizeIndicator?: (topPx: number | null) => void
}) => {
	const { setNodeRef, isOver } = useDroppable({
		id: day.toISOString(),
		data: { date: day }
	});

	const checkOverlap = (e1: CalendarEvent) => {
		return events.some(e2 =>
			e2.id !== e1.id &&
			e1.startTime.getTime() < e2.endTime.getTime() &&
			e1.endTime.getTime() > e2.startTime.getTime()
		);
	};

	// The layout a tile gets when it shares no stack: full width, flush left.
	const LONE_TILE_LAYOUT = { hasOverlap: false, overlapIndex: 0, overlapTotal: 1 };

	// Group events on this day into connected clusters of overlapping events. Kept as a
	// helper because the pass has to be run twice while a tile is held (see below).
	const computeEventLayout = (list: CalendarEvent[]) => {
		const layoutMap = new Map<string, { hasOverlap: boolean; overlapIndex: number; overlapTotal: number }>();
		// A day holding fewer than two events cannot contain an overlap at all, so the
		// O(n²) sweep is skipped outright. This matters while a drag is live, where the
		// pass runs a second time on every snapped step.
		if (list.length < 2) return layoutMap;
		const visited = new Set<string>();

		list.forEach(event => {
			if (visited.has(event.id)) return;

			const cluster: CalendarEvent[] = [];
			const queue = [event];
			visited.add(event.id);

			while (queue.length > 0) {
				const curr = queue.shift()!;
				cluster.push(curr);

				list.forEach(candidate => {
					if (!visited.has(candidate.id)) {
						const overlaps = (
							candidate.startTime.getTime() < curr.endTime.getTime() &&
							candidate.endTime.getTime() > curr.startTime.getTime()
						);
						if (overlaps) {
							visited.add(candidate.id);
							queue.push(candidate);
						}
					}
				});
			}

			// Sort cluster chronologically: earliest start time is bottom-most (index 0)
			cluster.sort((a, b) => {
				const diff = a.startTime.getTime() - b.startTime.getTime();
				if (diff !== 0) return diff;
				return a.endTime.getTime() - b.endTime.getTime();
			});

			const total = cluster.length;
			const hasOverlap = total > 1;
			cluster.forEach((ev, idx) => {
				layoutMap.set(ev.id, {
					hasOverlap,
					overlapIndex: idx,
					overlapTotal: total
				});
			});
		});

		return layoutMap;
	};

	const eventLayoutMap = computeEventLayout(events);
	// The pass the resting tiles are actually laid out from: the tile under the pointer is
	// left out of it entirely. It is that tile which must not disturb the day it floats
	// over, and this is what stops it — an edge-hold page step re-homes it onto the day it
	// would land on, and if it joined that day's stack it would shove those tiles sideways
	// and repaint their shadows, which is exactly the "reacting" the resting tiles did.
	const restingLayoutMap = activeDragId
		? computeEventLayout(events.filter(e => e.id !== activeDragId))
		: eventLayoutMap;

	// Lifts the column that carries the tile in flight — dragged, or re-homed onto its
	// landing day by an edge-hold page step. Every day column is its own stacking
	// context, so without this a neighbouring column would paint straight over the tile
	// the moment the drag translates it across a column boundary.
	const holdsFlight = Boolean(activeDragId && events.some(e => e.id === activeDragId));

	return (
		<div
			ref={setNodeRef}
			className={`day-column${collapsed ? ' day-column--collapsed' : ''}${holdsFlight ? ' day-column--flight' : ''}`}
			style={{ flex: 1, height: '100%', minHeight: `${24 * pxPerHour}px`, position: 'relative' }}
			onPointerDown={(e) => onBackgroundPointerDown(e, day)}
			onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
			onDrop={(e) => onNativeDrop(e, day)}
		>
			{events.map((event, eventIdx) => {
				const isThisEventInFlight = event.id === activeDragId;
				// The tile in flight is always drawn as a lone tile, never as a member of a
				// stack: its geometry is then settled for the whole hold, so nothing about it
				// can shift or flicker as the pointer travels across the tiles beneath it.
				const restingLayout = isThisEventInFlight
					? LONE_TILE_LAYOUT
					: (restingLayoutMap.get(event.id) || LONE_TILE_LAYOUT);
				// The duplicate gesture leaves a motionless copy of the original behind, and
				// that copy has to keep the stack exactly as the user last saw it — so it
				// reads the pass that still counts the tile being carried away.
				const stackedLayout = eventLayoutMap.get(event.id) || LONE_TILE_LAYOUT;
				const isThisEventActiveAndDuplicating = Boolean(isDuplicatingNow && event.id === activeDragId);
				// Small per-tile step so collapsing/revealing reads as a soft wave rather
				// than every tile snapping at once. Capped so a busy day never waits long.
				const revealDelay = Math.min(eventIdx, 14) * 24;
				// A brand-new tile gets a one-shot springy "begin" bounce (CSS keyframes).
				const justBegun = Boolean(begunEventIds && begunEventIds[event.id]);
				return (
					<React.Fragment key={event.id}>
						{isThisEventActiveAndDuplicating && (
							<EventBlock
								key={`${event.id}-stationary-clone`}
								event={event}
								onResizeEnd={() => { }}
								isSelected={false}
								onClick={() => { }}
								pxPerHour={pxPerHour}
								hasOverlap={stackedLayout.hasOverlap}
								overlapIndex={stackedLayout.overlapIndex}
								overlapTotal={stackedLayout.overlapTotal}
								isStationaryClone={true}
								collapsed={collapsed}
								showDetails={showTileDetails !== false}
								calendarProfiles={calendarProfiles}
								onResizeIndicator={onResizeIndicator}
							/>
						)}

						<EventBlock
							key={event.id}
							event={event}
							onResizeEnd={onResizeEnd}
							isSelected={event.id === selectedEventId}
							onClick={() => onEventClick(event)}
							pxPerHour={pxPerHour}
							hasOverlap={restingLayout.hasOverlap}
							overlapIndex={restingLayout.overlapIndex}
							overlapTotal={restingLayout.overlapTotal}
							onDropOnEvent={onDropOnEvent}
							isDuplicating={isThisEventActiveAndDuplicating}
							onDelete={onDeleteEvent}
							onUpdateEvent={onUpdateEvent}
							onDuplicateEvent={onDuplicateEvent}
							dragTimes={draggingEventTimes?.id === event.id ? draggingEventTimes : null}
							isDraggingNow={activeDragId === event.id}
							collapsed={collapsed}
							revealDelay={revealDelay}
							justBegun={justBegun}
							revealActive={revealActive}
							showDetails={showTileDetails !== false}
							calendarProfiles={calendarProfiles}
							onResizeIndicator={onResizeIndicator}
						/>
					</React.Fragment>
				);
			})}
		</div>
	);
};


class MainErrorBoundary extends React.Component<{ children: any }, { error: any }> {
	constructor(props: any) {
		super(props);
		this.state = { error: null };
	}
	static getDerivedStateFromError(error: any) {
		return { error };
	}
	render() {
		if (this.state.error) {
			return <div style={{ color: 'red', padding: 20 }}><h1>MainGrid Crash!</h1><pre>{this.state.error.toString()}\n{this.state.error.stack}</pre></div>;
		}
		return this.props.children;
	}
}

export const MainGrid = ({
	events,
	setEvents,
	timers,
	setTimers,
	accentColor,
	timeZone,
	plugin,
	currentDate,
	onCreateEvent,
	onEventSelect,
	selectedEventId,
	externalUpdatedEvent,
	externalDeletedEventId,
	onEventModified,
	onEventDelete,
	onNavigate,
	onTodoDrop,
	onSelectDate,
	onViewModeChange,
	hiddenProfileIds
}: {
	events: CalendarEvent[],
	setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>,
	timers: any[],
	setTimers: React.Dispatch<React.SetStateAction<any[]>>,
	accentColor?: string | null,
	timeZone?: string,
	plugin: any,
	currentDate: Date,
	onCreateEvent: () => void,
	onEventSelect: (e: CalendarEvent) => void,
	selectedEventId?: string,
	externalUpdatedEvent?: CalendarEvent | null,
	externalDeletedEventId?: string | null,
	onEventModified?: (e: CalendarEvent) => void,
	onEventDelete?: (id: string) => void,
	onNavigate?: (direction: 'prev' | 'next' | 'today') => void,
	onTodoDrop?: (todo: any, date: Date, y: number) => void,
	/**
	 * Moves the grid's visible window onto the given day. The window always begins
	 * at `currentDate`, so selecting a day makes it the grid's first column.
	 */
	onSelectDate?: (date: Date) => void,
	/**
	 * Reports which shape the grid is showing. The host uses it to park the right
	 * pane on its default view for as long as the full month is on screen.
	 */
	onViewModeChange?: (mode: 'days' | 'month') => void,
	/**
	 * Profile ids the user has switched off from the default right pane. Events
	 * carrying one of these ids are simply not rendered — the underlying event
	 * list is never touched, so flipping a profile back on restores its tiles.
	 */
	hiddenProfileIds?: Set<string>
}) => {
	const [daysToView, setDaysToView] = useState<number>(plugin?.settings?.daysToView || 5);
	// Which shape the calendar is showing: the sliding day columns ('days') or the
	// full-month grid ('month'). Persisted so the calendar reopens as the user left it.
	const [viewMode, setViewMode] = useState<'days' | 'month'>(plugin?.settings?.viewMode === 'month' ? 'month' : 'days');
	// Month-view day colours the user has set by hand, keyed by `YYYY-M-D`. A day
	// with no entry falls back to the default colour or, when it carries events, to
	// the colour the month already settled on (see [`MonthView`](src/react/components/MonthView.tsx)).
	const [monthDayColors, setMonthDayColors] = useState<Record<string, string>>(
		() => ({ ...(plugin?.settings?.monthDayColors || {}) })
	);
	// The automatic colours the month view has already settled on, keyed by `YYYY-M-D`.
	// Decided once per month and then frozen here, so a day added later never repaints
	// the days already on screen.
	const [monthAutoDayColors, setMonthAutoDayColors] = useState<Record<string, string>>(
		() => ({ ...(plugin?.settings?.monthAutoDayColors || {}) })
	);
	// In-calendar settings menu, opened from the gear in the grid header. It renders
	// in a portal, so it is never clipped by the grid's scroll areas.
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null);
	const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
	const openSettings = () => {
		const rect = settingsBtnRef.current?.getBoundingClientRect();
		if (rect) setSettingsAnchor(rect);
		setSettingsOpen(prev => !prev);
	};
	// Every brand-new tile is born in the user's "default swatch" (chosen in the
	// profile creator in the default right pane). Falls back to the colour new
	// events have always used when the user has never picked one.
	const defaultEventColor: string = plugin?.settings?.defaultEventColor || 'pastel-blue';
	// Whether tiles print their to-do items / description. Treated as on unless the
	// user has explicitly turned it off, so existing installs are unaffected.
	const showTileDetails: boolean = plugin?.settings?.showTileDetails !== false;
	// The visible window always begins at the selected day (`currentDate`) rather
	// than being snapped to the start of the week, so whatever the number of days
	// in view the grid starts on that day. Clicking "Today" in the header therefore
	// always lands with today as the first column, and the ‹ › arrows slide the
	// whole window one day at a time.
	const startDate = currentDate;

	useEffect(() => {
		if (plugin && plugin.settings.daysToView !== daysToView) {
			plugin.settings.daysToView = daysToView;
			plugin.saveSettings();
		}
	}, [daysToView, plugin]);
	useEffect(() => {
		if (plugin && plugin.settings.viewMode !== viewMode) {
			plugin.settings.viewMode = viewMode;
			plugin.saveSettings();
		}
	}, [viewMode, plugin]);
	// Keep the host told which shape is showing, so it can hold the right pane open
	// on its default view while the month is up (and hand it back on the way out).
	useEffect(() => {
		if (onViewModeChange) onViewModeChange(viewMode);
	}, [viewMode, onViewModeChange]);
	const days = Array.from({ length: daysToView }).map((_, i) => addDays(startDate, i));
	const [pxPerHour, setPxPerHour] = useState(60);
	// Clicking a day header collapses that column: its tiles drift up out of view
	// (with a small stagger) so the column reads as empty, and clicking the header
	// again drops them back into view. Keyed by the day so each column toggles on
	// its own. Purely presentational — no event or note data is touched.
	const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
	const collapsedKey = (d: Date) => d.toDateString();

	const toggleDayCollapsed = (d: Date) => {
		const k = collapsedKey(d);
		setCollapsedDays(prev => ({ ...prev, [k]: !prev[k] }));
	};

	// A tile that has just "begun" — a freshly created, duplicated, or dropped
	// event — lands with a short, springy bounce. Newcomers are detected by
	// diffing the event ids; the flag lives only for the length of the animation
	// so it fires exactly once and never replays on later renders. The very first
	// pass is skipped so opening the calendar doesn't make every tile jump.
	// Purely presentational — no event or note data is touched.
	const [begunEventIds, setBegunEventIds] = useState<Record<string, boolean>>({});
	const seenEventIdsRef = useRef<Set<string> | null>(null);
	const begunTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
	useEffect(() => {
		const currentIds = events.map(e => e.id);
		const seen = seenEventIdsRef.current;
		if (seen === null) {
			seenEventIdsRef.current = new Set(currentIds);
			return;
		}
		const fresh = currentIds.filter(id => !seen.has(id));
		seenEventIdsRef.current = new Set(currentIds);
		if (fresh.length === 0) return;
		setBegunEventIds(prev => {
			const next = { ...prev };
			fresh.forEach(id => { next[id] = true; });
			return next;
		});
		fresh.forEach(id => {
			if (begunTimersRef.current[id]) clearTimeout(begunTimersRef.current[id]);
			begunTimersRef.current[id] = setTimeout(() => {
				delete begunTimersRef.current[id];
				setBegunEventIds(prev => {
					if (!prev[id]) return prev;
					const next = { ...prev };
					delete next[id];
					return next;
				});
			}, 820);
		});
	}, [events]);
	useEffect(() => () => {
		Object.values(begunTimersRef.current).forEach(t => clearTimeout(t));
	}, []);

	// Whenever the grid changes shape — month ↔ days, or the number of days in
	// view — every tile that is (suddenly) on screen drops in together with the
	// same springy entrance a freshly created tile gets. The flag is held for just
	// over the length of the animation: the class is added once and then removed,
	// which is exactly what lets the keyframes replay on the next shape change.
	// The very first pass is skipped so opening the calendar never makes the whole
	// grid jump. Purely presentational — no event, timer or note data is touched.
	const [revealActive, setRevealActive] = useState(false);
	const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const didInitRevealRef = useRef(false);
	useEffect(() => {
		if (!didInitRevealRef.current) {
			didInitRevealRef.current = true;
			return;
		}
		setRevealActive(true);
		if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
		// Covers the longest stagger (capped wave) plus the 0.62s drop itself.
		revealTimerRef.current = setTimeout(() => setRevealActive(false), 1100);
		return () => {
			if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
		};
	}, [viewMode, daysToView]);

	// Stepping with the ‹ / › arrows next to "Today" moves the window one day at a
	// time. The day being moved TO gets a brief, neutral wash in its header so it
	// is obvious which day the view just landed on. Purely presentational — theme
	// variables only, no accent colour and no border of any kind.
	const [jumpHighlightKey, setJumpHighlightKey] = useState<string | null>(null);
	const jumpHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const handleStepDay = (direction: 'prev' | 'next') => {
		const target = direction === 'prev' ? addDays(currentDate, -1) : addDays(currentDate, 1);
		setJumpHighlightKey(target.toDateString());
		if (jumpHighlightTimerRef.current) clearTimeout(jumpHighlightTimerRef.current);
		jumpHighlightTimerRef.current = setTimeout(() => setJumpHighlightKey(null), 1200);
		if (onNavigate) onNavigate(direction);
	};

	// Month view: the default palette colour for a quiet day tile, read live from
	// settings so the settings menu recolours the month in place.
	const monthDefaultColor: string = plugin?.settings?.monthViewDefaultColor || 'pastel-blue';

	// The ‹ › arrows slide a whole month while in month mode and keep stepping one
	// day at a time in the day view, so the arrows always mean "the same step as
	// the view you're looking at".
	const handleStepView = (direction: 'prev' | 'next') => {
		if (viewMode === 'month') {
			const target = addMonths(currentDate, direction === 'prev' ? -1 : 1);
			if (onSelectDate) onSelectDate(target);
			return;
		}
		handleStepDay(direction);
	};

	// The wheel over the month grid rolls the calendar the same way the arrows do — one
	// notch a month, a longer flick through several, so a year is a single gesture. Each
	// roll is measured from a ref rather than from the rendered date: a fast burst of
	// notches arrives before React has re-rendered, and stepping from the ref means they
	// stack up month after month instead of every one of them landing on the same
	// neighbour. The ref is resynced whenever the date changes from anywhere else, so the
	// arrows, "Today", and the wheel all stay in step.
	const wheelMonthRef = useRef<Date>(currentDate);
	useEffect(() => {
		wheelMonthRef.current = currentDate;
	}, [currentDate]);
	const handleStepMonth = (months: number) => {
		if (!months) return;
		const target = addMonths(wheelMonthRef.current, months);
		wheelMonthRef.current = target;
		if (onSelectDate) onSelectDate(target);
	};

	// The wheel leaves the month track wherever it was let go — that freedom is the whole point of
	// the rolling month — but the header's own controls are the places a reader asks for a clean
	// month back. Clicking the month's name, or "Today", nudges this counter, and the month grid
	// answers each nudge by easing the track onto the month being shown. The month itself does not
	// change, so the panes are never relabelled: only the leftover fraction of a month is given up.
	const [monthSnapSignal, setMonthSnapSignal] = useState(0);
	const requestMonthSnap = () => setMonthSnapSignal(n => n + 1);

	// Recolour one month-view day tile (a hand-picked override) and persist it.
	const handleChangeDayColor = (key: string, color: string) => {
		setMonthDayColors(prev => {
			const next = { ...prev, [key]: color };
			if (plugin) {
				plugin.settings.monthDayColors = next;
				plugin.saveSettings();
			}
			return next;
		});
	};

	// Hand a day back to its automatic colour (the default for quiet days, the
	// stable random palette colour for busy ones) by dropping its override.
	const handleResetDayColor = (key: string) => {
		setMonthDayColors(prev => {
			if (!(key in prev)) return prev;
			const next = { ...prev };
			delete next[key];
			if (plugin) {
				plugin.settings.monthDayColors = next;
				plugin.saveSettings();
			}
			return next;
		});
	};

	// Freeze the month's automatic colours the moment they are decided. Merged into what
	// is already stored, so one month's pass never disturbs another month's decisions.
	const handleSeedMonthAutoColors = (colors: Record<string, string>) => {
		if (Object.keys(colors).length === 0) return;
		setMonthAutoDayColors(prev => {
			const next = { ...prev, ...colors };
			if (plugin) {
				plugin.settings.monthAutoDayColors = next;
				plugin.saveSettings();
			}
			return next;
		});
	};

	// Clicking "Open this day" on a month tile jumps into the day view on that day.
	const handleOpenDay = (day: Date) => {
		if (onSelectDate) onSelectDate(day);
		setViewMode('days');
	};
	useEffect(() => () => {
		if (jumpHighlightTimerRef.current) clearTimeout(jumpHighlightTimerRef.current);
	}, []);
	const [timerPxPerHour, setTimerPxPerHour] = useState(400); // Default: 1 hour = 400px (so 15 mins = 100px)
	const [currentTime, setCurrentTime] = useState<Date>(() => getNowInTimeZone(timeZone));

	useEffect(() => {
		setCurrentTime(getNowInTimeZone(timeZone));
		const interval = setInterval(() => {
			setCurrentTime(getNowInTimeZone(timeZone));
		}, 60000);
		return () => clearInterval(interval);
	}, [timeZone]);
	const [showTimerColumn, setShowTimerColumn] = useState<boolean>(plugin?.settings?.showTimerColumn || false);
	// Timers are now lifted to App.tsx
	// Save showTimerColumn
	const saveTimerColTimeoutRef = useRef<any>(null);
	useEffect(() => {
		if (plugin) {
			plugin.settings.showTimerColumn = showTimerColumn;
			if (saveTimerColTimeoutRef.current) clearTimeout(saveTimerColTimeoutRef.current);
			saveTimerColTimeoutRef.current = setTimeout(() => {
				plugin.saveSettings();
			}, 500);
		}
	}, [showTimerColumn, plugin]);



	const weekGridRef = useRef<HTMLDivElement>(null);
	// The pop-out duplicate calendar is positioned inside this wrapper, so its own
	// bounding box is what the panel measures itself against.
	const mainFlexRef = useRef<HTMLDivElement>(null);
	const hasInitialScrolled = useRef(false);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		})
	);

	// The duplicate calendar floats above the grid, so it has to win any collision the
	// pointer is physically inside — otherwise the tall day column sitting behind the
	// panel would always claim the drop. Everything else falls straight through to the
	// grid's original rectangle-intersection behaviour.
	//
	// Note: a collision is `{ id, data: { droppableContainer, value } }` — dnd-kit
	// wraps the droppable instead of exposing its data — so the panel's own flags have
	// to be read from `data.droppableContainer.data.current`. Reading them from
	// `data.current` silently matched nothing, which meant the panel never claimed the
	// drop and the day column hidden behind it won every time.
	const collisionDetection: CollisionDetection = useCallback((args) => {
		const flagsOf = (collision: any) => collision?.data?.droppableContainer?.data?.current;
		const within = pointerWithin(args);
		const popoutDay = within.filter(c => flagsOf(c)?.dupCalDay);
		if (popoutDay.length) return popoutDay;
		const popoutPanel = within.filter(c => flagsOf(c)?.dupCalPanel);
		if (popoutPanel.length) return popoutPanel;
		return rectIntersection(args);
	}, []);

	// A tile in flight is fenced inside the grid. Pressing it against the timer column
	// used to let its own box spill past the scrollport, which handed dnd-kit a fresh
	// strip of horizontal overflow to auto-scroll into on every frame: the column slid
	// over, the tile followed, and the two set each other off, so the whole grid read
	// as if it were shaking. Clamping the drag's horizontal travel to the grid's own
	// bounds means the tile simply comes to rest against the edge instead. The fence is
	// lifted while the duplicate-calendar pop-out is open, because that panel is
	// anchored beside the grid rather than inside it.
	const tileFenceEnabledRef = useRef(false);
	const clampTileToGrid = useCallback((args: any) => {
		const { transform, draggingNodeRect, active } = args || {};
		if (!transform || !draggingNodeRect || !tileFenceEnabledRef.current) return transform;
		// Only calendar tiles are fenced. The timer column's own tiles are dragged by
		// hand rather than through this context, but the guard is here so that any
		// future draggable — one living outside the grid — is left alone.
		const activeEvent = active?.data?.current;
		if (!activeEvent || !(activeEvent.startTime instanceof Date)) return transform;
		const grid = weekGridRef.current;
		if (!grid) return transform;
		const bounds = grid.getBoundingClientRect();
		const minX = bounds.left - draggingNodeRect.left;
		const maxX = bounds.right - draggingNodeRect.right;
		if (maxX < minX) return transform;
		return { ...transform, x: Math.max(minX, Math.min(maxX, transform.x)) };
	}, []);
	const dragModifiers = useMemo(() => [clampTileToGrid], [clampTileToGrid]);

	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	// The month currently shown by the duplicate-calendar pop-out; null while closed.
	const [dupCalMonth, setDupCalMonth] = useState<Date | null>(null);
	// The fence stands unless the pop-out is on screen, so a Meta duplication can still
	// carry its copy out over the column and onto the calendar panel.
	tileFenceEnabledRef.current = dupCalMonth === null;
	// The rect of the tile being duplicated, sampled from the drag itself. The panel
	// opens right beside the tile instead of in a corner, and until this is known the
	// panel is not rendered at all, so it never flashes up in the wrong place first.
	const [dupCalAnchor, setDupCalAnchor] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
	const dupCalAnchorRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
	const [draggingEventTimes, setDraggingEventTimes] = useState<{ id: string; startTime: Date; endTime: Date } | null>(null);
	// Which day header the tile in flight would land on, keyed by `toDateString()`.
	// It drives the enlarged, washed header that marks the landing date — the day the
	// tile started on counts too, so nudging a tile within its own day still lights
	// its header. Null whenever no tile is in flight.
	const [dragTargetDayKey, setDragTargetDayKey] = useState<string | null>(null);
	// Pushing a tile against either end of the grid and holding it there asks the
	// calendar to move a whole page on — forwards against the right edge (over the timer
	// column, or past it onto the right pane), backwards against the left (over the time
	// labels, or past the grid's own edge). The tile is fenced at the grid's edge (see
	// `clampTileToGrid`), so the gesture reads as "push past the end": after a short dwell
	// the hold starts stepping, and it keeps stepping for as long as the tile is held
	// there. `edgeHoldDir` drives the on-screen nudge; the dwell and repeat timers live in
	// refs so arming never re-renders the grid.
	const [edgeHoldDir, setEdgeHoldDir] = useState<'prev' | 'next' | null>(null);
	const edgeHoldDirRef = useRef<'prev' | 'next' | null>(null);
	const edgeHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const edgeHoldRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
	// The window's own start day, kept in a ref so a repeat steps on from the latest
	// page. A burst of steps lands faster than React re-renders, and each one has to
	// carry the window a further page rather than all of them landing on the neighbour
	// of the page they started from.
	const windowStartRef = useRef<Date>(currentDate);
	useEffect(() => {
		windowStartRef.current = currentDate;
	}, [currentDate]);
	useEffect(() => () => {
		if (edgeHoldTimerRef.current) clearTimeout(edgeHoldTimerRef.current);
		if (edgeHoldRepeatRef.current) clearInterval(edgeHoldRepeatRef.current);
	}, []);
	// While a tile is in flight the current-time rule detaches from "now" and rides
	// the dragged tile's top edge, so the time scale reads off exactly where the
	// event would land. Cleared on drop/cancel, which snaps the rule back to the
	// real current time.
	const [dragIndicatorTop, setDragIndicatorTop] = useState<number | null>(null);
	// While an event tile's top or bottom resize handle is being dragged the same
	// rule marks the edge being moved — the tile's bottom for the end handle, its
	// top for the start handle. Kept apart from the drag indicator so a tile move
	// and an edge resize can never clobber each other's marker; released on pointer up.
	const [resizeIndicatorTop, setResizeIndicatorTop] = useState<number | null>(null);
	const lastDragTimesRef = useRef<{ startTime: Date; endTime: Date } | null>(null);
	const currentDragTargetDateRef = useRef<Date | null>(null);
	const originalDragEventRef = useRef<CalendarEvent | null>(null);
	// The column index the in-flight tile is drawn in for the whole hold, sampled when
	// the drag starts. A tile in flight must never move its own layout box: dnd-kit
	// measures the dragged node and cancels any layout shift it sees, but that
	// cancellation lands a frame *after* the shift, so every rect change the tile makes
	// surfaces as a one-frame jump — the flicker and jitter seen when a tile is moved
	// quickly. Pinning the column by index, together with the frozen time of day used
	// in `displayEvents` below, keeps the rect identical from pick-up to drop, so there
	// is never a shift for dnd-kit to cancel.
	const dragOriginColumnIndexRef = useRef<number>(-1);
	// The live vertical travel of the tile in flight, in pixels, sampled from the last
	// drag-move. The tile's *visual* top is its time-of-day offset (its layout top) plus
	// this travel, and while a tile is held against an end of the grid the fence clamps
	// only its horizontal motion — so the vertical travel is the piece a page step must
	// still add. Without it the drop rule snaps back to the layout top on every step and
	// floats above the tile by the whole vertical drag distance.
	const dragDeltaYRef = useRef<number>(0);
	const [isCmdPressed, setIsCmdPressed] = useState<boolean>(false);
	const isCmdPressedRef = useRef<boolean>(false);
	// Command (Meta) is the only modifier that opens the duplicate drop calendar.
	// Control still duplicates, but the copy is dragged freely across the normal
	// grid with no pop-out in the way.
	const [isMetaPressed, setIsMetaPressed] = useState<boolean>(false);
	const isMetaPressedRef = useRef<boolean>(false);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) {
				isCmdPressedRef.current = true;
				setIsCmdPressed(true);
			}
			const meta = Boolean(e.metaKey) || e.key === 'Meta';
			if (meta !== isMetaPressedRef.current) {
				isMetaPressedRef.current = meta;
				setIsMetaPressed(meta);
			}
		};
		const handleKeyUp = (e: KeyboardEvent) => {
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				isCmdPressedRef.current = false;
				setIsCmdPressed(false);
				isMetaPressedRef.current = false;
				setIsMetaPressed(false);
				return;
			}
			const meta = Boolean(e.metaKey);
			if (meta !== isMetaPressedRef.current) {
				isMetaPressedRef.current = meta;
				setIsMetaPressed(meta);
			}
		};
		const handlePointer = (e: PointerEvent | MouseEvent) => {
			const hasCmd = Boolean(e.metaKey || e.ctrlKey || e.altKey);
			if (hasCmd !== isCmdPressedRef.current) {
				isCmdPressedRef.current = hasCmd;
				setIsCmdPressed(hasCmd);
			}
			const meta = Boolean(e.metaKey);
			if (meta !== isMetaPressedRef.current) {
				isMetaPressedRef.current = meta;
				setIsMetaPressed(meta);
			}
		};
		const handleBlur = () => {
			isCmdPressedRef.current = false;
			setIsCmdPressed(false);
			isMetaPressedRef.current = false;
			setIsMetaPressed(false);
		};

		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('keyup', handleKeyUp, true);
		window.addEventListener('pointerdown', handlePointer, true);
		window.addEventListener('pointermove', handlePointer, true);
		window.addEventListener('pointerup', handlePointer, true);
		window.addEventListener('blur', handleBlur);

		return () => {
			window.removeEventListener('keydown', handleKeyDown, true);
			window.removeEventListener('keyup', handleKeyUp, true);
			window.removeEventListener('pointerdown', handlePointer, true);
			window.removeEventListener('pointermove', handlePointer, true);
			window.removeEventListener('pointerup', handlePointer, true);
			window.removeEventListener('blur', handleBlur);
		};
	}, []);

	const isDuplicatingNow = Boolean(activeDragId && isCmdPressed);
	// The duplicate drop calendar is a Command-only affordance: Control still
	// duplicates, but the copy is dragged freely in the normal grid.
	const showDupCalendar = Boolean(isDuplicatingNow && isMetaPressed);

	// The rule that marks "now" doubles as a temporary edge marker: while a tile is
	// dragged it sits on the dragged tile's top edge, and while an edge-resize handle
	// is dragged it rides the edge being moved (the bottom for the end handle, the top
	// for the start handle). It returns to the current time the moment the interaction
	// ends. The formula is the same one tiles use for their own `top`, so the rule lands
	// exactly on the edge it is reporting.
	const indicatorTop = resizeIndicatorTop ?? dragIndicatorTop;
	const isIndicatorActive = indicatorTop !== null;
	const timeLineTop = indicatorTop ?? (currentTime.getHours() + currentTime.getMinutes() / 60) * pxPerHour;

	useEffect(() => {
		if (isDuplicatingNow) {
			document.body.classList.add('is-duplicating-drag');
		} else {
			document.body.classList.remove('is-duplicating-drag');
		}
		return () => {
			document.body.classList.remove('is-duplicating-drag');
		};
	}, [isDuplicatingNow]);

	// A calendar tile in flight makes the timer column inert (see the
	// body.sleek-tile-dragging CSS rule) so the drag can never disturb it and it
	// can never disturb the drag.
	useEffect(() => {
		const cls = 'sleek-tile-dragging';
		if (activeDragId) {
			document.body.classList.add(cls);
		} else {
			document.body.classList.remove(cls);
		}
		return () => {
			document.body.classList.remove(cls);
		};
	}, [activeDragId]);

	// An all-day tile's label is pinned to the top of the scrollport (sticky). On
	// top of that it lags a hair behind the scroll before easing back onto the
	// tile, so scrolling reads as the label trying to keep up: it dips past its
	// pinned spot, then settles. The offset is written to a CSS variable (rather
	// than React state) so the motion never re-renders the grid.
	useEffect(() => {
		const el = weekGridRef.current;
		if (!el) return;
		const LAG_FACTOR = 0.1;
		const LAG_MAX = 10;
		let lastTop = el.scrollTop;
		let lag = 0;
		let raf = 0;
		let running = false;

		const apply = (value: number) => {
			if (value === 0) el.style.removeProperty('--sleek-allday-lag');
			else el.style.setProperty('--sleek-allday-lag', `${value.toFixed(2)}px`);
		};

		const tick = () => {
			// Ease the lag away so the label drifts back onto the tile once the
			// scroll settles.
			lag *= 0.8;
			if (Math.abs(lag) < 0.2) {
				lag = 0;
				apply(0);
				running = false;
				raf = 0;
				return;
			}
			apply(lag);
			raf = requestAnimationFrame(tick);
		};

		const onScroll = () => {
			const top = el.scrollTop;
			const delta = top - lastTop;
			lastTop = top;
			if (!delta) return;
			lag = Math.max(-LAG_MAX, Math.min(LAG_MAX, lag + delta * LAG_FACTOR));
			apply(lag);
			if (!running) {
				running = true;
				raf = requestAnimationFrame(tick);
			}
		};

		el.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			el.removeEventListener('scroll', onScroll);
			if (raf) cancelAnimationFrame(raf);
			el.style.removeProperty('--sleek-allday-lag');
		};
	}, []);

	const scrollToCurrentTime = (smooth = false) => {
		const el = weekGridRef.current;
		if (!el) return;
		const now = getNowInTimeZone(timeZone);
		const hoursFromMidnight = now.getHours() + now.getMinutes() / 60;
		const lineY = 82 + hoursFromMidnight * pxPerHour;
		const clientHeight = el.clientHeight;
		if (!clientHeight) return;
		const targetScrollTop = Math.max(0, lineY - clientHeight / 2);
		el.scrollTo({
			top: targetScrollTop,
			behavior: smooth ? 'smooth' : 'auto'
		});
	};

	useEffect(() => {
		const el = weekGridRef.current;
		if (!el) return;

		const performScroll = () => {
			if (hasInitialScrolled.current) return true;
			if (el && el.clientHeight > 50 && el.scrollHeight > el.clientHeight) {
				scrollToCurrentTime(false);
				hasInitialScrolled.current = true;
				return true;
			}
			return false;
		};

		if (performScroll()) return;

		const ro = new ResizeObserver(() => {
			if (!hasInitialScrolled.current) {
				if (performScroll()) {
					ro.disconnect();
				}
			}
		});
		ro.observe(el);

		const t1 = setTimeout(performScroll, 50);
		const t2 = setTimeout(performScroll, 150);
		const t3 = setTimeout(performScroll, 300);
		const t4 = setTimeout(performScroll, 600);
		const t5 = setTimeout(() => {
			if (!hasInitialScrolled.current) {
				scrollToCurrentTime(false);
				hasInitialScrolled.current = true;
			}
		}, 1000);

		return () => {
			ro.disconnect();
			clearTimeout(t1);
			clearTimeout(t2);
			clearTimeout(t3);
			clearTimeout(t4);
			clearTimeout(t5);
		};
	}, [pxPerHour]);

	// Switching between the full-month shape and the day grid tears the scrollport
	// down and rebuilds it, so coming back from the month the grid would otherwise
	// sit at 12 AM. Bring it straight down to the current-time indicator instead —
	// the same landing spot the grid takes when it first opens. Keyed on the view
	// shape only, so merely adding/removing a day column leaves the reader's scroll
	// position alone. Purely presentational: it moves the scrollport, never any data.
	const didInitViewScrollRef = useRef(false);
	const viewScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (!didInitViewScrollRef.current) {
			// The first mount is already positioned by the initial-scroll effect.
			didInitViewScrollRef.current = true;
			return;
		}
		if (viewMode === 'month') return;
		const scrollNow = () => {
			const el = weekGridRef.current;
			if (el && el.clientHeight > 50) {
				scrollToCurrentTime(false);
				hasInitialScrolled.current = true;
				return true;
			}
			return false;
		};
		// Wait a frame so the freshly re-mounted grid has been laid out, then fall
		// back to a short timer in case that first frame lands before it has height.
		const raf = requestAnimationFrame(() => {
			if (!scrollNow()) {
				viewScrollTimerRef.current = setTimeout(scrollNow, 80);
			}
		});
		return () => {
			cancelAnimationFrame(raf);
			if (viewScrollTimerRef.current) {
				clearTimeout(viewScrollTimerRef.current);
				viewScrollTimerRef.current = null;
			}
		};
	}, [viewMode]);

	useEffect(() => {
		if (externalUpdatedEvent) {
			setEvents(prev => prev.map(e => e.id === externalUpdatedEvent.id ? externalUpdatedEvent : e));
		}
	}, [externalUpdatedEvent]);

	useEffect(() => {
		if (externalDeletedEventId) {
			setEvents(prev => prev.filter(e => e.id !== externalDeletedEventId));
			if (selectedEventId === externalDeletedEventId) {
				onEventSelect(null as any);
			}
		}
	}, [externalDeletedEventId]);

	const handleDeleteEvent = (id: string) => {
		setEvents(prev => prev.filter(e => e.id !== id));
		if (selectedEventId === id) {
			onEventSelect(null as any);
		}
		if (onEventDelete) {
			onEventDelete(id);
		}
	};

	const handleEventUpdate = (updated: CalendarEvent) => {
		setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
		if (onEventModified) {
			onEventModified(updated);
		}
	};

	const handleDuplicateEvent = (eventToDuplicate: CalendarEvent) => {
		const duration = Math.max(30 * 60 * 1000, eventToDuplicate.endTime.getTime() - eventToDuplicate.startTime.getTime());
		let newStart = new Date(eventToDuplicate.startTime.getTime() + Math.min(duration, 60 * 60 * 1000));
		let newEnd = new Date(newStart.getTime() + duration);
		const dayEnd = new Date(newStart);
		dayEnd.setHours(23, 59, 0, 0);
		if (newEnd.getTime() >= dayEnd.getTime()) {
			newEnd = dayEnd;
			newStart = snapTo15(new Date(Math.max(new Date(newStart).setHours(0, 0, 0, 0), dayEnd.getTime() - duration)));
		}
		const newId = Math.random().toString(36).substring(7);
		const duplicateEvent: CalendarEvent = {
			...eventToDuplicate,
			id: newId,
			startTime: newStart,
			endTime: newEnd
		};
		setEvents(prev => [...prev, duplicateEvent]);
		if (onEventSelect) onEventSelect(duplicateEvent);
		if (onEventModified) onEventModified(duplicateEvent);
	};

	const [draftEvent, setDraftEvent] = useState<CalendarEvent | null>(null);

	const getTimeFromY = (y: number, day: Date) => {
		const hours = Math.max(0, Math.min(23.75, y / pxPerHour));
		const time = new Date(day);
		time.setHours(Math.floor(hours), Math.round((hours % 1) * 60), 0, 0);
		return snapTo15(time);
	};

	const handleDropOnEvent = (e: React.DragEvent, targetEvent: CalendarEvent) => {
		const doc = extractObsidianDoc(e.dataTransfer);
		if (!doc) return;

		let updatedEvent: CalendarEvent;

		if (doc.isNote) {
			// Dropped an actual Obsidian note -> attach to linkedNotes
			const noteTitle = doc.title;
			const currentNotes = targetEvent.linkedNotes || [];
			const alreadyLinked = currentNotes.includes(noteTitle);
			const updatedNotes = alreadyLinked ? currentNotes : [...currentNotes, noteTitle];
			updatedEvent = {
				...targetEvent,
				linkedNotes: updatedNotes
			};
		} else {
			// Dropped a regular calendar to-do checklist item -> add to todos
			const todoTitle = doc.title;
			const currentTodos: EventTodo[] = targetEvent.todos ? [...targetEvent.todos] : [];
			const alreadyExists = currentTodos.some(t => t.title.toLowerCase() === todoTitle.toLowerCase());
			const updatedTodos = alreadyExists
				? currentTodos
				: [...currentTodos, { id: Math.random().toString(36).substring(7), title: todoTitle, completed: false }];
			updatedEvent = {
				...targetEvent,
				todos: updatedTodos
			};
		}

		setEvents(prev => prev.map(ev => ev.id === updatedEvent.id ? updatedEvent : ev));
		if (onEventModified) {
			onEventModified(updatedEvent);
		}
		// Dropping an item (to-do or note) onto an existing tile must NOT yank the
		// right pane into that event's details view — the tile quietly gains the
		// item and the default pane stays put. The details pane opens ONLY when the
		// user explicitly clicks the tile.
	};

	const handleNativeDrop = (e: React.DragEvent, day: Date) => {
		const doc = extractObsidianDoc(e.dataTransfer);
		if (!doc) return;

		const rect = e.currentTarget.getBoundingClientRect();
		const y = e.clientY - rect.top;
		let snappedTime = getTimeFromY(y, day);

		const dayStart = new Date(day);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = new Date(day);
		dayEnd.setHours(23, 59, 0, 0);
		let endTime = new Date(snappedTime.getTime() + 60 * 60 * 1000); // 1 hour default
		if (endTime.getTime() >= dayEnd.getTime()) {
			endTime = dayEnd;
			snappedTime = snapTo15(new Date(Math.max(dayStart.getTime(), dayEnd.getTime() - 60 * 60 * 1000)));
		}

		const isNote = !!doc.isNote;
		const newEvent: CalendarEvent = {
			id: Math.random().toString(36).substring(7),
			title: doc.title,
			startTime: snappedTime,
			endTime,
			colorTheme: defaultEventColor,
			description: isNote ? doc.link : '',
			linkedNotes: isNote ? [doc.title] : undefined,
			todos: undefined
		};
		setEvents(prev => [...prev, newEvent]);
		if (onEventModified) onEventModified(newEvent);
		if (onTodoDrop) onTodoDrop(doc, day, y);
		if (onEventSelect) onEventSelect(newEvent);
	};

	/**
		* Dropping a to-do or a note onto a month day tile.
		*
		* A month tile has no hour scale and so no Y position to read a time from, which
		* is the one thing this shares with the drop handler above. The entry lands in a
		* civil 9am slot on the day it was dropped on, wearing the default tile colour,
		* with a note arriving linked and a to-do arriving as a plain titled entry —
		* exactly what the same drop produces on a day column. Nothing else is invented
		* and the details pane is deliberately not opened: the tile quietly gains the
		* entry and the default pane stays put.
		*/
	const handleMonthDrop = (e: React.DragEvent, day: Date) => {
		const doc = extractObsidianDoc(e.dataTransfer);
		if (!doc) return;

		const startTime = new Date(day);
		startTime.setHours(9, 0, 0, 0);
		const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

		const isNote = !!doc.isNote;
		const newEvent: CalendarEvent = {
			id: Math.random().toString(36).substring(7),
			title: doc.title,
			startTime,
			endTime,
			colorTheme: defaultEventColor,
			description: isNote ? doc.link : '',
			linkedNotes: isNote ? [doc.title] : undefined,
			todos: undefined
		};
		setEvents(prev => [...prev, newEvent]);
		if (onEventModified) onEventModified(newEvent);
	};

	/**
		* Copies every event of one day onto another day, on the month view's own instruction.
		*
		* This is the other half of the month's day-to-day drag: the tile reports only which day
		* was dragged onto which, the confirmation is answered up there, and the copy is made
		* here, where the events live. Each event is re-dated whole, by a plain `addDays` shift,
		* so its time of day and its length come across untouched — a 9am meeting becomes a 9am
		* meeting, and an event that spills past midnight still spills. The copies are new
		* entries with fresh ids, carrying their details and their repeats along, exactly as the
		* day view's duplicate is; the day they came from is never touched. The list is appended
		* in a single update, and the app's own debounced save picks it up from there.
		*/
	const handleCopyDayEvents = useCallback((from: Date, to: Date) => {
		const shift = differenceInCalendarDays(to, from);
		if (!shift) return;
		setEvents(prev => {
			const source = prev.filter(e => isSameDay(e.startTime, from));
			if (source.length === 0) return prev;
			const copies = source.map(e => ({
				...e,
				id: Math.random().toString(36).substring(7),
				startTime: addDays(e.startTime, shift),
				endTime: addDays(e.endTime, shift)
			}));
			return [...prev, ...copies];
		});
	}, []);

	const handleTimeScalePointerDown = (e: React.PointerEvent) => {
		e.preventDefault();
		const startY = e.clientY;
		const startPx = pxPerHour;

		const handleMove = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientY - startY;
			// For every 2 pixels dragged, change pxPerHour by 1
			const newPx = Math.max(30, Math.min(150, startPx + delta / 2));
			setPxPerHour(newPx);
		};

		const handleUp = () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleUp);
		};

		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleUp);
	};

	const handleBackgroundPointerDown = (e: React.PointerEvent, day: Date) => {
		if ((e.target as HTMLElement).closest('.placeholder-event')) return;

		const targetElement = e.currentTarget as HTMLElement;
		try {
			targetElement.setPointerCapture(e.pointerId);
		} catch (err) { }

		const rect = targetElement.getBoundingClientRect();
		const startY = e.clientY - rect.top;
		const startTime = getTimeFromY(startY, day);

		let hasDragged = false;
		const dragThreshold = 5; // pixels
		const startClientY = e.clientY;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			const deltaY = moveEvent.clientY - startClientY;

			// Only allow downward or downward-angle motions (deltaY > dragThreshold) to initiate dragging
			if (!hasDragged && deltaY > dragThreshold) {
				hasDragged = true;
				// Create the initial draft event only once dragging starts downward
				setDraftEvent({
					id: 'draft',
					title: '',
					startTime,
					endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
					colorTheme: defaultEventColor
				});
			}

			if (hasDragged) {
				// If cursor moves back above start point, hide draft event
				if (deltaY < 0) {
					setDraftEvent(null);
					return;
				}

				const currentY = moveEvent.clientY - rect.top;
				const maxY = 24 * pxPerHour;
				const clampedY = Math.min(maxY, currentY);
				let updatedEndTime = getTimeFromY(clampedY, day);

				const dayStart = new Date(day);
				dayStart.setHours(0, 0, 0, 0);
				const dayEnd = new Date(day);
				dayEnd.setHours(23, 59, 0, 0);

				if (clampedY >= maxY || updatedEndTime.getTime() >= dayEnd.getTime()) {
					updatedEndTime = dayEnd;
				}

				if (updatedEndTime.getTime() - startTime.getTime() < 28 * 60 * 1000) {
					updatedEndTime = new Date(startTime.getTime() + 30 * 60 * 1000);
					if (updatedEndTime.getTime() > dayEnd.getTime()) {
						updatedEndTime = dayEnd;
					}
				}

				setDraftEvent({
					id: 'draft',
					title: '',
					startTime,
					endTime: updatedEndTime,
					colorTheme: defaultEventColor
				});
			}
		};

		const handlePointerUp = (upEvent: PointerEvent) => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			try {
				targetElement.releasePointerCapture(upEvent.pointerId);
			} catch (err) { }

			const finalDeltaY = upEvent.clientY - startClientY;

			// Only create event if dragging occurred and ended downward from start point
			if (hasDragged && finalDeltaY > dragThreshold) {
				setDraftEvent(prev => {
					if (prev) {
						// Born untitled when the user dragged without naming it: the pane shows its
						// "Add an event..." placeholder and the tile keeps its own "Event" fallback,
						// so nothing has to be written into the event to hold either together.
						const newEvent = { ...prev, id: Math.random().toString(36).substr(2, 9), title: prev.title || '' };
						setEvents(curr => [...curr, newEvent]);
						onEventSelect(newEvent);
					}
					return null;
				});
			} else {
				setDraftEvent(null);
				// It was an upward drag or just a click on the background, deselect any selected event
				onEventSelect(null as any);
			}
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	};

	// Holding a tile against an end of the grid pages the window on. These four govern
	// that gesture: how long it must be held before it takes, how far apart the repeat
	// steps fall, and how close to each end counts as "pushed against it". To the right
	// the grid's edge is only the start of the timer column and the right pane beyond it,
	// so a sliver inside the edge is enough. To the left the pane's edge is the screen's
	// own edge, and the tile rests over the time labels long before the pointer can go
	// anywhere — so the band there reaches across that whole label gutter instead.
	const EDGE_HOLD_DELAY_MS = 700;
	const EDGE_HOLD_REPEAT_MS = 1200;
	const EDGE_HOLD_BAND_PX = 10;
	const EDGE_HOLD_BACK_BAND_PX = 56;

	const stopEdgeHold = useCallback(() => {
		if (edgeHoldTimerRef.current) {
			clearTimeout(edgeHoldTimerRef.current);
			edgeHoldTimerRef.current = null;
		}
		if (edgeHoldRepeatRef.current) {
			clearInterval(edgeHoldRepeatRef.current);
			edgeHoldRepeatRef.current = null;
		}
		if (edgeHoldDirRef.current !== null) {
			edgeHoldDirRef.current = null;
			setEdgeHoldDir(null);
		}
	}, []);

	// Where the drop rule's `top` belongs while a tile is in flight: the tile's own
	// time-of-day offset plus its live vertical travel, so the rule rides the tile's top
	// edge exactly as a resting tile's own `top` would. Bounded to the day so the rule can
	// never float off the time scale.
	const dragIndicatorTopFor = useCallback((hours: number, minutes: number, deltaY: number) => {
		const raw = (hours + minutes / 60) * pxPerHour + deltaY;
		return Math.max(0, Math.min(24 * pxPerHour, raw));
	}, [pxPerHour]);

	// Slide the visible window on by a whole page — forwards or backwards — and move the
	// in-flight tile's own preview onto the first (or last) day of the new page. The tile
	// is re-homed in `displayEvents` in the same beat, so it never blinks out of existence
	// while the page turns; the times set here are what it lands on.
	const stepWindowPage = useCallback((direction: 'prev' | 'next') => {
		const step = Math.max(1, daysToView);
		const target = addDays(windowStartRef.current, direction === 'next' ? step : -step);
		windowStartRef.current = target;
		if (onSelectDate) onSelectDate(target);

		const ev = originalDragEventRef.current;
		if (ev) {
			const duration = Math.max(30 * 60 * 1000, ev.endTime.getTime() - ev.startTime.getTime());
			const start = new Date(target);
			start.setHours(ev.startTime.getHours(), ev.startTime.getMinutes(), 0, 0);
			const end = new Date(start.getTime() + duration);
			currentDragTargetDateRef.current = target;
			lastDragTimesRef.current = { startTime: start, endTime: end };
			setDraggingEventTimes({ id: ev.id, startTime: start, endTime: end });
			// Keep the drop rule on the tile's *visual* top edge, not its layout top: the
			// box is deliberately held still across the page turn, so the rule must carry
			// the live vertical travel too or it detaches from the tile.
			setDragIndicatorTop(dragIndicatorTopFor(start.getHours(), start.getMinutes(), dragDeltaYRef.current));
			setDragTargetDayKey(target.toDateString());
		}
	}, [daysToView, onSelectDate, dragIndicatorTopFor]);

	const startEdgeHold = useCallback((direction: 'prev' | 'next') => {
		// Already waiting on this very direction: leave the dwell running rather than
		// restarting it on every pointer move while the tile sits against the edge.
		if (edgeHoldDirRef.current === direction) return;
		if (edgeHoldTimerRef.current) {
			clearTimeout(edgeHoldTimerRef.current);
			edgeHoldTimerRef.current = null;
		}
		if (edgeHoldRepeatRef.current) {
			clearInterval(edgeHoldRepeatRef.current);
			edgeHoldRepeatRef.current = null;
		}
		edgeHoldDirRef.current = direction;
		setEdgeHoldDir(direction);
		edgeHoldTimerRef.current = setTimeout(() => {
			edgeHoldTimerRef.current = null;
			stepWindowPage(direction);
			edgeHoldRepeatRef.current = setInterval(() => stepWindowPage(direction), EDGE_HOLD_REPEAT_MS);
		}, EDGE_HOLD_DELAY_MS);
	}, [stepWindowPage]);

	// dnd-kit's own delta is the tile's *fenced* travel, and it stops being reported at
	// all once the tile has come to rest on the grid's edge — so neither the deltas nor
	// the drag-move events can tell us how far the pointer has really gone. The edge-hold
	// therefore reads the real pointer, followed here for as long as a tile is in flight.
	useEffect(() => {
		if (!activeDragId) return;
		const handlePointerMove = (e: PointerEvent) => {
			const grid = weekGridRef.current;
			// Only a plain grid drag can arm a hold: the duplicate pop-out has its own
			// navigation, and a tile up there is heading for the panel, not a new page.
			if (!grid || !tileFenceEnabledRef.current) {
				stopEdgeHold();
				return;
			}
			const bounds = grid.getBoundingClientRect();
			if (e.clientX >= bounds.right - EDGE_HOLD_BAND_PX) startEdgeHold('next');
			else if (e.clientX <= bounds.left + EDGE_HOLD_BACK_BAND_PX) startEdgeHold('prev');
			else stopEdgeHold();
		};
		window.addEventListener('pointermove', handlePointerMove, true);
		return () => window.removeEventListener('pointermove', handlePointerMove, true);
	}, [activeDragId, startEdgeHold, stopEdgeHold]);

	const handleDragStart = (event: DragStartEvent) => {
		// A fresh drag always begins with the edge-hold put away and with the page stepper
		// anchored on the window that is actually on screen.
		stopEdgeHold();
		dragDeltaYRef.current = 0;
		windowStartRef.current = startDate;
		const activator = event.activatorEvent as MouseEvent | undefined;
		const isCmd = Boolean(
			isDuplicatingNow ||
			activator?.metaKey ||
			activator?.ctrlKey ||
			activator?.altKey ||
			isCmdPressedRef.current
		);
		// Command opens the pop-out calendar; Control (or Alt) duplicates without it.
		const isMeta = Boolean(isMetaPressedRef.current || activator?.metaKey);
		if (isCmd) {
			isCmdPressedRef.current = true;
			setIsCmdPressed(true);
		}
		if (isMeta) {
			isMetaPressedRef.current = true;
			setIsMetaPressed(true);
		}
		const activeEvent = event.active.data.current as CalendarEvent | undefined;
		// Guarded on the times as well as the object: dnd-kit hands back a truthy but
		// empty data object for a node that has unmounted, and every path below reads
		// the event's own start time.
		if (activeEvent && activeEvent.startTime) {
			originalDragEventRef.current = activeEvent;
			// Sample the column the tile starts in. It is where the tile stays drawn for
			// the whole hold — even after an edge-hold page step carries its real day off
			// screen — so the tile's own box never shifts (see the ref's own note).
			dragOriginColumnIndexRef.current = days.findIndex(d => isSameDay(d, activeEvent.startTime));
			currentDragTargetDateRef.current = activeEvent.startTime;
			setDragTargetDayKey(activeEvent.startTime.toDateString());
			lastDragTimesRef.current = { startTime: activeEvent.startTime, endTime: activeEvent.endTime };
			if (onEventSelect) {
				onEventSelect(activeEvent);
			}
			// Command means "duplicate with the day picker", so the pop-out opens on
			// the month the event lives in. Control duplicates too but keeps the grid
			// clear. Either way it follows the modifier: let the key go mid-drag and the
			// panel closes again, leaving the copy to be dropped freely on the grid.
			setDupCalMonth(isMeta ? activeEvent.startTime : null);
			// Place the panel beside the tile itself. dnd-kit's own rect ref is reused
			// between drags and only refreshed once a drag is genuinely under way, so
			// the tile is read straight from the DOM via the pointer-down target — the
			// panel then opens in the right place on its very first paint.
			const activatorTarget = (event.activatorEvent?.target as HTMLElement | null) ?? null;
			const tileNode = (activatorTarget?.closest?.('.placeholder-event') as HTMLElement | null) ?? null;
			const tileRect = isMeta && tileNode ? tileNode.getBoundingClientRect() : null;
			const anchor = tileRect
				? { left: tileRect.left, top: tileRect.top, right: tileRect.right, bottom: tileRect.bottom }
				: null;
			dupCalAnchorRef.current = anchor;
			setDupCalAnchor(anchor);
		}
		setActiveDragId(String(event.active.id));
	};

	const handleDragMove = (event: DragMoveEvent) => {
		const { active, over, delta } = event;
		if (!active) return;
		// The dragged tile's own day column can leave the window while a drag is under way
		// — the edge-hold pages the calendar on — and dnd-kit falls back to an empty data
		// object for an active node that unmounts (its `defaultData`). That object is
		// truthy but carries no times, so the drag's own snapshot is the source of truth
		// here; it is also the original the drop is measured against.
		const activeEvent = (originalDragEventRef.current || active.data.current) as CalendarEvent | undefined;
		if (!activeEvent || !activeEvent.startTime || !activeEvent.endTime) return;

		// The tile's live vertical travel, kept for any page step (see `dragDeltaYRef`).
		dragDeltaYRef.current = delta.y;

		// Second chance to learn where the tile actually is, for the cases where the
		// rect was not yet measured when the drag started.
		if (isMetaPressedRef.current && !dupCalAnchorRef.current) {
			const rect = active.rect.current.initial || active.rect.current.translated;
			if (rect) {
				const anchor = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
				dupCalAnchorRef.current = anchor;
				setDupCalAnchor(anchor);
			}
		}

		const overData = over?.data.current as { date?: Date; dupCalDay?: boolean; dupCalPanel?: boolean } | undefined;

		// The pop-out calendar is stacked over the grid, so while the pointer is up
		// there the drag has effectively left the grid: no grid day is claimed, the
		// in-grid preview is put away, and the original event is left exactly as it is.
		if (overData?.dupCalDay || overData?.dupCalPanel) {
			setDraggingEventTimes(prev => (prev ? null : prev));
			setDragTargetDayKey(null);
			lastDragTimesRef.current = null;
			// The drag has left the grid for the pop-out, so any edge-hold is withdrawn.
			stopEdgeHold();
			return;
		}

		// Leant against the timer column: the tile has already come to rest on the fence,
		// and the column is not a landing place for an event, so nothing is recalculated
		// while the pointer sits off the grid. Leaving the preview — and the drop marker
		// with it — exactly where they are is what keeps the two of them from nudging the
		// layout back and forth frame after frame while the tile is held there.
		// The edge-hold is not armed here: by the time the tile has reached the fence its
		// clamped delta has stopped changing, so this handler is no longer being called at
		// all. It is read from the raw pointer instead — see the `pointermove` effect above.
		const gridEl = weekGridRef.current;
		const pressStartX = (event.activatorEvent as MouseEvent | undefined)?.clientX;
		if (
			gridEl &&
			typeof pressStartX === 'number' &&
			pressStartX + delta.x > gridEl.getBoundingClientRect().right + 4
		) {
			// Fenced against the grid's right edge. The fence clamps only the horizontal
			// travel, so the tile still rides the pointer up and down — keep the drop rule
			// on its top edge or it detaches and floats above the tile by that distance.
			// Only the rule is refreshed here: the preview and the times stay put, so the
			// resting tiles are never nudged frame after frame.
			setDragIndicatorTop(dragIndicatorTopFor(
				activeEvent.startTime.getHours(),
				activeEvent.startTime.getMinutes(),
				delta.y
			));
			return;
		}

		if (overData?.date) {
			currentDragTargetDateRef.current = overData.date;
		}
		const targetDate = currentDragTargetDateRef.current || activeEvent.startTime;
		// Only re-render the headers when the pointer crosses into another day, so a
		// drag across the grid costs one paint per day boundary, not one per frame.
		const targetDayKey = targetDate.toDateString();
		setDragTargetDayKey(prev => (prev === targetDayKey ? prev : targetDayKey));
		const timeShiftHours = delta.y / pxPerHour;

		const newStart = new Date(targetDate);
		newStart.setHours(activeEvent.startTime.getHours(), activeEvent.startTime.getMinutes(), 0, 0);
		newStart.setTime(newStart.getTime() + timeShiftHours * 60 * 60 * 1000);

		let snappedStart = snapTo15(newStart);
		const duration = Math.max(30 * 60 * 1000, activeEvent.endTime.getTime() - activeEvent.startTime.getTime());
		let snappedEnd = new Date(snappedStart.getTime() + duration);

		// Boundary check: cannot go beyond the start or end of the target day (12 AM to 11:59 PM)
		const dayStart = new Date(targetDate);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = new Date(targetDate);
		dayEnd.setHours(23, 59, 0, 0);

		if (snappedEnd.getTime() >= dayEnd.getTime()) {
			snappedEnd = dayEnd;
			snappedStart = snapTo15(new Date(Math.max(dayStart.getTime(), dayEnd.getTime() - duration)));
		}
		if (snappedStart.getTime() < dayStart.getTime()) {
			snappedStart = dayStart;
			snappedEnd = new Date(Math.min(dayEnd.getTime(), dayStart.getTime() + duration));
		}

		if (
			!lastDragTimesRef.current ||
			lastDragTimesRef.current.startTime.getTime() !== snappedStart.getTime() ||
			lastDragTimesRef.current.endTime.getTime() !== snappedEnd.getTime()
		) {
			lastDragTimesRef.current = { startTime: snappedStart, endTime: snappedEnd };
			setDraggingEventTimes({
				id: String(active.id),
				startTime: snappedStart,
				endTime: snappedEnd
			});
			setDragIndicatorTop((snappedStart.getHours() + snappedStart.getMinutes() / 60) * pxPerHour);

			if (onEventModified) {
				onEventModified({
					...activeEvent,
					startTime: snappedStart,
					endTime: snappedEnd
				});
			}
		}
	};

	const handleDragCancel = () => {
		stopEdgeHold();
		dragDeltaYRef.current = 0;
		setActiveDragId(null);
		setDraggingEventTimes(null);
		setDragTargetDayKey(null);
		setDragIndicatorTop(null);
		setDupCalMonth(null);
		dupCalAnchorRef.current = null;
		setDupCalAnchor(null);
		lastDragTimesRef.current = null;
		currentDragTargetDateRef.current = null;
		if (originalDragEventRef.current && onEventModified) {
			onEventModified(originalDragEventRef.current);
		}
		originalDragEventRef.current = null;
		dragOriginColumnIndexRef.current = -1;
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over, delta, activatorEvent } = event;

		const wasDuplicating = isDuplicatingNow ||
			Boolean(
				(activatorEvent as MouseEvent)?.metaKey ||
				(activatorEvent as MouseEvent)?.ctrlKey ||
				(activatorEvent as MouseEvent)?.altKey ||
				isCmdPressedRef.current
			);

		stopEdgeHold();
		dragDeltaYRef.current = 0;
		setActiveDragId(null);
		setDraggingEventTimes(null);
		setDragTargetDayKey(null);
		setDragIndicatorTop(null);
		setDupCalMonth(null);
		dupCalAnchorRef.current = null;
		setDupCalAnchor(null);
		lastDragTimesRef.current = null;

		const overData = over?.data.current as { date?: Date; dupCalDay?: boolean; dupCalPanel?: boolean } | undefined;
		// A day on the pop-out calendar, if that is what the pointer came down on.
		const popoutDay = overData?.dupCalDay && overData.date ? overData.date : null;

		// A duplicate drag must never carry the original event along with it, so
		// whatever the live preview wrote during the drag is rolled back here.
		const restoreOriginal = () => {
			if (originalDragEventRef.current && onEventModified) {
				onEventModified(originalDragEventRef.current);
			}
		};

		const finishDrag = () => {
			originalDragEventRef.current = null;
			currentDragTargetDateRef.current = null;
			dragOriginColumnIndexRef.current = -1;
		};

		const hasActuallyMoved = Math.hypot(delta.x, delta.y) >= 6;
		if (!hasActuallyMoved) {
			restoreOriginal();
			finishDrag();
			return;
		}

		// Released on the pop-out itself — its header, its nav, its padding — rather
		// than on one of its days. Treat that as "never mind" instead of guessing at a
		// day hidden behind the panel.
		if (overData?.dupCalPanel && !popoutDay) {
			restoreOriginal();
			finishDrag();
			return;
		}

		const targetDate = popoutDay || (overData?.date as Date) || currentDragTargetDateRef.current;

		if (targetDate) {
			// As in `handleDragMove`: the tile's own data is gone the moment the edge-hold
			// pages its day column off screen, so the snapshot taken at drag start is what
			// the drop is built from.
			const activeEvent = (originalDragEventRef.current || active.data.current) as CalendarEvent | undefined;

			if (activeEvent && activeEvent.startTime && activeEvent.endTime) {
				const duration = Math.max(30 * 60 * 1000, activeEvent.endTime.getTime() - activeEvent.startTime.getTime());
				let snappedStart: Date;
				let snappedEnd: Date;

				if (popoutDay) {
					// Dropped on a day in the pop-out: keep the event's own time of day and
					// only change the date. No vertical offset is meaningful up there, since
					// the tile was never over the time grid.
					snappedStart = new Date(popoutDay);
					snappedStart.setHours(activeEvent.startTime.getHours(), activeEvent.startTime.getMinutes(), 0, 0);
					snappedEnd = new Date(snappedStart.getTime() + duration);
				} else {
					const timeShiftHours = delta.y / pxPerHour;

					const newStart = new Date(targetDate);
					newStart.setHours(activeEvent.startTime.getHours(), activeEvent.startTime.getMinutes(), 0, 0);
					newStart.setTime(newStart.getTime() + timeShiftHours * 60 * 60 * 1000);

					snappedStart = snapTo15(newStart);
					snappedEnd = new Date(snappedStart.getTime() + duration);
				}

				// Boundary check: cannot go beyond the start or end of the target day (12 AM to 11:59 PM)
				const dayBase = popoutDay || targetDate;
				const dayStart = new Date(dayBase);
				dayStart.setHours(0, 0, 0, 0);
				const dayEnd = new Date(dayBase);
				dayEnd.setHours(23, 59, 0, 0);

				if (snappedEnd.getTime() >= dayEnd.getTime()) {
					snappedEnd = dayEnd;
					snappedStart = snapTo15(new Date(Math.max(dayStart.getTime(), dayEnd.getTime() - duration)));
				}
				if (snappedStart.getTime() < dayStart.getTime()) {
					snappedStart = dayStart;
					snappedEnd = new Date(Math.min(dayEnd.getTime(), dayStart.getTime() + duration));
				}

				if (wasDuplicating) {
					// Duplicate: the original stays put and a brand-new copy is created
					// wherever the tile was released — on the grid, or on a day in the
					// pop-out calendar.
					restoreOriginal();
					const newDuplicateId = Math.random().toString(36).substring(7);
					const duplicateEvent: CalendarEvent = {
						...activeEvent,
						id: newDuplicateId,
						startTime: snappedStart,
						endTime: snappedEnd
					};
					setEvents(prev => [...prev, duplicateEvent]);
					if (onEventSelect) onEventSelect(duplicateEvent);
					if (onEventModified) onEventModified(duplicateEvent);

					// Sent to a day in the pop-out calendar: follow the copy there. Without
					// this the duplicate would land on a day the user cannot see, since the
					// pop-out exists precisely to reach days that are off-screen.
					if (popoutDay && onSelectDate) {
						const landed = new Date(popoutDay);
						landed.setHours(0, 0, 0, 0);
						onSelectDate(landed);
					}
				} else {
					// Normal move
					setEvents(prev => prev.map(e => {
						if (e.id === active.id) {
							const updatedE = { ...e, startTime: snappedStart, endTime: snappedEnd };
							if (onEventModified) onEventModified(updatedE);
							return updatedE;
						}
						return e;
					}));
				}
			}
		} else {
			restoreOriginal();
		}
		finishDrag();
	};

	const handleResizeEnd = (id: string, newStart: Date, newEnd: Date) => {
		setEvents(prev => prev.map(e => {
			if (e.id === id) {
				let finalEnd = newEnd;
				const dayEnd = new Date(newStart);
				dayEnd.setHours(23, 59, 0, 0);
				if (finalEnd.getTime() >= dayEnd.getTime()) {
					finalEnd = dayEnd;
				}
				if (finalEnd.getTime() - newStart.getTime() < 28 * 60 * 1000) {
					finalEnd = new Date(Math.min(dayEnd.getTime(), newStart.getTime() + 30 * 60 * 1000));
				}
				const updatedE = { ...e, startTime: newStart, endTime: finalEnd };
				if (onEventModified) onEventModified(updatedE);
				return updatedE;
			}
			return e;
		}));
	};

	// A tile in flight is normally drawn on the day it started from. An edge-hold page
	// step can carry that day off screen, though, and the tile would be unmounted along
	// with its column — so while its own day is out of the window the tile is re-homed.
	//
	// The re-homing deliberately keeps the tile's own box exactly as it was: it returns
	// to the same column *index* it started in, at the same time of day and duration, so
	// the box the pointer is carrying never moves. That stillness is the whole point.
	// dnd-kit cancels a layout shift by measuring the dragged node, but the cancellation
	// lands a frame after the shift, so any rect change shows up as a one-frame jump —
	// the flicker and jitter a quickly-moved tile displayed. With the rect held still
	// there is nothing to cancel: the tile merely keeps existing while the page turns
	// silently beneath it. The drop itself is unaffected — it is built from the pointer
	// and `over` in `handleDragEnd`, never from this preview.
	// Events the grid should actually draw. A profile switched off in the default
	// right pane only filters its tiles out here — the event objects themselves and
	// the `events` array the rest of the grid edits are left completely alone, so
	// toggling a profile back on restores its tiles exactly as they were.
	const visibleEvents = useMemo(() => {
		if (!hiddenProfileIds || hiddenProfileIds.size === 0) return events;
		return events.filter(e => !e.profileId || !hiddenProfileIds.has(e.profileId));
	}, [events, hiddenProfileIds]);

	let displayEvents = draftEvent ? [...visibleEvents, draftEvent] : visibleEvents;
	if (activeDragId && draggingEventTimes) {
		const moving = displayEvents.find(e => e.id === draggingEventTimes.id);
		if (moving && !days.some(d => isSameDay(d, moving.startTime))) {
			const origin = originalDragEventRef.current;
			const homeIndex = dragOriginColumnIndexRef.current;
			const homeDay = homeIndex >= 0 && homeIndex < days.length ? days[homeIndex] : days[0];
			// The event's own time of day and duration — never the live dragged times —
			// so the re-homed box sits at exactly the height the box had at pick-up.
			const baseStart = origin ? origin.startTime : draggingEventTimes.startTime;
			const baseEnd = origin ? origin.endTime : draggingEventTimes.endTime;
			const baseDuration = Math.max(30 * 60 * 1000, baseEnd.getTime() - baseStart.getTime());
			const frozenStart = new Date(homeDay);
			frozenStart.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
			const frozenEnd = new Date(frozenStart.getTime() + baseDuration);
			displayEvents = displayEvents.map(e => e.id === moving.id
				? { ...e, startTime: frozenStart, endTime: frozenEnd }
				: e);
		}
	}

	// The clock in the timer column header only animates while something is truly
	// counting down — a still clock is the honest state.
	const hasRunningTimer = Boolean(timers && timers.some((t: any) => t?.isPlaying));
	// The chase arc is deliberately accented even when accents are switched off: a
	// running timer is the one signal here that should read as live and coloured. It
	// resolves the chosen accent directly rather than leaning on `--sleek-accent`,
	// which does not exist in no-accent mode — and softens it the same way `App`
	// softens the app-wide accent, so this one direct resolution is not the single
	// place left showing the raw swatch.
	const chaseAccentHex = toneDownAccent(resolveAccentHex(plugin?.settings?.accentColor || plugin?.settings?.themeColor || 'blue') || DEFAULT_ACCENT_HEX) || DEFAULT_ACCENT_HEX;

	// Calendar profiles offered by each tile's right-click menu, mirroring the picker
	// under the event title in the right pane.
	const calendarProfiles: CalendarProfile[] = useMemo(
		() => (Array.isArray(plugin?.settings?.calendarProfiles) ? plugin!.settings.calendarProfiles : []),
		[plugin]
	);

	const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
	const viewDropdownRef = useRef<HTMLDivElement>(null);

	// Dismiss the "days in view" dropdown as soon as the user clicks/taps anywhere
	// outside it (or presses Escape), instead of only closing after a selection.
	useEffect(() => {
		if (!isViewMenuOpen) return;
		const handlePointerDown = (e: MouseEvent | TouchEvent) => {
			const target = e.target as Node | null;
			if (viewDropdownRef.current && target && !viewDropdownRef.current.contains(target)) {
				setIsViewMenuOpen(false);
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setIsViewMenuOpen(false);
		};
		document.addEventListener('mousedown', handlePointerDown);
		document.addEventListener('touchstart', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
			document.removeEventListener('touchstart', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isViewMenuOpen]);

	const handleBtnHoverEnter = (e: React.MouseEvent<HTMLElement>) => {
		e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
		e.currentTarget.style.filter = 'brightness(1.2)';
		e.currentTarget.style.transform = 'translateY(-1px)';
	};

	const handleBtnHoverLeave = (e: React.MouseEvent<HTMLElement>) => {
		e.currentTarget.style.backgroundColor = '';
		e.currentTarget.style.filter = '';
		e.currentTarget.style.transform = '';
	};

	const handleDayHeaderHoverEnter = (e: React.MouseEvent<HTMLElement>) => {
		e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
		e.currentTarget.style.opacity = '1';
		e.currentTarget.style.filter = 'brightness(1.2)';
		e.currentTarget.style.transform = 'translateY(-1px)';
	};

	const handleDayHeaderHoverLeave = (e: React.MouseEvent<HTMLElement>) => {
		e.currentTarget.style.backgroundColor = '';
		e.currentTarget.style.opacity = '';
		e.currentTarget.style.filter = '';
		e.currentTarget.style.transform = '';
	};

	const handleCreateNewEvent = () => {
		const now = new Date();
		const ms = 15 * 60 * 1000;
		const startTime = new Date(Math.ceil(now.getTime() / ms) * ms);
		const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

		const newEvent: CalendarEvent = {
			id: Math.random().toString(36).substring(2, 9),
			// Untitled on purpose: the right pane's placeholder names it, and the tile shows
			// its own "Event" fallback until the user types something.
			title: '',
			startTime,
			endTime,
			colorTheme: defaultEventColor,
		};

		setEvents(prev => [...prev, newEvent]);

		if (!days.some(d => isSameDay(d, startTime))) {
			if (onNavigate) {
				onNavigate('today');
			}
		}

		if (onEventSelect) {
			onEventSelect(newEvent);
		}
		if (onCreateEvent) {
			onCreateEvent();
		}

		setTimeout(() => {
			scrollToCurrentTime(true);
		}, 50);
	};

	return (
		<MainErrorBoundary>
			<DndContext sensors={sensors} collisionDetection={collisionDetection} modifiers={dragModifiers} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
				<div className="sleek-main-grid" style={{ zIndex: 10, position: 'relative' }}>
					<div className="grid-header">
						<div
							className="current-month"
							onMouseEnter={handleBtnHoverEnter}
							onMouseLeave={handleBtnHoverLeave}
							onClick={() => { if (viewMode === 'month') requestMonthSnap(); }}
							title={viewMode === 'month' ? 'Settle this month back onto a whole month' : undefined}
							style={{ borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', transition: 'all 0.15s ease' }}
						>
							<h2 style={{ margin: 0 }}>{format(currentDate, 'MMMM yyyy')}</h2>
						</div>

						<div className="controls-group">
							<div className="view-dropdown" ref={viewDropdownRef}>
								<button
									className={`view-dropdown-btn ${isViewMenuOpen ? 'open' : ''}`}
									onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
									onMouseEnter={handleBtnHoverEnter}
									onMouseLeave={handleBtnHoverLeave}
									title="Change number of days displayed"
								>
									<span>{viewMode === 'month' ? 'Month' : `${daysToView} ${daysToView === 1 ? 'day' : 'days'}`}</span>
									<span className="dropdown-arrow">▼</span>
								</button>
								{isViewMenuOpen && (
									<div className="view-dropdown-menu">
										{[1, 2, 3, 4, 5, 6, 7].map(num => (
											<div
												key={num}
												className={`view-dropdown-item ${viewMode === 'days' && num === daysToView ? 'active' : ''}`}
												onClick={() => { setViewMode('days'); setDaysToView(num); setIsViewMenuOpen(false); }}
												onMouseEnter={(e) => {
													e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
													e.currentTarget.style.filter = 'brightness(1.15)';
												}}
												onMouseLeave={(e) => {
													e.currentTarget.style.backgroundColor = '';
													e.currentTarget.style.filter = '';
												}}
											>
												{num} {num === 1 ? 'day' : 'days'}
											</div>
										))}
										{/* The full-month shape. Choosing it swaps the day columns for a
												  seven-across month grid; the timeline drops away with them. */}
										<div
											key="month"
											className={`view-dropdown-item ${viewMode === 'month' ? 'active' : ''}`}
											onClick={() => { setViewMode('month'); setIsViewMenuOpen(false); }}
											onMouseEnter={(e) => {
												e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
												e.currentTarget.style.filter = 'brightness(1.15)';
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.backgroundColor = '';
												e.currentTarget.style.filter = '';
											}}
										>
											Month
										</div>
									</div>
								)}

							</div>

							<button
								className="add-event-btn"
								onClick={handleCreateNewEvent}
								onMouseEnter={handleBtnHoverEnter}
								onMouseLeave={handleBtnHoverLeave}
							>
								+ New Event
							</button>

							<div className="date-nav-buttons">
								<button
									className="today-nav-btn"
									onClick={() => {
										// Today is the other place a reader asks for a clean picture: the date
										// moves to today, and the month grid is asked to settle back onto a
										// whole month in case the wheel had left it resting mid-scroll.
										if (onNavigate) onNavigate('today');
										if (viewMode === 'month') requestMonthSnap();
										if (viewMode === 'days') scrollToCurrentTime(true);
									}}
									onMouseEnter={handleBtnHoverEnter}
									onMouseLeave={handleBtnHoverLeave}
									title={viewMode === 'month' ? 'Jump to today' : 'Scroll to current time'}
								>
									Today
								</button>
								<div className="nav-arrow-group">
									<button
										className="nav-arrow-btn"
										onClick={() => handleStepView('prev')}
										onMouseEnter={handleBtnHoverEnter}
										onMouseLeave={handleBtnHoverLeave}
										title="Previous"
									>
										&lt;
									</button>
									<button
										className="nav-arrow-btn"
										onClick={() => handleStepView('next')}
										onMouseEnter={handleBtnHoverEnter}
										onMouseLeave={handleBtnHoverLeave}
										title="Next"
									>
										&gt;
									</button>
								</div>
							</div>

							<button
								className="timer-toggle-btn"
								onClick={() => {
									// Timers live on the day view's hour scale, so this control is
									// simply inert while the month is on screen.
									if (viewMode === 'month') return;
									setShowTimerColumn(!showTimerColumn);
								}}
								title={viewMode === 'month'
									? 'Timers are a day-view tool'
									: showTimerColumn ? "Hide Timer Column" : "Show Timer Column"}
								style={{
									display: 'flex', alignItems: 'center', justifyContent: 'center',
									// Accent only while the timer column is active; neutral otherwise.
									background: showTimerColumn && viewMode !== 'month' ? 'var(--sleek-accent, var(--background-modifier-hover))' : 'transparent',
									color: viewMode === 'month'
										? 'var(--text-faint)'
										: showTimerColumn
											? (accentColor ? 'rgba(0, 0, 0, 0.85)' : 'var(--text-normal)')
											: 'var(--text-muted)',
									border: '1px solid var(--background-modifier-border)',
									borderRadius: '6px', padding: '4px 15px', minWidth: '48px', height: '28px',
									cursor: viewMode === 'month' ? 'not-allowed' : 'pointer',
									opacity: viewMode === 'month' ? 0.45 : 1,
									marginLeft: '8px', transition: 'all 0.15s ease'
								}}
								onMouseEnter={(e) => {
									if (viewMode === 'month') return;
									if (!showTimerColumn) {
										e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
										e.currentTarget.style.color = 'var(--text-normal)';
									}
								}}
								onMouseLeave={(e) => {
									if (viewMode === 'month') return;
									if (!showTimerColumn) {
										e.currentTarget.style.backgroundColor = 'transparent';
										e.currentTarget.style.color = 'var(--text-muted)';
									}
								}}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
									<circle cx="12" cy="12" r="10"></circle>
									<polyline points="12 6 12 12 16 14"></polyline>
								</svg>
							</button>

							{/* Settings gear: opens the in-calendar settings menu, anchored here
								   so the menu drops down directly beneath it. Styled to match the
								   other header controls. */}
							<button
								ref={settingsBtnRef}
								data-sleek-settings-anchor="true"
								onClick={openSettings}
								style={{
									display: 'flex', alignItems: 'center', justifyContent: 'center',
									background: settingsOpen ? 'var(--background-modifier-hover)' : 'transparent',
									color: settingsOpen ? 'var(--text-normal)' : 'var(--text-muted)',
									border: '1px solid var(--background-modifier-border)',
									borderRadius: '6px', padding: '4px 10px', height: '28px',
									cursor: 'pointer', transition: 'all 0.15s ease'
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									e.currentTarget.style.color = 'var(--text-normal)';
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor = settingsOpen ? 'var(--background-modifier-hover)' : 'transparent';
									e.currentTarget.style.color = settingsOpen ? 'var(--text-normal)' : 'var(--text-muted)';
								}}
								title="Calendar settings"
								aria-label="Calendar settings"
							>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
									<circle cx="12" cy="12" r="3"></circle>
									<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
								</svg>
							</button>
						</div>
					</div>

					<div className="main-grid-flex-wrapper" ref={mainFlexRef} style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
						{/* Optional doodle backdrop: a faint, theme-neutral ink wash that
						    lingers behind BOTH the calendar grid and the timer column. It is
						    painted once here, on the shared flex wrapper, so a single mask
						    runs continuously across both panes. Purely decorative — never
						    interactive. */}
						<div className="sleek-doodle-layer" aria-hidden="true" />
						{/* Alternative "Simple shapes" style: animated DOM shapes. It stays in
						    the tree and is revealed purely by the sleek-has-shapes class. Its
						    amount / size / rotation / stroke all come from the plugin settings,
						    clamped here so a hand-edited data.json can't break the layout. */}
						<ShapesBackdrop
							count={clampDoodleShapeCount(plugin?.settings?.doodleShapeCount)}
							sizeScale={clampDoodleShapeSize(plugin?.settings?.doodleShapeSize) / 100}
							rotation={clampDoodleShapeRotation(plugin?.settings?.doodleShapeRotation)}
							strokeWidth={clampDoodleShapeStroke(plugin?.settings?.doodleShapeStroke)}
							spread={clampDoodleShapeSpread(plugin?.settings?.doodleShapeSpread)}
						/>
						{/* Holding a tile against either end of the grid pages the window on. While
						    the hold is armed this pill rides that end — over the timer column on the
						    right, over the time labels on the left — so the gesture reads as "the
						    calendar is about to move on". Its floor fills over the dwell, making the
						    wait legible. Decorative only: `pointer-events: none`, so it never
						    disturbs the drag. */}
						{activeDragId && edgeHoldDir && (
							<div className={`sleek-edge-step-hint is-${edgeHoldDir}`} aria-hidden="true">
								{edgeHoldDir === 'prev' && (
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
										<polyline points="15 18 9 12 15 6" />
									</svg>
								)}
								<span className="sleek-edge-step-text">
									{edgeHoldDir === 'next' ? 'Next days' : 'Previous days'}
								</span>
								{edgeHoldDir === 'next' && (
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
										<polyline points="9 18 15 12 9 6" />
									</svg>
								)}
							</div>
						)}
						{/* Command-dragging a tile duplicates it and pops out a one-month
						    calendar: drop the copy on any day there, or ignore the panel and
						    drop it on the grid as usual. Control-dragging duplicates without
						    the panel, so the copy can be dragged freely across the grid. The
						    panel unmounts the instant Command is released. */}
						{showDupCalendar && dupCalMonth && dupCalAnchor && (
							<DuplicateDropCalendar
								month={dupCalMonth}
								onMonthChange={setDupCalMonth}
								anchor={dupCalAnchor}
								hostRef={mainFlexRef}
								preview={activeDragId ? events.find(e => e.id === activeDragId) || null : null}
							/>
						)}
						{viewMode === 'month' ? (
							<div className="month-grid-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
								<MonthView
									currentDate={currentDate}
									events={visibleEvents}
									defaultDayColor={monthDefaultColor}
									dayColors={monthDayColors}
									onChangeDayColor={handleChangeDayColor}
									onResetDayColor={handleResetDayColor}
									onOpenDay={handleOpenDay}
									onDropItem={handleMonthDrop}
									autoColors={monthAutoDayColors}
									onSeedAutoColors={handleSeedMonthAutoColors}
									onStepMonth={handleStepMonth}
									onCopyDayEvents={handleCopyDayEvents}
									snapSignal={monthSnapSignal}
									accentColor={accentColor}
								/>
							</div>
						) : (
							<div className="week-grid-container" style={{ display: 'flex', flexDirection: 'column', flex: days.length, borderRight: 'none', overflow: 'hidden' }}>
								{/* Static Headers (Decoupled from scrolling body) */}
								<div className="grid-headers-wrapper" style={{ display: 'flex', height: '82px', flexShrink: 0, zIndex: 10 }}>
									<div className="time-column-header-spacer" style={{ width: '50px', flexShrink: 0, height: '100%', position: 'relative' }} />
									<div className="days-header" style={{ flex: 1, display: 'flex', position: 'relative' }}>
										{days.map((day, i) => {
											const isSelected = isSameDay(day, currentDate);
											const isToday = isSameDay(day, currentTime);
											const isCollapsed = Boolean(collapsedDays[collapsedKey(day)]);
											const isJumpHighlight = jumpHighlightKey === day.toDateString();
											const isDropTarget = dragTargetDayKey === day.toDateString();
											return (
												<div key={i} className={`day-header${isDropTarget ? ' is-drop-target' : ''}`} style={{ flex: 1 }}>
													<div
														className={`day-header-inner ${isSelected ? 'active' : ''} ${isToday ? 'today' : ''} ${isCollapsed ? 'is-collapsed' : ''} ${isJumpHighlight ? 'is-jump-highlight' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
														title={`${format(day, 'EEEE, MMMM d, yyyy')} — click to ${isCollapsed ? 'show' : 'hide'} events`}
														onClick={() => toggleDayCollapsed(day)}
														onMouseEnter={handleDayHeaderHoverEnter}
														onMouseLeave={handleDayHeaderHoverLeave}
													>
														<span className="day-number">{format(day, 'dd')}</span>
														<span className="day-name">{format(day, 'EEE')}</span>
													</div>
													<div className="day-header-tick" />
												</div>
											);
										})}
									</div>
								</div>

								{/* Scrolling Body */}
								{/* `overflowX: hidden` on purpose: with only `overflowY` set, the other
							    axis resolves to `auto`, and a tile dragged to the right used to grow
							    the scrollable width — which parked a horizontal scrollbar on the grid
							    and gave dnd-kit something to scroll back and forth. Pinning the axis
							    to `hidden` keeps the scrollport's shape fixed; the tile is clipped at
							    the edge instead of pushing the layout around. */}
								<div className="week-grid" ref={weekGridRef} style={{ display: 'flex', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
									{/* Current-time indicator: spans the full width (including under the hour
								    labels) and is non-interactive so it never blocks drag-to-create.
								    While a tile is being dragged it becomes the drop indicator instead,
								    riding the tile's top edge so the landing time can be read off the
								    scale; while an edge-resize handle is dragged it becomes the same
								    marker on the edge being moved. Either way it steps above the tiles
								    so it stays readable. */}
									<div
										className={`current-time-line${isIndicatorActive ? ' is-drag-indicator' : ''}`}
										aria-hidden="true"
										style={{
											top: `${timeLineTop}px`,
											pointerEvents: 'none',
											// While the duplicate drop-calendar pop-out is open the
											// temporary indicator is hidden outright: during a Meta
											// duplication it would ride the tile right across the mini
											// calendar the user is aiming at and get in the way of it.
											display: showDupCalendar ? 'none' : undefined,
											// Day columns carry z-index 1, so 0 keeps the rule beneath the
											// tiles at rest; racing it above them only while a tile is
											// dragged or an edge handle is being dragged.
											zIndex: isIndicatorActive ? 40 : 0
										}}
									>
										<div className="current-time-marker" style={{ pointerEvents: 'none' }} />
									</div>

									{/* Left: Time Column */}
									<div
										className="time-column"
										style={{ cursor: 'ns-resize', height: `${24 * pxPerHour}px`, flexShrink: 0 }}
										onPointerDown={handleTimeScalePointerDown}
										title="Drag up or down to zoom time scale"
									>
										{Array.from({ length: 24 }).map((_, i) => {
											const hour24 = i;
											const hour12 = hour24 === 0 ? 12 : (hour24 > 12 ? hour24 - 12 : hour24);
											const ampm = hour24 < 12 ? 'am' : 'pm';
											const isCurrentHour = i === currentTime.getHours();
											return (
												<div
													key={i}
													className={`time-slot-label${isCurrentHour ? ' current-hour' : ''}`}
													style={{
														height: `${pxPerHour}px`,
														minHeight: `${pxPerHour}px`,
														maxHeight: `${pxPerHour}px`,
														flex: `0 0 ${pxPerHour}px`,
														transform: i === 0 ? 'translateY(2px)' : undefined
													}}
												>
													{hour12} {ampm}
												</div>
											);
										})}
									</div>

									{/* Right: Days Columns */}
									<div className="days-columns">
										<div
											className="days-body"
											style={{
												flex: 1,
												minWidth: 0,
												height: `${24 * pxPerHour}px`,
												minHeight: `${24 * pxPerHour}px`,
												backgroundSize: `100% ${pxPerHour}px`,
												position: 'relative',
												display: 'flex'
											}}
										>
											{/* Current-time indicator: purely decorative overlay.
										    Rendered before the day columns and given z-index 0 so it always
										    paints UNDER event tiles, and pointer-events:none so it never
										    intercepts clicks/drag-to-create on the grid. */}
											{days.map((day, i) => (
												<DayColumn
													key={i}
													day={day}
													events={displayEvents.filter(e => isSameDay(e.startTime, day))}
													onResizeEnd={handleResizeEnd}
													onResizeIndicator={setResizeIndicatorTop}
													onBackgroundPointerDown={handleBackgroundPointerDown}
													onEventClick={onEventSelect}
													selectedEventId={selectedEventId}
													pxPerHour={pxPerHour}
													onNativeDrop={handleNativeDrop}
													onDropOnEvent={handleDropOnEvent}
													activeDragId={activeDragId}
													isDuplicatingNow={isDuplicatingNow}
													onDeleteEvent={handleDeleteEvent}
													onUpdateEvent={handleEventUpdate}
													onDuplicateEvent={handleDuplicateEvent}
													draggingEventTimes={draggingEventTimes}
													collapsed={Boolean(collapsedDays[collapsedKey(day)])}
													begunEventIds={begunEventIds}
													revealActive={revealActive}
													showTileDetails={showTileDetails}
													calendarProfiles={calendarProfiles}
												/>
											))}

										</div>
									</div>
								</div>
							</div>
						)}

						{showTimerColumn && viewMode !== 'month' && (
							<div className="timer-zone" style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--background-primary)', minHeight: 0 }}>
								{/* No bottom border here: the calendar's own header has none either, so a
								    rule across the timer column only ever read as a stray line. A press on
								    the header is a press on empty column, so it also drops the details
								    pane back to its default view. */}
								<div className="days-header" style={{ borderLeft: 'none' }} onPointerDown={() => onEventSelect(null as any)}>

									<div className="day-header timer-header" style={{ borderLeft: 'none', justifyContent: 'flex-start' }}>
										<div className="day-header-inner">
											<div className="day-number" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
												<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
													<circle cx="12" cy="12" r="10"></circle>
													<polyline points="12 6 12 12 16 14"></polyline>
													{/* Only while a timer is running: a short accent-coloured arc
													    that chases slowly around the face. Nothing at all when
													    nothing runs. */}
													{hasRunningTimer && (
														<circle
															className="timer-chase-arc"
															cx="12"
															cy="12"
															r="10"
															pathLength={100}
															style={{ stroke: chaseAccentHex }}
														></circle>
													)}
												</svg>
											</div>

										</div>
									</div>

								</div>
								{/* The timer column does its own scrolling — and only when the
								    tiles actually need the room — so this wrapper never does. */}
								<div style={{ flex: 1, overflow: 'hidden' }}>

									<TimerColumn
										timers={timers}
										setTimers={setTimers}
										pxPerHour={timerPxPerHour}
										plugin={plugin}
										revealActive={revealActive}
										onBackgroundClick={() => onEventSelect(null as any)}
										onCompleteTodo={(eventId, todoId) => {
											let updatedEvent = null;
											setEvents(prev => prev.map(ev => {
												if (ev.id === eventId && ev.todos) {
													const updated = { ...ev, todos: ev.todos.map(t => t.id === todoId ? { ...t, completed: true } : t) };
													updatedEvent = updated;
													return updated;
												}
												return ev;
											}));
											if (updatedEvent && onEventModified) {
												onEventModified(updatedEvent);
											}
										}}
									/>

								</div>
							</div>

						)}
					</div>
				</div>
			</DndContext>
			{settingsOpen && (
				<CalendarSettingsMenu plugin={plugin} anchorRect={settingsAnchor} onClose={() => setSettingsOpen(false)} />
			)}
		</MainErrorBoundary>
	);
};
