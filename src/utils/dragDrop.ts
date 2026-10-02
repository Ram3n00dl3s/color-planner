export interface DroppedDocument {
	title: string;
	link: string;
	isNote?: boolean;
	todoId?: string;
	eventId?: string;
}

/**
 * Extracts document title and wiki-link from DragEvent dataTransfer.
 * Supports:
 * 1. Internal notebook events / todos ('application/x-obsidian-calendar-todo')
 * 2. Generic JSON payload ('application/json')
 * 3. Obsidian URI links ('text/uri-list' with obsidian://open)
 * 4. Obsidian internal markdown links and file paths ('text/plain')
 */
export function extractObsidianDoc(dataTransfer: DataTransfer): DroppedDocument | null {
	if (!dataTransfer) return null;

	// 1. Check custom Obsidian calendar todo/note payload
	const customData = dataTransfer.getData('application/x-obsidian-calendar-todo');
	if (customData) {
		try {
			const parsed = JSON.parse(customData);
			if (parsed && (parsed.title || parsed.text)) {
				const title = String(parsed.title || parsed.text).replace(/\[\[|\]\]/g, '').trim();
				const isNote = parsed.type === 'notebook-note' || (!parsed.type && parsed.link && String(parsed.link).startsWith('[['));
				const link = isNote ? (parsed.link || `[[${title}]]`) : '';
				return { title, link, isNote: !!isNote, todoId: parsed.todoId, eventId: parsed.eventId };
			}
		} catch (e) { }
	}

	// 2. Check application/json
	const jsonData = dataTransfer.getData('application/json');
	if (jsonData) {
		try {
			const parsed = JSON.parse(jsonData);
			if (parsed && (parsed.title || parsed.text)) {
				const title = String(parsed.title || parsed.text).replace(/\[\[|\]\]/g, '').trim();
				const isNote = parsed.type === 'notebook-note' || (!parsed.type && parsed.link && String(parsed.link).startsWith('[['));
				const link = isNote ? (parsed.link || `[[${title}]]`) : '';
				return { title, link, isNote: !!isNote, todoId: parsed.todoId, eventId: parsed.eventId };
			}
		} catch (e) { }
	}

	// 3. Check text/uri-list (Obsidian URL handler)
	const uriList = dataTransfer.getData('text/uri-list');
	if (uriList && uriList.includes('obsidian://open')) {
		try {
			const url = new URL(uriList.split('\n')[0].trim());
			const fileParam = url.searchParams.get('file');
			if (fileParam) {
				let title = decodeURIComponent(fileParam).split('/').pop() || fileParam;
				title = title.replace(/\.md$/i, '').trim();
				return { title, link: `[[${title}]]`, isNote: true };
			}
		} catch (e) { }
	}

	// 4. Check text/plain
	const text = dataTransfer.getData('text/plain');
	if (text && text.trim()) {
		const str = text.trim();

		// Check if it's a JSON string
		if (str.startsWith('{') && str.endsWith('}')) {
			try {
				const parsed = JSON.parse(str);
				if (parsed && (parsed.title || parsed.text)) {
					const title = String(parsed.title || parsed.text).replace(/\[\[|\]\]/g, '').trim();
					const isNote = parsed.type === 'notebook-note' || (!parsed.type && parsed.link && String(parsed.link).startsWith('[['));
					const link = isNote ? (parsed.link || `[[${title}]]`) : '';
					return { title, link, isNote: !!isNote, todoId: parsed.todoId, eventId: parsed.eventId };
				}
			} catch (e) { }
		}

		// Check if it's an obsidian://open URL
		if (str.includes('obsidian://open')) {
			try {
				const url = new URL(str);
				const fileParam = url.searchParams.get('file');
				if (fileParam) {
					let title = decodeURIComponent(fileParam).split('/').pop() || fileParam;
					title = title.replace(/\.md$/i, '').trim();
					return { title, link: `[[${title}]]`, isNote: true };
				}
			} catch (e) { }
		}

		// Check if it's a markdown wiki link: [[Document Name]] or [[Document Name|Alias]]
		const wikiMatch = str.match(/\[\[(.*?)\]\]/);
		if (wikiMatch) {
			const inner = wikiMatch[1].split('|')[0].trim();
			return { title: inner, link: `[[${inner}]]`, isNote: true };
		}

		// Plain text filename or title (e.g. "Meeting Notes.md" or "Projects/2026 Goals.md")
		let title = str.replace(/\.md$/i, '').trim();
		if (title.includes('/')) {
			title = title.split('/').pop() || title;
		}
		title = title.replace(/\[\[|\]\]/g, '').trim();

		// Filter out extremely long multi-line text dumps that are not file names
		if (title.length > 0 && title.length < 250 && !title.includes('\n')) {
			return { title, link: `[[${title}]]`, isNote: true };
		}
	}

	return null;
}

export function getVaultNotes(plugin?: any): { basename: string, path: string }[] {
	if (plugin?.app?.vault) {
		const files = plugin.app.vault.getMarkdownFiles() || [];
		return files
			.sort((a: any, b: any) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
			.map((f: any) => ({ basename: f.basename, path: f.path }));
	}
	return [];
}

