import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface NoteComposerProps {
    /** The finished note name, shown as the document's title (date + event title). */
    noteName: string;
    /** The vault folder the note will land in, shown as a quiet path line. */
    folder: string;
    accentColor?: string | null;
    onCancel: () => void;
    onCreate: (body: string) => void | Promise<void>;
}

// How much of the header must always stay on screen, so a card dragged to any edge can
// still be grabbed again.
const HEAD_KEEP_VISIBLE = 96;

/**
 * A quiet, full-size writing surface: the note as it *feels* before it exists as a
 * file. It deliberately knows nothing about the vault — it hands the typed body to
 * `onCreate`, which performs the one and only write.
 *
 * The card is deliberately NOT modal. There is no backdrop and nothing outside the card
 * captures a click, so the calendar, the timer column and the sidebars all stay fully
 * usable while a note is being written; the user can even click another event and come
 * back. The header is the drag handle, so the card can be slid out of the way instead of
 * having to be closed.
 */
export const NoteComposer = ({ noteName, folder, accentColor, onCancel, onCreate }: NoteComposerProps) => {
    const [body, setBody] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    // `null` means "centred", which the stylesheet does with a translate; the first drag
    // measures the card and switches to absolute coordinates from there.
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const bodyRef = useRef<HTMLTextAreaElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);

    // A stable handle for the window keydown listener below, so committing with the
    // keyboard does not tear the listener down and rebuild it on every keystroke.
    const commitRef = useRef<() => void>(() => { });
    const commit = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            await onCreate(body);
        } finally {
            setIsSaving(false);
        }
    };
    commitRef.current = () => { void commit(); };

    // The caret starts at the end of an empty field — never a selection, which would
    // make the first keystroke replace nothing and simply feel wrong.
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, []);

    // Keys are only intercepted while the card actually holds them. With no backdrop the
    // user may well be typing in the calendar, and swallowing those keystrokes would be
    // far worse than any hotkey — so an event from outside the card is left completely
    // alone. Inside it, Escape backs out and ⌘/Ctrl+Enter commits, and propagation is
    // stopped so Obsidian's global hotkeys can never eat a space mid-sentence.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const card = cardRef.current;
            const target = e.target as Node | null;
            if (!card || !target || !card.contains(target)) return;
            e.stopPropagation();
            if (e.key === 'Escape') {
                onCancel();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                commitRef.current();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);

    // A dragged card can never be lost: the header always keeps a strip on screen,
    // whatever the window size.
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

    useEffect(() => {
        if (!pos) return;
        const onResize = () => setPos(prev => (prev ? clampToWindow(prev) : prev));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [pos]);

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

    return createPortal(
        <div
            ref={cardRef}
            className={`note-composer${isDragging ? ' is-dragging' : ''}`}
            role="dialog"
            aria-modal="false"
            aria-label={noteName}
            style={{
                ...(accentColor ? { ['--sleek-accent' as any]: accentColor } : {}),
                ...(pos
                    ? { left: `${pos.x}px`, top: `${pos.y}px` }
                    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })
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

            <textarea
                ref={bodyRef}
                className="note-composer-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Start writing…"
                spellCheck={false}
            />

            <div className="note-composer-foot">
                <span className="note-composer-hint">Drag the header to move · Esc closes · ⌘↵ creates</span>
                <div className="note-composer-buttons">
                    <button type="button" className="note-composer-btn" onClick={onCancel}>Cancel</button>
                    <button type="button" className="note-composer-btn is-primary" onClick={() => commitRef.current()} disabled={isSaving}>
                        Create note
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
