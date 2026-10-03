import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { App, Component, MarkdownRenderer } from 'obsidian';

interface NoteComposerProps {
    /** The finished note name, shown as the document's title (date + event title). */
    noteName: string;
    /** The vault folder the note will land in, shown as a quiet path line. */
    folder: string;
    /** The vault app, used only to render the markdown preview. */
    app?: App;
    /** The vault's notes, for the `[[` suggestion strip. */
    notes?: { basename: string; path: string }[];
    accentColor?: string | null;
    onCancel: () => void;
    onCreate: (body: string) => void | Promise<void>;
}

type ComposeMode = 'write' | 'split' | 'preview';

// How much of the header must always stay on screen, so a card dragged to any edge can
// still be grabbed again.
const HEAD_KEEP_VISIBLE = 96;

// The floor for a manual resize: below this the header, the writing surfaces and the
// footer start fighting for room.
const MIN_CARD_W = 360;
const MIN_CARD_H = 240;

// Long enough that a burst of typing renders once, short enough that the preview feels
// attached to the caret.
const PREVIEW_DEBOUNCE_MS = 160;

const MAX_LINK_SUGGESTIONS = 6;

/**
 * A quiet, full-size writing surface: the note as it *feels* before it exists as a
 * file. It deliberately knows nothing about the vault's *files* — it hands the typed
 * body to `onCreate`, which performs the one and only write.
 *
 * What it does borrow from Obsidian is the language. The right-hand pane is Obsidian's
 * own `MarkdownRenderer` — the very code behind reading view — so headings, emphasis,
 * lists, tasks, tables, quotes, links, code and maths are drawn exactly as they would be
 * in a normal note, theme and snippets included. The textarea then behaves the way an
 * Obsidian editor does: Enter carries a list or task marker on, Enter on an empty marker
 * ends the list, Tab indents, and ⌘B / ⌘I / ⌘K wrap the selection. `[[` opens the vault's
 * own notes as a suggestion strip.
 *
 * The card is deliberately NOT modal. There is no backdrop and nothing outside the card
 * captures a click, so the calendar, the timer column and the sidebars all stay fully
 * usable while a note is being written. The header is the drag handle and the
 * bottom-right corner is the resize grip.
 */
export const NoteComposer = ({ noteName, folder, app, notes, accentColor, onCancel, onCreate }: NoteComposerProps) => {
    const [body, setBody] = useState('');
    const [mode, setMode] = useState<ComposeMode>('split');
    const [isSaving, setIsSaving] = useState(false);
    // `null` means "centred", which the stylesheet does with a translate; the first drag
    // measures the card and switches to absolute coordinates from there.
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    // Likewise `null` means "the stylesheet's default size" until the grip is used.
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [linkQuery, setLinkQuery] = useState<string | null>(null);
    const [linkIdx, setLinkIdx] = useState(0);

    const bodyRef = useRef<HTMLTextAreaElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    // The Component that owns whatever the preview is currently showing, so embedded
    // content can be released the moment that content is replaced or the card closes.
    const previewOwnerRef = useRef<Component | null>(null);
    const previewGenRef = useRef(0);
    // A programmatic edit has to move the caret, but React re-writes `value` (and with it
    // the caret) on the render that follows — so the target selection is parked here and
    // restored in a layout effect, before the browser paints.
    const pendingSelRef = useRef<{ start: number; end: number } | null>(null);
    const lastQueryRef = useRef<string | null>(null);

    // The editor's key handling runs in a capture listener that reads the live DOM, so it
    // needs the suggestion list without closing over stale state.
    const linkSuggestionsRef = useRef<{ basename: string; path: string }[]>([]);
    const linkIdxRef = useRef(0);
    const linkOpenRef = useRef(false);

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

    // --- Markdown-driven behaviour on the textarea --------------------------------

    const applyEdit = (next: string, selStart: number, selEnd: number = selStart) => {
        pendingSelRef.current = { start: selStart, end: selEnd };
        setBody(next);
    };

    // Recomputes the `[[` context from the live field. The index is only reset when the
    // query itself changed, so ↑/↓ navigation is not undone by the keyup that follows it.
    const syncLinkQuery = () => {
        const el = bodyRef.current;
        if (!el) return;
        const caret = el.selectionStart ?? 0;
        let query: string | null = null;
        if (el.selectionEnd === caret) {
            const open = el.value.lastIndexOf('[[', caret - 1);
            if (open !== -1) {
                const closed = el.value.indexOf(']]', open + 2);
                const candidate = el.value.slice(open + 2, caret);
                if ((closed === -1 || closed >= caret) && !candidate.includes('\n')) query = candidate;
            }
        }
        if (lastQueryRef.current !== query) {
            lastQueryRef.current = query;
            setLinkIdx(0);
        }
        setLinkQuery(query);
    };

    // ⌘B / ⌘I / ⌘K. A selection that is already wrapped is unwrapped, so the shortcuts
    // toggle exactly as they do in Obsidian.
    const toggleWrap = (open: string, close: string) => {
        const el = bodyRef.current;
        if (!el) return;
        const value = el.value;
        let start = el.selectionStart;
        let end = el.selectionEnd;

        if (start === end) {
            if (open === '[[') {
                // A bare caret turns the whole line into a note link.
                start = value.lastIndexOf('\n', start - 1) + 1;
                const lineEnd = value.indexOf('\n', start);
                end = lineEnd === -1 ? value.length : lineEnd;
            } else {
                // Otherwise emphasis applies to the word under the caret.
                const isWord = (c: string | undefined) => !!c && !/\s/.test(c);
                while (start > 0 && isWord(value[start - 1])) start--;
                while (end < value.length && isWord(value[end])) end++;
            }
        }

        const inner = value.slice(start, end);
        const before = value.slice(0, start);
        const after = value.slice(end);

        if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
            const stripped = inner.slice(open.length, inner.length - close.length);
            applyEdit(before + stripped + after, start, start + stripped.length);
            return;
        }
        if (before.endsWith(open) && after.startsWith(close)) {
            const trimmedBefore = before.slice(0, before.length - open.length);
            const trimmedAfter = after.slice(close.length);
            applyEdit(trimmedBefore + inner + trimmedAfter, start - open.length, start - open.length + inner.length);
            return;
        }
        applyEdit(before + open + inner + close + after, start + open.length, start + open.length + inner.length);
    };

    // Enter continues a list or a task marker, and a bare marker simply ends the list —
    // the same rules Obsidian's own editor applies. Mid-line, the browser's plain newline
    // is left alone.
    const handleEnter = (el: HTMLTextAreaElement) => {
        const value = el.value;
        const caret = el.selectionStart;
        if (el.selectionEnd !== caret) return false;
        if (value.indexOf('\n', caret) !== -1) return false;

        const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
        const line = value.slice(lineStart, caret);
        const match = /^([ \t]*)(?:([-*+])|(\d+)([.)]))[ \t]+(?:(\[[ xX]\])[ \t]+)?/.exec(line);
        if (!match) return false;

        const rest = line.slice(match[0].length);
        if (!rest) {
            applyEdit(value.slice(0, lineStart) + value.slice(caret), lineStart);
            return true;
        }

        const indent = match[1];
        const marker = match[2]
            ? `${indent}${match[2]} `
            : `${indent}${(match[3] ? Number(match[3]) + 1 : 1)}${match[4] || '.'} `;
        const continuation = match[5] ? `${marker}[ ] ` : marker;
        const insert = `\n${continuation}`;
        applyEdit(value.slice(0, caret) + insert + value.slice(caret), caret + insert.length);
        return true;
    };

    // Tab indents — the caret's line, or every line the selection touches — and Shift+Tab
    // takes one level back off.
    const handleTab = (el: HTMLTextAreaElement, outdent: boolean) => {
        const value = el.value;
        const start = el.selectionStart;
        const end = el.selectionEnd;

        if (start === end && !outdent) {
            applyEdit(value.slice(0, start) + '\t' + value.slice(start), start + 1);
            return;
        }

        const from = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const to = lineEnd === -1 ? value.length : lineEnd;
        const block = value
            .slice(from, to)
            .split('\n')
            .map(line => (outdent ? line.replace(/^(\t| {1,4})/, '') : `\t${line}`))
            .join('\n');
        applyEdit(value.slice(0, from) + block + value.slice(to), from, from + block.length);
    };

    // The `[[` strip only offers vault notes that are already there; it never creates a
    // note, it only writes the link text.
    const linkSuggestions = React.useMemo(() => {
        if (linkQuery === null || !notes || notes.length === 0) return [];
        const query = linkQuery.toLowerCase();
        return notes
            .filter(n => n.basename.toLowerCase().includes(query) || n.path.toLowerCase().includes(query))
            .slice(0, MAX_LINK_SUGGESTIONS);
    }, [linkQuery, notes]);

    // Mirrored into refs for the capture listener, which must not close over stale state.
    linkSuggestionsRef.current = linkSuggestions;
    linkIdxRef.current = linkIdx;
    linkOpenRef.current = linkSuggestions.length > 0;

    const acceptSuggestion = (index?: number) => {
        const el = bodyRef.current;
        const list = linkSuggestionsRef.current;
        const pick = list[index ?? linkIdxRef.current] || list[0];
        if (!el || !pick) return;
        const value = el.value;
        const caret = el.selectionStart;
        const open = value.lastIndexOf('[[', caret - 1);
        if (open === -1) return;
        const insert = `${pick.basename}]]`;
        const next = `${value.slice(0, open + 2)}${insert}${value.slice(caret)}`;
        lastQueryRef.current = null;
        setLinkQuery(null);
        applyEdit(next, open + 2 + insert.length);
    };

    // Carries out an edit and then puts the caret back where the edit asked for it, before
    // the browser has a chance to paint the jump.
    useLayoutEffect(() => {
        const pending = pendingSelRef.current;
        if (!pending) return;
        pendingSelRef.current = null;
        const el = bodyRef.current;
        if (!el) return;
        el.setSelectionRange(pending.start, pending.end);
        syncLinkQuery();
    });

    // The caret starts at the end of an empty field — never a selection, which would make
    // the first keystroke replace nothing and simply feel wrong.
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, []);

    // Every key the card owns is handled here, in the capture phase, for two reasons: a
    // stop-propagation here keeps Obsidian's hotkey layer out of the card entirely, and
    // none of Obsidian's global shortcuts can eat a space mid-sentence. Events from
    // outside the card are left completely alone, because the card floats and the user may
    // well be typing in the calendar underneath.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const card = cardRef.current;
            const target = e.target as Node | null;
            if (!card || !target || !card.contains(target)) return;
            e.stopPropagation();

            const el = bodyRef.current;
            const inBody = !!el && target === el;
            const mod = e.metaKey || e.ctrlKey;

            // The suggestion strip wins while it is open, so its keys never leak into the
            // text or into the card's own shortcuts.
            if (inBody && linkOpenRef.current) {
                const count = linkSuggestionsRef.current.length;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setLinkIdx(prev => (prev + 1) % count);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setLinkIdx(prev => (prev - 1 + count) % count);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    acceptSuggestion();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    lastQueryRef.current = null;
                    setLinkQuery(null);
                    return;
                }
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
                return;
            }
            if (mod && e.key === 'Enter') {
                e.preventDefault();
                commitRef.current();
                return;
            }
            if (inBody && mod && (e.key === 'b' || e.key === 'B')) {
                e.preventDefault();
                toggleWrap('**', '**');
                return;
            }
            if (inBody && mod && (e.key === 'i' || e.key === 'I')) {
                e.preventDefault();
                toggleWrap('*', '*');
                return;
            }
            if (inBody && mod && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                toggleWrap('[[', ']]');
                return;
            }
            if (inBody && e.key === 'Enter' && !e.shiftKey) {
                if (handleEnter(el)) e.preventDefault();
                return;
            }
            if (inBody && e.key === 'Tab') {
                e.preventDefault();
                handleTab(el, e.shiftKey);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);

    // --- Live preview through Obsidian's own renderer -----------------------------

    const targetPath = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;

    useEffect(() => {
        if (mode === 'write' || !app) return;
        const host = previewRef.current;
        if (!host) return;

        const gen = ++previewGenRef.current;
        const timer = window.setTimeout(() => {
            const owner = new Component();
            owner.load();
            // Rendered into a detached element and swapped in one shot, so a slow render
            // can never leave the previous one's leftovers behind.
            const stage = document.createElement('div');
            stage.className = 'markdown-preview-view markdown-rendered';
            void MarkdownRenderer.render(app, body, stage, targetPath, owner).then(() => {
                if (gen !== previewGenRef.current || !previewRef.current) {
                    owner.unload();
                    return;
                }
                const previous = previewOwnerRef.current;
                previewOwnerRef.current = owner;
                previewRef.current.replaceChildren(stage);
                if (previous) previous.unload();
            });
        }, PREVIEW_DEBOUNCE_MS);

        return () => window.clearTimeout(timer);
    }, [body, mode, app, targetPath]);

    useEffect(() => () => {
        previewOwnerRef.current?.unload();
        previewOwnerRef.current = null;
    }, []);

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
    // edge, and the floors keep the writing surfaces usable.
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

    // The header is the handle. A press that lands on a control inside it — the mode
    // switches or the close button — is left to that control, so the card is never dragged
    // by accident.
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

    const MODES: { value: ComposeMode; label: string; title: string }[] = [
        { value: 'write', label: 'Write', title: 'Write only' },
        { value: 'split', label: 'Split', title: 'Write and preview side by side' },
        { value: 'preview', label: 'Preview', title: 'Preview only' }
    ];

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

                <div className="note-composer-modes" role="group" aria-label="View mode">
                    {MODES.map(m => (
                        <button
                            key={m.value}
                            type="button"
                            className={`note-composer-mode${mode === m.value ? ' is-active' : ''}`}
                            title={m.title}
                            onClick={() => setMode(m.value)}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>

                <button type="button" className="note-composer-close" onClick={onCancel} title="Close" aria-label="Close">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <div className="note-composer-panes">
                {mode !== 'preview' && (
                    <textarea
                        ref={bodyRef}
                        className="note-composer-body"
                        value={body}
                        onChange={(e) => { setBody(e.target.value); syncLinkQuery(); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        onKeyUp={(e) => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') syncLinkQuery(); }}
                        onClick={syncLinkQuery}
                        onSelect={syncLinkQuery}
                        placeholder="Start writing…"
                        spellCheck={false}
                    />
                )}

                {mode !== 'write' && (
                    <div className="note-composer-preview">
                        {body.trim() === '' && (
                            <div className="note-composer-preview-empty">Nothing to preview yet — start writing and it appears here.</div>
                        )}
                        {/* Filled imperatively by the renderer above; React must never own its
						    children, or it would wipe the rendered note on the next render. */}
                        <div ref={previewRef} />
                    </div>
                )}
            </div>

            {linkSuggestions.length > 0 && mode !== 'preview' && (
                <div className="note-composer-links">
                    <span className="note-composer-links-label">Link to note</span>
                    {linkSuggestions.map((note, i) => (
                        <button
                            key={note.path}
                            type="button"
                            className={`note-composer-link${i === linkIdx ? ' is-selected' : ''}`}
                            title={note.path}
                            onMouseEnter={() => setLinkIdx(i)}
                            // The press never leaves the field, so the caret — and the query
                            // the suggestion is replacing — are still exactly where they were.
                            onMouseDown={(e) => { e.preventDefault(); setLinkIdx(i); acceptSuggestion(i); }}
                        >
                            {note.basename}
                        </button>
                    ))}
                    <span className="note-composer-links-hint">↑↓ · ↵</span>
                </div>
            )}

            <div className="note-composer-foot">
                <span className="note-composer-hint">⌘B bold · ⌘I italic · ⌘K note link · ⌘↵ creates</span>
                <div className="note-composer-buttons">
                    <button type="button" className="note-composer-btn" onClick={onCancel}>Cancel</button>
                    <button type="button" className="note-composer-btn is-primary" onClick={() => commitRef.current()} disabled={isSaving}>
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
