import { App, TFile } from 'obsidian';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

export interface DailyTodoItem {
	id: string;
	title: string;
	completed?: boolean;
	lineIndex: number;
	sourceFile: string;
}

/**
 * Reads the daily-note configuration once: the date format and folder used by
 * Obsidian's core Daily Notes plugin, or by Periodic Notes when it is the one
 * driving daily notes. Both are optional — a vault with neither still works,
 * falling back to `YYYY-MM-DD` in the vault root.
 */
export function getDailyNoteSettings(app: App): { formatStr: string; folderStr: string } {
	let formatStr = 'YYYY-MM-DD';
	let folderStr = '';

	// 1. Check core Daily Notes plugin settings
	const dailyPlugin = (app as any)?.internalPlugins?.plugins?.['daily-notes'];
	if (dailyPlugin && dailyPlugin.instance?.options) {
		formatStr = dailyPlugin.instance.options.format || 'YYYY-MM-DD';
		folderStr = dailyPlugin.instance.options.folder || '';
	}

	// 2. Check Periodic Notes plugin settings if daily-notes isn't active
	const periodicPlugin = (app as any)?.plugins?.getPlugin?.('periodic-notes');
	if (periodicPlugin?.settings?.daily?.enabled) {
		formatStr = periodicPlugin.settings.daily.format || formatStr;
		folderStr = periodicPlugin.settings.daily.folder || folderStr;
	}

	return { formatStr, folderStr };
}

/**
 * Every plausible basename a daily note for `date` might carry: the configured
 * Moment format first (matching Obsidian's own date tokens), then a spread of
 * common date-fns layouts. Shared by the single-day lookup and the month sweep.
 */
function candidateNamesForDate(date: Date, formatStr: string): string[] {
	let momentFormatted = '';
	try {
		if ((window as any).moment) {
			momentFormatted = (window as any).moment(date).format(formatStr);
		}
	} catch (e) {
		// Fallback
	}

	return Array.from(new Set([
		momentFormatted,
		format(date, 'yyyy-MM-dd'),
		format(date, 'yyyy.MM.dd'),
		format(date, 'yyyy_MM_dd'),
		format(date, 'MM-dd-yyyy'),
		format(date, 'dd-MM-yyyy'),
		format(date, 'yyyyMMdd')
	].filter(Boolean)));
}

/**
 * Finds today's daily note file in the Obsidian vault.
 * Supports Obsidian's core Daily Notes plugin, Periodic Notes, and standard date formatting conventions.
 */
export function getTodaysDailyNoteFile(app: App, targetDate: Date = new Date()): TFile | null {
	if (!app || !app.vault) return null;

	const { formatStr, folderStr } = getDailyNoteSettings(app);
	const candidateNames = candidateNamesForDate(targetDate, formatStr);

	// First: try direct path lookups
	for (const name of candidateNames) {
		const fullPath = folderStr ? `${folderStr.replace(/\/$/, '')}/${name}.md` : `${name}.md`;
		const directFile = app.vault.getAbstractFileByPath(fullPath);
		if (directFile instanceof TFile && directFile.extension === 'md') {
			return directFile;
		}

		// Also check root if folder was specified
		if (folderStr) {
			const rootFile = app.vault.getAbstractFileByPath(`${name}.md`);
			if (rootFile instanceof TFile && rootFile.extension === 'md') {
				return rootFile;
			}
		}
	}

	// Second: scan markdown files in the vault for matching basename
	const allMarkdownFiles = app.vault.getMarkdownFiles();
	for (const candidate of candidateNames) {
		const match = allMarkdownFiles.find(f => f.basename === candidate);
		if (match) return match;
	}

	return null;
}

/**
	* One daily note discovered for a month, paired with the day it belongs to.
	*/
export interface DailyNoteFileEntry {
	date: Date;
	file: TFile;
}

/**
	* Finds every daily note that falls inside the given month, keyed back to its
	* day. The vault is scanned once and matched against the candidate basenames of
	* all ~31 days, so a whole month costs a single pass rather than a lookup per day.
	*/
export function getDailyNoteFilesForMonth(app: App, monthDate: Date): DailyNoteFileEntry[] {
	if (!app || !app.vault) return [];

	const { formatStr } = getDailyNoteSettings(app);

	let days: Date[] = [];
	try {
		days = eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) });
	} catch (e) {
		return [];
	}

	const nameToDate = new Map<string, Date>();
	for (const day of days) {
		for (const name of candidateNamesForDate(day, formatStr)) {
			if (!nameToDate.has(name)) nameToDate.set(name, day);
		}
	}

	const entries: DailyNoteFileEntry[] = [];
	const seen = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const matchDate = nameToDate.get(file.basename);
		if (!matchDate || seen.has(file.path)) continue;
		seen.add(file.path);
		entries.push({ date: matchDate, file });
	}

	entries.sort((a, b) => a.date.getTime() - b.date.getTime());
	return entries;
}

/**
	* A daily-note to-do carrying the day it came from, for the month-wide list.
	*/
export interface MonthlyDailyTodoItem extends DailyTodoItem {
	date: Date;
}

/**
	* Parses every daily note in the given month into to-dos, each tagged with its
	* own day. Reads are sequential, and a single unreadable note is skipped rather
	* than allowed to sink the whole month.
	*/
export async function getDailyNoteTodosForMonth(app: App, monthDate: Date): Promise<MonthlyDailyTodoItem[]> {
	const files = getDailyNoteFilesForMonth(app, monthDate);
	const items: MonthlyDailyTodoItem[] = [];

	for (const { date, file } of files) {
		try {
			const content = await app.vault.read(file);
			for (const task of parseDailyNoteTasks(content, file)) {
				items.push({ ...task, date });
			}
		} catch (e) {
			// Skip a note that cannot be read.
		}
	}

	return items;
}

/**
	* Parses the lines of today's daily note into To-Do items.
 * Handles YAML frontmatter, markdown headings, task checkboxes (- [ ], - [x]),
 * bullet points, numbered lists, and plain text lines.
 */
export function parseDailyNoteTasks(content: string, file: TFile): DailyTodoItem[] {
	const lines = content.split('\n');
	let inFrontmatter = false;
	const items: DailyTodoItem[] = [];
	const textOccurrences = new Map<string, number>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Handle YAML frontmatter at top of note
		if (i === 0 && trimmed === '---') {
			inFrontmatter = true;
			continue;
		}
		if (inFrontmatter) {
			if (trimmed === '---') {
				inFrontmatter = false;
			}
			continue;
		}

		// Skip empty or whitespace-only lines
		if (!trimmed) continue;

		// Skip markdown headings (# Today, ## Tasks, etc.)
		if (/^#{1,6}\s+/.test(trimmed)) {
			continue;
		}

		// Check for task checkbox: - [ ] or - [x] or * [ ] or * [x]
		const checkboxMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
		if (checkboxMatch) {
			const isCompleted = checkboxMatch[1].toLowerCase() === 'x';
			const itemText = checkboxMatch[2].trim();
			if (itemText) {
				const count = (textOccurrences.get(itemText) || 0) + 1;
				textOccurrences.set(itemText, count);
				items.push({
					id: `daily-${file.path}-${itemText}-${count}`,
					title: itemText,
					completed: isCompleted,
					lineIndex: i,
					sourceFile: file.path
				});
			}
			continue;
		}

		// Check for normal bullet: - text, * text, + text, • text
		const bulletMatch = trimmed.match(/^[-*+•]\s+(.*)$/);
		if (bulletMatch) {
			const itemText = bulletMatch[1].trim();
			if (itemText) {
				const count = (textOccurrences.get(itemText) || 0) + 1;
				textOccurrences.set(itemText, count);
				items.push({
					id: `daily-${file.path}-${itemText}-${count}`,
					title: itemText,
					completed: false,
					lineIndex: i,
					sourceFile: file.path
				});
			}
			continue;
		}

		// Check for numbered list item: 1. text, 2. text
		const numMatch = trimmed.match(/^\d+[\.)]\s+(.*)$/);
		if (numMatch) {
			const itemText = numMatch[1].trim();
			if (itemText) {
				const count = (textOccurrences.get(itemText) || 0) + 1;
				textOccurrences.set(itemText, count);
				items.push({
					id: `daily-${file.path}-${itemText}-${count}`,
					title: itemText,
					completed: false,
					lineIndex: i,
					sourceFile: file.path
				});
			}
			continue;
		}

		// Plain text line (e.g. "Marry jo", "OMYG!")
		const count = (textOccurrences.get(trimmed) || 0) + 1;
		textOccurrences.set(trimmed, count);
		items.push({
			id: `daily-${file.path}-${trimmed}-${count}`,
			title: trimmed,
			completed: false,
			lineIndex: i,
			sourceFile: file.path
		});
	}

	return items;
}

// ============================================================================
// READ-ONLY GUARANTEE:
// The calendar plugin is strictly read-only towards user notes.
// It must NEVER call app.vault.modify, create checkboxes, or alter note content.
// ============================================================================

export async function updateDailyNoteTaskStatus(
	app: App,
	file: TFile,
	lineIndex: number,
	completed: boolean
): Promise<void> {
	// Strictly no-op: never modify user notes
}

export async function appendDailyNoteTask(
	app: App,
	file: TFile,
	taskText: string
): Promise<void> {
	// Strictly no-op: never modify user notes
}

export async function deleteDailyNoteTask(
	app: App,
	file: TFile,
	lineIndex: number
): Promise<void> {
	// Strictly no-op: never modify user notes
}

export async function updateDailyNoteTaskText(
	app: App,
	file: TFile,
	lineIndex: number,
	newText: string
): Promise<void> {
	// Strictly no-op: never modify user notes
}

