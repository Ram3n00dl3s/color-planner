import { App, TFile } from 'obsidian';
import { format } from 'date-fns';

export interface DailyTodoItem {
	id: string;
	title: string;
	completed?: boolean;
	lineIndex: number;
	sourceFile: string;
}

/**
 * Finds today's daily note file in the Obsidian vault.
 * Supports Obsidian's core Daily Notes plugin, Periodic Notes, and standard date formatting conventions.
 */
export function getTodaysDailyNoteFile(app: App, targetDate: Date = new Date()): TFile | null {
	if (!app || !app.vault) return null;

	// 1. Check core Daily Notes plugin settings
	const dailyPlugin = (app as any).internalPlugins?.plugins?.['daily-notes'];
	let formatStr = 'YYYY-MM-DD';
	let folderStr = '';

	if (dailyPlugin && dailyPlugin.instance?.options) {
		formatStr = dailyPlugin.instance.options.format || 'YYYY-MM-DD';
		folderStr = dailyPlugin.instance.options.folder || '';
	}

	// 2. Check Periodic Notes plugin settings if daily-notes isn't active
	const periodicPlugin = (app as any).plugins?.getPlugin?.('periodic-notes');
	if (periodicPlugin?.settings?.daily?.enabled) {
		formatStr = periodicPlugin.settings.daily.format || formatStr;
		folderStr = periodicPlugin.settings.daily.folder || folderStr;
	}

	// 3. Format today's date using Moment.js if available (matches Obsidian's native date tokens)
	let momentFormatted = '';
	try {
		if ((window as any).moment) {
			momentFormatted = (window as any).moment(targetDate).format(formatStr);
		}
	} catch (e) {
		// Fallback
	}

	// Also format using standard date-fns tokens
	const isoFormatted = format(targetDate, 'yyyy-MM-dd');
	const dotFormatted = format(targetDate, 'yyyy.MM.dd');
	const underscoreFormatted = format(targetDate, 'yyyy_MM_dd');
	const usFormatted = format(targetDate, 'MM-dd-yyyy');
	const euFormatted = format(targetDate, 'dd-MM-yyyy');
	const compactFormatted = format(targetDate, 'yyyyMMdd');

	const candidateNames = Array.from(new Set([
		momentFormatted,
		isoFormatted,
		dotFormatted,
		underscoreFormatted,
		usFormatted,
		euFormatted,
		compactFormatted
	].filter(Boolean)));

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

