export interface EventTodo {
	id: string;
	title: string;
	completed?: boolean;
}

/**
 * A user-defined calendar profile ("Work", "Hobby", "School", …).
 *
 * Profiles replace the (not yet wired up) linked-calendar row in the details
 * pane: each profile carries a name and a swatch color, and events can be
 * assigned to one so their tiles adopt that profile's color.
 */
export interface CalendarProfile {
	id: string;
	name: string;
	/** Palette color name (see EVENT_COLOR_HEX) or a raw hex string. */
	color: string;
}

export interface CustomRepeat {
	interval: number;
	unit: 'day' | 'week' | 'month' | 'year';
	/** Weekdays the rule applies to, 0 = Sunday … 6 = Saturday. */
	weekdays: number[];
	ends: 'never' | 'on' | 'after';
	/** ISO date (yyyy-MM-dd) when `ends === 'on'`. */
	endDate?: string;
	/** Occurrence count when `ends === 'after'`. */
	count?: number;
}

export interface CalendarEvent {
	id: string;
	title: string;
	startTime: Date;
	endTime: Date;
	colorTheme: string;
	description?: string;
	location?: string;
	linkedNotes?: string[];
	todos?: EventTodo[];
	/** Whole-day event (its start/end span 00:00 → next-day 00:00). */
	isAllDay?: boolean;
	/** Per-event time zone (IANA id, or 'auto' for the system zone). */
	timeZone?: string;
	/** Recurrence rule: 'none' | 'daily' | 'every-other-day' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom'. */
	repeat?: string;
	/** Details for the 'custom' recurrence rule. */
	repeatCustom?: CustomRepeat;
	/** Calendar profile (Work, Hobby, …) this event is filed under. */
	profileId?: string;
}

export interface TimerTile {
	id: string;
	title: string;
	colorTheme: string;
	startOffsetMin: number; // Vertical position in minutes from top of column
	durationMin: number; // Total duration user set by dragging
	timeRemainingMin: number;
	isPlaying: boolean;
	lastTickTime?: number; // epoch timestamp of when it was last updated
	todoId?: string;
	eventId?: string;
}
