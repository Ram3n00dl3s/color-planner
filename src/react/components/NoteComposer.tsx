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

/**
 * A quiet, full-size writing surface: the note as it *feels* before it exists as a
 * file. It deliberately knows nothing about the vault — it hands the typed body to
 * `onCreate`, which performs the one and only write. Nothing the user types here is
 * ever pushed into a note that already exists.
 */
export const NoteComposer = ({ noteName, folder, accentColor, onCancel, onCreate }: NoteComposerProps) => {
    const [body, setBody] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const bodyRef = useRef<HTMLTextAreaElement | null>(null);

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

    // Escape backs out, ⌘/Ctrl+Enter commits. Key events are stopped from reaching
    // Obsidian's hotkey layer in the capture phase, so nothing in the vault's global
    // shortcuts can swallow a space or a letter mid-thought.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
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

    return createPortal(
        <div
            className="note-composer-overlay"
            style={accentColor ? ({ ['--sleek-accent' as any]: accentColor } as React.CSSProperties) : undefined}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="note-composer" role="dialog" aria-modal="true" aria-label={noteName}>
                <div className="note-composer-head">
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
                    <span className="note-composer-hint">Esc closes · ⌘↵ creates</span>
                    <div className="note-composer-buttons">
                        <button type="button" className="note-composer-btn" onClick={onCancel}>Cancel</button>
                        <button type="button" className="note-composer-btn is-primary" onClick={() => commitRef.current()} disabled={isSaving}>
                            Create note
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
