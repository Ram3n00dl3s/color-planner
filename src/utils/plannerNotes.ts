import { App, TFile } from 'obsidian';
import { format } from 'date-fns';

/**
 * The single folder every note this plugin creates is written to. It is a constant
 * rather than a setting on purpose: the calendar's promise about the user's vault is
 * that it only ever *creates* inside its own folder — it never edits, appends to, or
 * deletes anything it did not write, and it never touches a note of the user's.
 */
export const PLANNER_NOTES_FOLDER = 'Planner Notes';

/* Obsidian stores notes as real files, so a name may not carry any character a
   filesystem reserves, may not be empty, and may not end in a dot or a space. `#`, `^`
   and the brackets are legal on disk but are Obsidian's own link and heading syntax, so
   they go too — the finished name has to survive being typed inside a `[[link]]`. */
const ILLEGAL_IN_NAME = /[\\/:*?"<>|#\[\]^]/g;

export const sanitizeNoteNamePart = (raw: string): string =>
    (raw || '')
        .replace(ILLEGAL_IN_NAME, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');

/**
 * `2026-10-02 Event title` — the current date, then the event tile's title beside it.
 * The date leads so the Planner Notes folder sorts itself chronologically.
 */
export const buildPlannerNoteName = (date: Date, eventTitle: string): string => {
    const datePart = format(date, 'yyyy-MM-dd');
    const titlePart = sanitizeNoteNamePart(eventTitle) || 'Note';
    return `${datePart} ${titlePart}`;
};

/**
 * Writes a brand-new note into the vault and returns its file. Nothing is ever
 * modified: a free path is chosen first, so an existing note — the user's or an
 * earlier creation — can never be overwritten. A duplicate name simply gains ` 2`,
 * ` 3`, … before its extension, exactly as Obsidian's own "New note" would.
 */
export const createPlannerNote = async (
    app: App | undefined,
    options: { name: string; body: string; folder?: string }
): Promise<TFile | null> => {
    if (!app?.vault) return null;

    const folder = (options.folder ?? PLANNER_NOTES_FOLDER).replace(/^\/+|\/+$/g, '');
    const baseName = sanitizeNoteNamePart(options.name) || 'Note';

    if (folder && !app.vault.getAbstractFileByPath(folder)) {
        try {
            await app.vault.createFolder(folder);
        } catch (e) {
            // A folder that appeared between the check and the write is not an error —
            // the note below is the only thing that matters here.
        }
    }

    const pathFor = (suffix: number) => {
        const name = suffix > 1 ? `${baseName} ${suffix}` : baseName;
        return folder ? `${folder}/${name}.md` : `${name}.md`;
    };

    let path = pathFor(1);
    for (let suffix = 2; app.vault.getAbstractFileByPath(path) && suffix <= 999; suffix++) {
        path = pathFor(suffix);
    }

    try {
        return await app.vault.create(path, options.body ?? '');
    } catch (e) {
        return null;
    }
};
