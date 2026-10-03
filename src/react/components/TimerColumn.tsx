import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { TimerTile } from '../../types';
import { extractObsidianDoc } from '../../utils/dragDrop';
import { EVENT_COLOR_HEX, hexToRgba, TIMER_COLOR_NAMES, TIMER_QUICK_COLORS, DEFAULT_TIMER_COLOR } from '../../utils/colors';
import SleekCalendarPlugin from '../../main';

// The swatches a timer tile may wear come from the shared palette (see
// `TIMER_COLOR_NAMES` in utils/colors): the deeper share of it, which now carries a
// set of muted tans, browns and greys alongside the dimmer blues, reds, pinks and
// purples. The bright end — yellow, banana, lime, and the palest pastels — is left
// out, because a tile's dark label simply cannot be read on those. The row of six
// lives in the tile's menu and the whole set is one click away behind the swatch
// selector beside it.

// The visible gap between two adjacent timer tiles (identical to calendar tiles).
const TILE_GAP_PX = 8;

// A tile's rendered height: its duration minus the gap, with a 36px floor.
const tileHeightPx = (t: TimerTile, pxPerHour: number) => {
	const raw = (t.timeRemainingMin || t.durationMin || 0) * (pxPerHour / 60);
	return Math.max(36, raw - TILE_GAP_PX);
};

// Derives a fully packed, bottom-anchored stack from an ordered list of tiles.
// Positions are always computed from heights + gaps, never from raw offsets,
// so tiles can never drift apart or overlap.
const packedLayout = (list: TimerTile[], pxPerHour: number, columnHeight: number) => {
	const heights = list.map(t => tileHeightPx(t, pxPerHour));
	const packed = heights.reduce((a, b) => a + b, 0) + Math.max(0, list.length - 1) * TILE_GAP_PX;
	const inner = Math.max(columnHeight, packed);
	const startTop = Math.max(0, inner - packed);
	const tops: number[] = [];
	let cursor = startTop;
	for (let i = 0; i < list.length; i++) {
		tops.push(cursor);
		cursor += heights[i] + TILE_GAP_PX;
	}
	return { heights, packed, inner, startTop, tops };
};

// Appends a tile to the very bottom of the stack and normalizes the order keys.
const appendTimer = (list: TimerTile[], tile: TimerTile): TimerTile[] => {
	const sorted = [...list].sort((a, b) => a.startOffsetMin - b.startOffsetMin);
	const next = [...sorted, { ...tile, startOffsetMin: sorted.length }];
	return next.map((t, i) => (t.startOffsetMin === i ? t : { ...t, startOffsetMin: i }));
};


class ErrorBoundary extends React.Component<{ children: any }, { error: any }> {
	constructor(props: any) {
		super(props);
		this.state = { error: null };
	}
	static getDerivedStateFromError(error: any) {
		return { error };
	}
	render() {
		if (this.state.error) {
			return <div style={{ color: 'red', padding: 20 }}><h1>TimerColumn Crash!</h1><pre>{this.state.error.toString()}\n{this.state.error.stack}</pre></div>;
		}
		return this.props.children;
	}
}

export const TimerColumn = ({
	timers,
	setTimers,
	pxPerHour,
	plugin,
	onCompleteTodo,
	onBackgroundClick,
	revealActive
}: {
	timers: TimerTile[],
	setTimers: React.Dispatch<React.SetStateAction<TimerTile[]>>,
	pxPerHour: number,
	plugin: SleekCalendarPlugin,
	onCompleteTodo?: (eventId: string, todoId: string) => void,
	onBackgroundClick?: () => void,
	/**
	 * True for a beat after the grid changes shape (month ↔ days, or the number of
	 * days in view). Every timer tile then drops in with the same springy entrance
	 * the calendar's event tiles use.
	 */
	revealActive?: boolean
}) => {




	const { setNodeRef } = useDroppable({
		id: 'timer-column',
		data: { type: 'timer' }
	});

	const [dynamicPxPerHour, setDynamicPxPerHour] = useState(pxPerHour);
	const measuredRef = setNodeRef;
	// The column's own root carries a local ref as well as the dnd-kit droppable one, so
	// the wheel handler below can look outward for the calendar's scrollport. The two
	// panes are siblings inside `.main-grid-flex-wrapper`, which is why the search walks
	// up to that shared wrapper instead of to a scrollable ancestor.
	const rootRef = useRef<HTMLDivElement | null>(null);
	const attachRoot = React.useCallback((node: HTMLDivElement | null) => {
		rootRef.current = node;
		measuredRef(node);
	}, [measuredRef]);
	useEffect(() => {
		const el = document.querySelector('.timer-column-root') as HTMLElement | null;
		const updateHeight = () => {
			if (!el) return;
			const rect = el.getBoundingClientRect();
			// Only a real change is worth a render — this also keeps the ResizeObserver
			// below from ever looping back on itself.
			if (rect.height > 100) {
				setDynamicPxPerHour(prev => (Math.abs(prev - rect.height) > 0.5 ? rect.height : prev));
			}
		};
		updateHeight();
		window.addEventListener('resize', updateHeight);
		// A ResizeObserver keeps the scale honest when the pane changes size without
		// the window changing size (opening a sidebar, dragging a split, toggling the
		// timer column itself).
		const ro = el ? new ResizeObserver(updateHeight) : null;
		if (el && ro) ro.observe(el);
		// A small timeout to be sure the very first layout has settled.
		const t1 = setTimeout(updateHeight, 100);
		const t2 = setTimeout(updateHeight, 500);
		return () => {
			window.removeEventListener('resize', updateHeight);
			if (ro) ro.disconnect();
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, []);

	const stackBottomMin = timers.reduce((acc, t) => acc + (t.timeRemainingMin || t.durationMin || 0), 0);
	const totalColumnMin = Math.max(60, stackBottomMin);
	const displayMin = Math.max(60, Math.min(180, stackBottomMin)); // Scale up to 3 hours
	const effectivePxPerHour = Math.max(1, dynamicPxPerHour) * (60 / displayMin);

	const columnHeightPx = totalColumnMin * (effectivePxPerHour / 60);

	// Order defines the stack. Positions are derived from heights + the shared 8px
	// gap and anchored to the bottom, so tiles can never drift apart or overlap.
	const orderedTimers = [...timers].sort((a, b) => a.startOffsetMin - b.startOffsetMin);
	const { tops: packedTops, inner: innerContainerHeight, startTop: stackStartTop, packed: packedHeight } =
		packedLayout(orderedTimers, effectivePxPerHour, columnHeightPx);
	const topPxMap = new Map<string, number>(orderedTimers.map((t, i) => [t.id, packedTops[i]]));
	const stackEndTop = stackStartTop + packedHeight;

	// The column should only ever scroll when the tiles genuinely need more room than
	// the visible scale can show. `innerContainerHeight` is the larger of that scale
	// and the packed stack, so "it fits" means the two are the same size — and in that
	// case the overflow is switched off outright, which is what keeps a hairline of
	// sub-pixel rounding from parking a scrollbar on the column forever.
	const fitsColumn = innerContainerHeight <= dynamicPxPerHour + 1;

	const numGridLines = Math.ceil(Math.max(totalColumnMin, (innerContainerHeight / effectivePxPerHour) * 60) / 60); const [draftTimer, setDraftTimer] = useState<TimerTile | null>(null);
	const [isTileDragging, setIsTileDragging] = useState(false);

	useEffect(() => {
		// Collapse any persisted free-floating offsets into a clean, gapless order.
		setTimers(prev => {
			const sorted = [...prev].sort((a, b) => a.startOffsetMin - b.startOffsetMin);
			let changed = false;
			const normalized = sorted.map((t, i) => {
				if (t.startOffsetMin !== i) {
					changed = true;
					return { ...t, startOffsetMin: i };
				}
				return t;
			});
			return changed ? normalized : prev;
		});
	}, [setTimers]);

	// Wheeling over the column's dead space scrolls the CALENDAR, not the column. Because
	// the grid and this column are siblings, a wheel that lands on blank column would
	// otherwise have nothing to scroll and simply die here. Only blank column is captured:
	// a wheel that starts on a tile (or inside its menu) returns untouched, so the
	// column's own overflow and every tile behaviour stay exactly as they were. Nothing
	// here reads or writes a single timer — no position, no state, no reordering; the
	// calendar's scrollport is moved by the same amount a wheel over the grid itself would
	// have moved it.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			// Pinch-zoom (ctrl+wheel) and purely horizontal gestures are none of our
			// business.
			if (e.ctrlKey || !e.deltaY) return;
			// Over a tile: leave it alone. The browser's native scroll then reaches the
			// column's own scrollport, which is the existing behaviour for a full column.
			if (e.target instanceof Element && e.target.closest('.timer-tile')) return;
			const scroller = el.closest('.main-grid-flex-wrapper')?.querySelector('.week-grid') as HTMLElement | null;
			if (!scroller) return;
			e.preventDefault();
			// `deltaMode` is pixels in practice, but keyboard and some mice report lines
			// (1) or pages (2); normalise so the step always reads as a screen-like nudge.
			const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1;
			scroller.scrollTop += e.deltaY * unit;
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, []);

	// Tick every minute to update active timers
	useEffect(() => {
		const interval = setInterval(() => {
			const now = Date.now();
			setTimers(prev => prev.map(t => {
				if (t.isPlaying && t.lastTickTime) {
					const elapsedMs = now - t.lastTickTime;
					const elapsedMin = elapsedMs / 60000;
					const newRemaining = Math.max(0, t.timeRemainingMin - elapsedMin);

					return {
						...t,
						timeRemainingMin: newRemaining,
						lastTickTime: now,
						isPlaying: newRemaining > 0 ? true : false
					};
				}
				return t;
			}).filter(t => t.timeRemainingMin > 0)); // Remove finished timers
		}, 10000); // Check every 10 seconds for smooth-ish updates
		return () => clearInterval(interval);
	}, [setTimers]);

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const doc = extractObsidianDoc(e.dataTransfer);
		if (doc) {
			const finalDuration = 15;
			const colorTheme = TIMER_QUICK_COLORS[timers.length % TIMER_QUICK_COLORS.length];

			const newTimer: TimerTile = {
				id: Math.random().toString(36).substring(7),
				title: doc.title,
				colorTheme,
				startOffsetMin: 0,
				durationMin: finalDuration,
				timeRemainingMin: finalDuration,
				isPlaying: false,
				todoId: doc.todoId,
				eventId: doc.eventId
			};
			// Always append at the bottom of the stack.
			setTimers(prev => appendTimer(prev, newTimer));
		}
	};

	// A press on empty column means "away from any event", so the details pane is
	// asked to fall back to its default view. Tiles call stopPropagation on their own
	// pointerdown, so anything landing here is genuinely blank column.
	const handleColumnBackground = (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		if (e.target !== e.currentTarget) return;
		onBackgroundClick?.();
	};

	const handlePointerDown = (e: React.PointerEvent) => {
		if (e.target !== e.currentTarget) return; // Only clicks on background
		onBackgroundClick?.();
		const rect = e.currentTarget.getBoundingClientRect();
		const startY = e.clientY - rect.top;
		const offsetMin = (startY / effectivePxPerHour) * 60;

		let maxDuration = Number.MAX_SAFE_INTEGER;
		for (const t of timers) {
		}

		let isDragging = false;
		const colorTheme = TIMER_QUICK_COLORS[timers.length % TIMER_QUICK_COLORS.length];

		const onPointerMove = (moveEvent: PointerEvent) => {
			const deltaY = moveEvent.clientY - (rect.top + startY);
			if (deltaY > 3) {
				isDragging = true;
				const rawDurationMin = (deltaY / effectivePxPerHour) * 60;
				const snappedDurationMin = Math.round(rawDurationMin / 5) * 5;
				setDraftTimer({
					id: 'draft',
					title: 'New Timer',
					colorTheme,
					startOffsetMin: 0,
					durationMin: Math.max(5, snappedDurationMin),
					timeRemainingMin: Math.max(5, snappedDurationMin),
					isPlaying: false
				});
			}
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);

			if (isDragging) {
				setDraftTimer(prev => {
					if (prev) {
						setTimers(t => appendTimer(t, { ...prev, id: Math.random().toString(36).substring(7) }));
					}
					return null;
				});
			} else {
				// Simple click creates a 15min timer
				setTimers(t => appendTimer(t, {
					id: Math.random().toString(36).substring(7),
					title: 'New Timer',
					colorTheme,
					startOffsetMin: 0,
					durationMin: Math.min(15, maxDuration),
					timeRemainingMin: Math.min(15, maxDuration),
					isPlaying: false
				}));
			}
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	};

	// Drag-to-reorder: the pointer's Y position picks the tile's new index in the
	// stack. Keys are rewritten so the list stays ordered; the packed layout
	// (bottom-anchored, 8px gaps) re-derives every position from that order.
	const handleTileDragMove = (id: string, desiredTopPx: number) => {
		if (!isTileDragging) setIsTileDragging(true);
		setTimers(prev => {
			const ordered = [...prev].sort((a, b) => a.startOffsetMin - b.startOffsetMin);
			const draggedIndex = ordered.findIndex(t => t.id === id);
			if (draggedIndex === -1 || ordered.length < 2) return prev;

			const dragged = ordered[draggedIndex];
			const others = ordered.filter(t => t.id !== id);

			const full = packedLayout(ordered, effectivePxPerHour, columnHeightPx);
			const rest = packedLayout(others, effectivePxPerHour, columnHeightPx);

			// Express the pointer centre in the "without dragged tile" layout space.
			const draggedHeight = full.heights[draggedIndex];
			const pointerCenter = desiredTopPx + draggedHeight / 2 - full.startTop + rest.startTop;

			let targetIndex = others.length;
			for (let i = 0; i < others.length; i++) {
				const center = rest.tops[i] + rest.heights[i] / 2;
				if (pointerCenter < center) {
					targetIndex = i;
					break;
				}
			}

			if (targetIndex === draggedIndex) return prev;

			const next = [...others];
			next.splice(targetIndex, 0, dragged);
			return next.map((t, i) => (t.startOffsetMin === i ? t : { ...t, startOffsetMin: i }));
		});
	};

	const handleTileDragEnd = () => setIsTileDragging(false);

	return (
		<ErrorBoundary>
			<div
				ref={attachRoot}
				className="timer-column-root"
				style={{ flex: 1, minWidth: 0, height: '100%', width: '100%', position: 'relative', borderLeft: 'none', backgroundColor: 'var(--background-primary)', overflowY: fitsColumn ? 'hidden' : 'auto', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', minHeight: 0 }}
				onDragEnter={(e) => { e.preventDefault(); }}
				onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
				onDrop={handleDrop}
				onPointerDown={handlePointerDown}
			>
				{/* Header with scale controls could go here, but they are in MainGrid */}

				<div
					className="day-column timer-column"
					style={{ width: '100%', height: `${innerContainerHeight}px`, position: 'relative' }}
					onPointerDown={handleColumnBackground}
					onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
					onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
					onDrop={handleDrop}
				>
					{/* Grid Lines */}
					<div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden' }}>
						{Array.from({ length: numGridLines + 1 }).map((_, i) => (
							<div key={i} style={{ position: 'absolute', top: `${i * effectivePxPerHour}px`, left: 0, right: 0, height: '1px', backgroundColor: 'var(--background-modifier-border)', opacity: 0.5 }} />
						))}
					</div>
					{timers.map(timer => (
						<TimerBlock
							key={timer.id}
							timer={timer}
							timers={timers}
							setTimers={setTimers}
							pxPerHour={effectivePxPerHour}
							exactTopPx={topPxMap.get(timer.id)}
							onCompleteTodo={onCompleteTodo}
							onDragReorderMove={handleTileDragMove}
							onDragReorderEnd={handleTileDragEnd}
							isAnyTileDragging={isTileDragging}
							revealActive={revealActive}
						/>
					))}
					{draftTimer && (
						<TimerBlock
							timer={draftTimer}
							timers={timers}
							setTimers={setTimers}
							pxPerHour={effectivePxPerHour}
							isDraft={true}
							exactTopPx={stackEndTop}
						/>
					)}
				</div>
			</div>
		</ErrorBoundary>
	);
};

const TimerBlock = ({ timer, timers, setTimers, pxPerHour, isDraft, exactTopPx, onCompleteTodo, onDragReorderMove, onDragReorderEnd, isAnyTileDragging, revealActive }: { timer: TimerTile, timers: TimerTile[], setTimers: React.Dispatch<React.SetStateAction<TimerTile[]>>, pxPerHour: number, isDraft?: boolean, exactTopPx?: number, onCompleteTodo?: (eventId: string, todoId: string) => void, onDragReorderMove?: (id: string, desiredTopPx: number) => void, onDragReorderEnd?: () => void, isAnyTileDragging?: boolean, revealActive?: boolean }) => {

	const [isDragging, setIsDragging] = useState(false);
	const [isResizing, setIsResizing] = useState(false);
	const [swipeX, setSwipeX] = useState(0);
	const wasDraggingRef = useRef(false);
	const wasResizingRef = useRef(false);
	// Always holds the tile's current packed slot, even mid-drag.
	const exactTopRef = useRef<number | undefined>(exactTopPx);
	exactTopRef.current = exactTopPx;

	const [showContextMenu, setShowContextMenu] = useState(false);
	// Whether the tile menu's full palette is unfolded beside the quick swatches.
	const [showColorPicker, setShowColorPicker] = useState(false);
	const [displayTimeRemaining, setDisplayTimeRemaining] = useState(timer.timeRemainingMin);
	// One-shot acknowledgement for a right-click: the tile gives the tiniest press
	// before the context menu appears, exactly as the calendar's event tiles do.
	// Toggled false → next frame true so repeated right-clicks replay it.
	const [isContextPulsing, setIsContextPulsing] = useState(false);

	useEffect(() => {
		const lastTickTime = timer.lastTickTime;
		if (!timer.isPlaying || !lastTickTime) {
			setDisplayTimeRemaining(timer.timeRemainingMin);
			return;
		}
		const interval = setInterval(() => {
			const elapsedMs = Date.now() - lastTickTime;
			const elapsedMin = elapsedMs / 60000;
			setDisplayTimeRemaining(Math.max(0, timer.timeRemainingMin - elapsedMin));
		}, 100);
		return () => clearInterval(interval);
	}, [timer.isPlaying, timer.lastTickTime, timer.timeRemainingMin]);

	const formatTimeRemaining = (min: number) => {
		const totalSeconds = Math.max(0, Math.ceil(min * 60));
		const h = Math.floor(totalSeconds / 3600);
		const m = Math.floor((totalSeconds % 3600) / 60);
		const s = totalSeconds % 60;

		if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	};

	const [menuPos, setMenuPos] = useState<{ x: number; y: number; flippedX?: boolean; flippedY?: boolean }>({ x: 0, y: 0 });

	useEffect(() => {
		if (!showContextMenu) return;
		const handleClose = () => setShowContextMenu(false);
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setShowContextMenu(false);
		};
		document.addEventListener('pointerdown', handleClose);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handleClose);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [showContextMenu]);

	const topPx = exactTopPx !== undefined ? exactTopPx : (timer.startOffsetMin * (pxPerHour / 60));
	const rawHeight = timer.timeRemainingMin * (pxPerHour / 60);
	const heightPx = Math.max(36, rawHeight - 8);
	const isSmall = heightPx < 65;
	const isBounceTick = timer.isPlaying && (Math.floor(displayTimeRemaining * 60) % 60 === 0);
	// The view-shape reveal reuses the same gentle entrance the calendar event
	// tiles use on a view change (`tile-reveal` keyframes), so a timer drops and
	// fades in identically. Held off while the tile is being dragged or resized,
	// where the motion would fight.
	const isRevealing = Boolean(revealActive && !isDraft && !isDragging && !isResizing);

	// The timestamp rides on top of the scanning label and is backed by the tile's own
	// colour, so the label slides underneath it and disappears there instead of ever
	// colliding with the digits.
	const timerPatchHex = EVENT_COLOR_HEX[timer.colorTheme || DEFAULT_TIMER_COLOR] || EVENT_COLOR_HEX[DEFAULT_TIMER_COLOR];

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (isDraft) return;

		let menuX = e.clientX;
		let menuY = e.clientY;

		let flippedX = false;
		let flippedY = false;

		if (menuX + 224 > window.innerWidth - 10) {
			menuX = e.clientX - 224;
			flippedX = true;
		}
		if (menuY + 200 > window.innerHeight - 10) {
			menuY = e.clientY - 200;
			flippedY = true;
		}

		setMenuPos({ x: menuX, y: menuY, flippedX, flippedY });
		// Every open starts with the palette folded away.
		setShowColorPicker(false);
		setShowContextMenu(true);
		// Acknowledge the click with the smallest possible motion — the same pulse the
		// event tiles use. Dropping the class for one frame and re-adding it on the next
		// restarts the keyframe, so a rapid second right-click still plays it afresh.
		setIsContextPulsing(false);
		requestAnimationFrame(() => setIsContextPulsing(true));
	};


	return (
		<div
			className={`placeholder-event timer-tile event-${timer.colorTheme || DEFAULT_TIMER_COLOR} ${isSmall ? 'small-tile' : ''} ${timer.isPlaying ? 'is-active' : ''} ${isContextPulsing ? 'context-pulse' : ''} ${isRevealing ? 'tile-reveal' : ''}`}
			style={{
				top: `${topPx}px`,
				height: `${heightPx}px`,
				width: '93%',
				left: '3.5%',
				position: 'absolute',
				transition: (isDraft || isDragging || isResizing || isAnyTileDragging) ? 'none' : 'top 0.5s linear, height 0.5s linear',
				zIndex: isDragging ? 100 : (timer.isPlaying || showContextMenu) ? 50 : 10,
				cursor: isDraft ? 'default' : 'pointer',
				touchAction: 'none'
			}}
			onContextMenu={handleContextMenu}
			onClick={(e) => {
				if (isDraft) return;
				if (isDragging || isResizing || wasDraggingRef.current || wasResizingRef.current) return;

				// Toggle play/pause in place — never move the tile.
				setTimers(prev => prev.map(t => {
					if (t.id !== timer.id) return t;

					const now = Date.now();
					const elapsedMin = (t.isPlaying && t.lastTickTime) ? (now - t.lastTickTime) / 60000 : 0;
					const safeRemaining = typeof t.timeRemainingMin === 'number' && !isNaN(t.timeRemainingMin)
						? t.timeRemainingMin
						: (t.durationMin || 15);
					const currentRemaining = Math.max(0, safeRemaining - elapsedMin);

					const isNowPlaying = !t.isPlaying;
					return {
						...t,
						isPlaying: isNowPlaying,
						lastTickTime: isNowPlaying ? Date.now() : undefined,
						timeRemainingMin: currentRemaining
					};
				}));
			}}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.stopPropagation();
				if (isDraft) return;

				const startX = e.clientX;
				const startY = e.clientY;
				const startTopPx = exactTopRef.current !== undefined
					? exactTopRef.current
					: (timer.startOffsetMin * (pxPerHour / 60));
				let dragStarted = false;
				let isSwiping = false;
				document.body.dataset.isDraggingTimer = 'false';

				const onPointerMove = (moveEvent: PointerEvent) => {
					const deltaX = moveEvent.clientX - startX;
					const deltaY = moveEvent.clientY - startY;

					if (!dragStarted && (Math.abs(deltaY) > 3 || Math.abs(deltaX) > 3)) {
						dragStarted = true;
						setIsDragging(true);
						document.body.dataset.isDraggingTimer = 'true';
					}

					if (dragStarted) {
						// If dragging horizontally to the right
						if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 0) {
							isSwiping = true;
							setSwipeX(deltaX);
						} else {
							if (isSwiping) {
								isSwiping = false;
								setSwipeX(0);
							}

							// Dragging only changes this tile's ORDER in the stack.
							// Packed positions are re-derived, so neighbours squeeze
							// together and no gap or overlap can be left behind.
							if (onDragReorderMove) {
								onDragReorderMove(timer.id, startTopPx + deltaY);
							}
						}
					}
				};

				const onPointerUp = (upEvent: PointerEvent) => {
					if (onDragReorderEnd) onDragReorderEnd();
					if (dragStarted) {
						wasDraggingRef.current = true;
						setTimeout(() => { wasDraggingRef.current = false; }, 100);

						const finalDeltaX = upEvent.clientX - startX;
						if (isSwiping && finalDeltaX > 80) {
							setTimers(prev => {
								const filtered = prev.filter(t => t.id !== timer.id);

								return filtered;
							});
						} else {
							setSwipeX(0); // Snap back if aborted
						}
					}
					setIsDragging(false);
					setTimeout(() => { document.body.dataset.isDraggingTimer = 'false'; }, 50);
					window.removeEventListener('pointermove', onPointerMove);
					window.removeEventListener('pointerup', onPointerUp);
				};

				window.addEventListener('pointermove', onPointerMove);
				window.addEventListener('pointerup', onPointerUp);
			}}
		>
			<div className={`event-content ${isSmall ? 'small-tile-content' : 'large-timer-content'}`} style={{ position: 'relative', zIndex: 30, width: '100%', height: '100%', display: 'flex', flexDirection: (timer.todoId || isSmall) ? 'row' : 'column', gap: '4px', overflow: 'hidden' }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: isSmall ? 'auto' : '100%', flex: 1, minHeight: 0, minWidth: 0 }}>
					{timer.todoId ? (
						/* The to-do timer's label scans across the tile on one line and simply freezes
						   where it is when the timer is paused, so resuming carries on from that spot.
						   Two copies of the label ride a track that shifts by exactly one copy, so the
						   loop is seamless and the whole title always comes round again. The time readout
						   sits above the lane, backed by the tile's own colour, so the label slides under
						   it and disappears there. */
						<div className="timer-title">
							<div
								className={`timer-title-track${timer.isPlaying ? ' is-playing' : ''}`}
								style={{ animationDuration: `${Math.min(22, Math.max(7, ((timer.title || '').length + 12) * 0.34)).toFixed(2)}s` }}
							>
								<span className="timer-title-text">{timer.title || 'Untitled Timer'}</span>
								<span className="timer-title-text" aria-hidden="true">{timer.title || 'Untitled Timer'}</span>
							</div>
						</div>
					) : (
						<div style={{ fontWeight: 600, fontSize: '13px', color: '#ffffff', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: isSmall ? 1 : Math.max(1, Math.floor((heightPx - 46) / 16)) }}>
							{timer.title || 'Untitled Timer'}
						</div>
					)}
				</div>
				{/* The readout keeps one fixed size no matter how long the title is: the label
				    simply keeps scanning and reads itself out over time, so the digits never
				    have to shrink to make room. Tabular figures stop the width twitching as the
				    seconds tick. The digits are set semibold — just a step down from the very
				    heaviest — with a whisper of a stroke so they keep their shape, and the ink
				    is a soft grey a shade off black, so the readout sits calmly on the tile
				    instead of punching a hole in it. The backing patch reaches a little
				    further left than the digits themselves, so the label is already gone
				    by the time it arrives. */}
				<div style={{ fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#5a5a5e', WebkitTextStroke: '0.25px #5a5a5e', textShadow: '0 0 0.8px rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: isSmall ? 'flex-end' : 'center', width: isSmall ? 'auto' : '100%', gap: '6px', marginTop: 'auto', flexShrink: 0, opacity: timer.isPlaying ? 1 : 0.85, ...(timer.todoId ? { position: 'absolute', right: '5px', top: '50%', transform: 'translateY(-50%)', zIndex: 2, width: 'auto', marginTop: 0, paddingLeft: '14px', background: `linear-gradient(90deg, ${hexToRgba(timerPatchHex, 0)} 0, ${timerPatchHex} 14px, ${timerPatchHex} 100%)` } : {}) }}>
					{displayTimeRemaining <= 0 ? (
						<div
							style={{ cursor: 'pointer', background: 'rgba(0,0,0,0.1)', padding: '2px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', pointerEvents: 'auto' }}
							onClick={(e) => {
								e.stopPropagation();
								if (timer.todoId && timer.eventId && onCompleteTodo) {
									onCompleteTodo(timer.eventId, timer.todoId);
								}
								setTimers(prev => prev.filter(t => t.id !== timer.id));
							}}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
							Done?
						</div>
					) : (
						<>
							{!timer.isPlaying && (
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
							)}
							{formatTimeRemaining(displayTimeRemaining)}
						</>
					)}
				</div>
			</div>

			{showContextMenu && !isDraft && createPortal(
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
					{/* Quick swatches, with the swatch selector beside them. */}
					<div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', padding: '4px 6px 8px 6px' }}>
						{TIMER_QUICK_COLORS.map(c => {
							const isSelected = timer.colorTheme === c;
							return (
								<div
									key={c}
									className={`event-${c}`}
									onClick={(e) => {
										e.stopPropagation();
										setTimers(prev => prev.map(t => t.id === timer.id ? { ...t, colorTheme: c } : t));
									}}
									title={c}
									style={{
										width: '20px',
										height: '20px',
										borderRadius: '50%',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										cursor: 'pointer',
										border: isSelected ? '2px solid var(--text-normal, #ffffff)' : '2px solid transparent',
										boxShadow: isSelected ? '0 0 0 1px rgba(0, 0, 0, 0.45)' : 'none',
										boxSizing: 'border-box',
										transition: 'transform 0.12s ease, border-color 0.12s ease',
										flexShrink: 0
									}}
									onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
									onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
								>
									{isSelected && (
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="20 6 9 17 4 12"></polyline>
										</svg>
									)}
								</div>
							);
						})}

						{/* Swatch selector: unfolds the rest of the palette the tiles are
						    allowed — the muted tans, browns and greys, and the dimmer hues
						    that did not earn a spot in the quick row above. */}
						<div
							className="color-picker-wrapper"
							style={{ position: 'relative', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
						>
							<button
								type="button"
								className={`more-colors-btn ${showColorPicker ? 'active' : ''}`}
								title="More colors"
								onClick={(e) => {
									e.stopPropagation();
									setShowColorPicker(prev => !prev);
								}}
								style={{
									width: '26px',
									height: '26px',
									cursor: 'pointer',
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
										color: (showColorPicker || !TIMER_QUICK_COLORS.includes(timer.colorTheme || '')) ? 'var(--text-normal, #ffffff)' : 'var(--text-muted, rgba(255, 255, 255, 0.6))',
										pointerEvents: 'none'
									}}
								>
									<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
								</svg>
							</button>

							{showColorPicker && (
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
										width: '190px',
										maxHeight: '176px',
										overflowY: 'auto',
										overflowX: 'hidden',
										display: 'grid',
										gridTemplateColumns: 'repeat(6, 1fr)',
										justifyItems: 'center',
										alignItems: 'center',
										gap: '6px',
										boxSizing: 'border-box'
									}}
								>
									{TIMER_COLOR_NAMES.map(c => {
										const isSelected = timer.colorTheme === c;
										return (
											<div
												key={c}
												className={`event-${c}`}
												title={c.replace('-', ' ')}
												onClick={(e) => {
													e.stopPropagation();
													setTimers(prev => prev.map(t => t.id === timer.id ? { ...t, colorTheme: c } : t));
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

					<div style={{ height: '1px', backgroundColor: 'rgba(0, 0, 0, 0.1)', margin: '2px 4px 4px 4px' }} />

					<div
						className="event-context-menu-item"
						onClick={(e) => {
							e.stopPropagation();
							setShowContextMenu(false);
							setTimers(prev => prev.filter(t => t.id !== timer.id));
						}}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '6px 8px',
							borderRadius: '6px',
							cursor: 'pointer',
							fontSize: '13px',
							color: '#ff6b6b',
							transition: 'background-color 0.1s ease'
						}}
						onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.1)'; }}
						onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
							</svg>
							<span>Delete Timer</span>
						</div>
						<span style={{ fontSize: '12px', color: 'rgba(255, 107, 107, 0.6)' }}>⌫</span>
					</div>
				</div>,
				document.body
			)}

			{/* VISUAL Drag Handle (Behind text) */}
			<div
				className={`timer-scale-grip ${timer.isPlaying ? 'active' : ''} ${heightPx < 75 ? 'minimal' : ''}`}
				style={{
					position: 'absolute', bottom: 0, left: 0, right: 0, height: heightPx < 75 ? '8px' : '16px', zIndex: 20, pointerEvents: 'none'
				}}
			/>

			{/* TOP RESIZE HANDLE (Always visible per user request) */}
			<div
				className="timer-resize-hit-area"
				style={{
					position: 'absolute', top: -4, left: 0, right: 0, height: '12px', cursor: 'ns-resize', zIndex: 40, background: 'transparent'
				}}
				onClick={(e) => e.stopPropagation()}
				onPointerDown={(e) => {
					if (e.button !== 0) return;
					e.stopPropagation();
					if (isDraft) return;

					const startY = e.clientY;
					const startOffset = timer.startOffsetMin;

					const now = Date.now();
					const elapsedMin = (timer.isPlaying && timer.lastTickTime) ? (now - timer.lastTickTime) / 60000 : 0;
					const safeRemaining = typeof timer.timeRemainingMin === 'number' && !isNaN(timer.timeRemainingMin)
						? timer.timeRemainingMin
						: (timer.durationMin || 15);
					const currentRemaining = Math.max(0, safeRemaining - elapsedMin);

					const startDuration = isNaN(currentRemaining) ? 15 : currentRemaining;
					setIsResizing(true);

					const wasPlaying = timer.isPlaying;

					const initialSnapped = Math.max(5, Math.round(startDuration / 5) * 5);
					setTimers(prev => prev.map(t => t.id === timer.id ? {
						...t,
						isPlaying: false,
						durationMin: initialSnapped,
						timeRemainingMin: initialSnapped
					} : t));

					const onPointerMove = (moveEvent: PointerEvent) => {
						const deltaY = moveEvent.clientY - startY;
						const deltaMin = (deltaY / pxPerHour) * 60;
						const rawDuration = startDuration - deltaMin;
						const snappedDuration = Math.round(rawDuration / 5) * 5;
						let newDuration = Math.max(5, Math.min(180, snappedDuration));

						const diffMin = newDuration - startDuration;
						setTimers(prev => prev.map(t => t.id === timer.id ? {
							...t,
							durationMin: newDuration,
							timeRemainingMin: newDuration
						} : t));
					};

					const onPointerUp = () => {
						setIsResizing(false);
						wasResizingRef.current = true;
						setTimeout(() => { wasResizingRef.current = false; }, 100);

						setTimers(prev => prev.map(t => {
							if (t.id === timer.id && wasPlaying) {
								return { ...t, isPlaying: true, lastTickTime: Date.now() };
							}
							return t;
						}));

						document.removeEventListener('pointermove', onPointerMove);
						document.removeEventListener('pointerup', onPointerUp);
					};

					document.addEventListener('pointermove', onPointerMove);
					document.addEventListener('pointerup', onPointerUp);
				}}
			/>

			{/* BOTTOM RESIZE HANDLE (Hidden on small tiles) */}
			{!isSmall && (

				<div
					className="timer-resize-hit-area"
					style={{
						position: 'absolute', bottom: -4, left: 0, right: 0, height: '12px', cursor: 'ns-resize', zIndex: 40, background: 'transparent'
					}}
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => {
						if (e.button !== 0) return;
						e.stopPropagation();
						if (isDraft) return;

						const startY = e.clientY;

						// Use current time remaining instead of original duration so it snaps cleanly from its current state!
						const now = Date.now();
						const elapsedMin = (timer.isPlaying && timer.lastTickTime) ? (now - timer.lastTickTime) / 60000 : 0;
						const safeRemaining = typeof timer.timeRemainingMin === 'number' && !isNaN(timer.timeRemainingMin)
							? timer.timeRemainingMin
							: (timer.durationMin || 15);
						const currentRemaining = Math.max(0, safeRemaining - elapsedMin);

						const startDuration = isNaN(currentRemaining) ? 15 : currentRemaining;
						setIsResizing(true);

						const wasPlaying = timer.isPlaying;

						// Instantly freeze it and snap it to the nearest 5-minute mark on pointer down
						const initialSnapped = Math.max(5, Math.round(startDuration / 5) * 5);
						setTimers(prev => prev.map(t => t.id === timer.id ? {
							...t,
							isPlaying: false, // PAUSE while dragging
							durationMin: initialSnapped,
							timeRemainingMin: initialSnapped
						} : t));

						const onPointerMove = (moveEvent: PointerEvent) => {
							const deltaY = moveEvent.clientY - startY;
							const deltaMin = (deltaY / pxPerHour) * 60;
							const rawDuration = startDuration + deltaMin;
							const snappedDuration = Math.round(rawDuration / 5) * 5;
							let newDuration = Math.max(5, snappedDuration);

							setTimers(prev => {
								const updated = prev.map(t => t.id === timer.id ? {
									...t,
									durationMin: newDuration,
									timeRemainingMin: newDuration
									// Note: it is paused (isPlaying: false), so no need to update lastTickTime here
								} : t);

								const sorted = [...updated].sort((a, b) =>
									a.startOffsetMin - b.startOffsetMin
								);



								return updated.map(t => sorted.find(s => s.id === t.id) || t);
							});
						};

						const onPointerUp = () => {
							setIsResizing(false);
							wasResizingRef.current = true;
							setTimeout(() => { wasResizingRef.current = false; }, 100);
							window.removeEventListener('pointermove', onPointerMove);
							window.removeEventListener('pointerup', onPointerUp);

							// Resume playing if it was playing before drag started
							if (wasPlaying) {
								setTimers(prev => prev.map(t => t.id === timer.id ? {
									...t,
									isPlaying: true,
									lastTickTime: Date.now()
								} : t));
							}
						};

						window.addEventListener('pointermove', onPointerMove);
						window.addEventListener('pointerup', onPointerUp);
					}}
				/>
			)}
		</div>
	);
};
