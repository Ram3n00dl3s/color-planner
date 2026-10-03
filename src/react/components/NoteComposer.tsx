import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { MarkdownNoteEditor } from './MarkdownNoteEditor';

interface NoteComposerProps {
    /** The finished note name, shown as the document's title (date + event title). */
    noteName: string;
    /** The vault folder the note will land in, shown as a quiet path line. */
    folder: string;
    /** The vault's notes, offered as `[[` suggestions. */
    notes?: { basename: string; path: string }[];
    accentColor?: string | null;
    onCancel: () => void;
    onCreate: (body: string) => void | Promise<void>;
}

// How much of the header must always stay on screen, so a card dragged to any edge can
// still be grabbed again.
const HEAD_KEEP_VISIBLE = 96;

// The floor for a manual resize: below this the header, the writing surface and the
// footer start fighting for room.
const MIN_CARD_W = 360;
const MIN_CARD_H = 240;

/**
 * A quiet, full-size writing surface: the note as it *feels* before it exists as a file.
 * It deliberately knows nothing about the vault's *files* — it hands the typed body to
 * `onCreate`, which performs the one and only write.
 *
 * What it does carry is Obsidian's understanding of markdown, because the writing
 * surface underneath is CodeMirror — the same editor engine Obsidian runs. Typing `- `
 * draws a bullet, `- [ ] ` draws a checkbox, `# ` becomes a heading, `**bold**` turns
 * bold, and the markers step out of the way until the caret reaches their line. Enter
 * continues a list, Backspace clears a bare marker, Tab nests, ⌘B / ⌘I / ⌘K wrap the
 * selection and `[[` suggests the vault's own notes. None of that touches the document,
 * which stays plain markdown from the first keystroke to the file on disk.
 *
 * The card is deliberately NOT modal. There is no backdrop and nothing outside the card
 * captures a click, so the calendar, the timer column and the sidebars all stay fully
 * usable while a note is being written. The header is the drag handle and the
 * bottom-right corner is the resize grip.
 */
export const NoteComposer = ({ noteName, folder, notes, accentColor, onCancel, onCreate }: NoteComposerProps) => {
    const [isSaving, setIsSaving] = useState(false);
    // `null` means "centred", which the stylesheet does with a translate; the first drag
    // measures the card and switches to absolute coordinates from there.
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    // Likewise `null` means "the stylesheet's default size" until the grip is used.
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);

    const cardRef = useRef<HTMLDivElement | null>(null);
    // The editor owns the document; the card only ever reads it at the moment of saving.
    const viewRef = useRef<EditorView | null>(null);

    const commit = async () => {
        if (isSaving) return;
        const text = viewRef.current?.state.doc.toString() ?? '';
        setIsSaving(true);
        try {
            await onCreate(text);
        } finally {
            setIsSaving(false);
        }
    };

    // Escape backs out and ⌘/Ctrl+Enter commits. Those two are the only keys the card
    // takes for itself: everything else is left to CodeMirror, which is why the note
    // editor behaves exactly like an editor and not like a text field.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const card = cardRef.current;
            const target = e.target as Node | null;
            if (!card || !target || !card.contains(target)) return;
            if (e.key === 'Escape') {
                // With the `[[` suggestions open, Escape closes those first — exactly as it
                // would inside the editor.
                if (card.querySelector('.cm-tooltip-autocomplete')) return;
                e.preventDefault();
                e.stopPropagation();
                onCancel();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void commit();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel, isSaving]);

    // --- Moving and sizing ---------------------------------------------------------

    // A moved card can never be lost: the header always keeps a strip on screen, whatever
    // the window size.
    const clampToWindow = (next: { x: number; y: number }) => {
        const el = cardRef.current;
        const width = el?.offsetWidth || 720;
        const maxX = Math.max(HEAD_KEEP_VISIBLE - width, window.innerWidth - HEAD_KEEP_VISIBLE);
        const maxY = Math.max(0, window.innerHeight - HEAD_KEEP_VISIBLE);
        return {
            x: Math.min(Math.max(next.x, HEAD_KEEP_VISIBLE - width), maxX),
            y: Math.min(Math.max(next.y, 0), maxY)
        };
    };

    // A resize can never push the card off the window either: the grip stops at the near
    // edge, and the floors keep the writing surface usable.
    const clampSize = (next: { w: number; h: number }) => {
        const rect = cardRef.current?.getBoundingClientRect();
        const maxW = Math.max(MIN_CARD_W, (rect ? window.innerWidth - rect.left : window.innerWidth) - 12);
        const maxH = Math.max(MIN_CARD_H, (rect ? window.innerHeight - rect.top : window.innerHeight) - 12);
        return {
            w: Math.max(MIN_CARD_W, Math.min(next.w, maxW)),
            h: Math.max(MIN_CARD_H, Math.min(next.h, maxH))
        };
    };

    // One listener for the life of the card: a window that shrinks re-fits both the card's
    // place and its size, so it is never left hanging off screen.
    useEffect(() => {
        const onResize = () => {
            setPos(prev => (prev ? clampToWindow(prev) : prev));
            setSize(prev => (prev ? clampSize(prev) : prev));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // The header is the handle. A press that lands on a control inside it — the close
    // button — is left to that control, so the card is never dragged by accident.
    const handleDragStart = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button')) return;
        const el = cardRef.current;
        if (!el) return;
        e.preventDefault();

        const rect = el.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        setPos({ x: rect.left, y: rect.top });
        setIsDragging(true);

        const onMove = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            moved = true;
            setPos(clampToWindow({ x: rect.left + dx, y: rect.top + dy }));
        };
        const onUp = () => {
            setIsDragging(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    // The bottom-right grip resizes. The top-left corner is pinned first, so the card grows
    // away from the pointer exactly as the corner suggests — and because the pin happens at
    // the measured rect, the first pixel of the drag moves nothing.
    const handleResizeStart = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const el = cardRef.current;
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = el.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        setPos({ x: rect.left, y: rect.top });
        setSize({ w: rect.width, h: rect.height });
        setIsResizing(true);

        const onMove = (moveEvent: PointerEvent) => {
            setSize(clampSize({
                w: rect.width + (moveEvent.clientX - startX),
                h: rect.height + (moveEvent.clientY - startY)
            }));
        };
        const onUp = () => {
            setIsResizing(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    return createPortal(
        <div
            ref={cardRef}
            className={`note-composer${isDragging ? ' is-dragging' : ''}${isResizing ? ' is-resizing' : ''}`}
            role="dialog"
            aria-modal="false"
            aria-label={noteName}
            style={{
                ...(accentColor ? { ['--sleek-accent' as any]: accentColor } : {}),
                ...(pos
                    ? { left: `${pos.x}px`, top: `${pos.y}px` }
                    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
                ...(size ? { width: `${size.w}px`, height: `${size.h}px` } : {})
            } as React.CSSProperties}
        >
            <div className="note-composer-head" onPointerDown={handleDragStart} title="Drag to move">
                <div className="note-composer-glyph" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                </div>

                <div className="note-composer-titles">
                    <div className="note-composer-name" title={noteName}>{noteName}</div>
                    <div className="note-composer-path" title={folder}>{folder ? `Saved to ${folder}` : 'Saved to the vault root'}</div>
                </div>

                <button type="button" className="note-composer-close" onClick={onCancel} title="Close" aria-label="Close">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <MarkdownNoteEditor
                notes={notes}
                ariaLabel={noteName}
                onReady={(view) => { viewRef.current = view; }}
            />

            <div className="note-composer-foot">
                <span className="note-composer-hint">⌘B bold · ⌘I italic · ⌘K note link · ⌘↵ creates</span>
                <div className="note-composer-buttons">
                    <button type="button" className="note-composer-btn" onClick={onCancel}>Cancel</button>
                    <button type="button" className="note-composer-btn is-primary" onClick={() => void commit()} disabled={isSaving}>
                        Create note
                    </button>
                </div>
            </div>

            {/* The grip is the only resize affordance, so it stays quiet: two hairlines of
			    muted ink in the very corner, a little clearer on hover and while dragging. */}
            <div
                className="note-composer-grip"
                onPointerDown={handleResizeStart}
                title="Drag to resize"
                aria-hidden="true"
            >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <line x1="11" y1="1" x2="1" y2="11"></line>
                    <line x1="11" y1="6" x2="6" y2="11"></line>
                </svg>
            </div>
        </div>,
        document.body
    );
};
