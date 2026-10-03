import React, { useEffect, useRef } from 'react';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, placeholder } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { ensureSyntaxTree, indentUnit, syntaxTree } from '@codemirror/language';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionSource } from '@codemirror/autocomplete';

interface MarkdownNoteEditorProps {
    initialValue?: string;
    notes?: { basename: string; path: string }[];
    ariaLabel?: string;
    /** Called with the document every time it changes, for a parent that only needs the text. */
    onChange?: (value: string) => void;
    /** Handed the live view once, so the parent can read the document at any moment. */
    onReady?: (view: EditorView) => void;
}

/* --------------------------------------------------------------------------------
   Live preview

   CodeMirror is the editor Obsidian uses, and the markdown it draws is *rendered* by
   decorations: the document itself is never touched, so the note stays pure markdown
   on disk while the card shows it the way Obsidian's own live preview would.

   Two widgets do the drawing a plain text field could never do — a bullet for a list
   marker, a box for a task — and the rest is a matter of hiding or dimming the syntax
   the reader does not need. Markers come back the moment the caret lands on their
   line, exactly as they do in Obsidian.
   -------------------------------------------------------------------------------- */

class BulletWidget extends WidgetType {
    toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-note-bullet';
        el.textContent = '•';
        return el;
    }
}

class TaskWidget extends WidgetType {
    private readonly checked: boolean;
    constructor(checked: boolean) {
        super();
        this.checked = checked;
    }
    eq(other: TaskWidget) {
        return other.checked === this.checked;
    }
    toDOM() {
        const el = document.createElement('span');
        el.className = `cm-note-task${this.checked ? ' is-checked' : ''}`;
        el.setAttribute('aria-hidden', 'true');
        return el;
    }
}

const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });
const hiddenDecoration = Decoration.replace({});
const dimDecoration = Decoration.mark({ class: 'cm-note-dim' });
const emphasisDecoration = Decoration.mark({ class: 'cm-note-em' });
const strongDecoration = Decoration.mark({ class: 'cm-note-strong' });
const strikeDecoration = Decoration.mark({ class: 'cm-note-strike' });
const codeDecoration = Decoration.mark({ class: 'cm-note-code' });
const urlDecoration = Decoration.mark({ class: 'cm-note-url' });

const headingLineDecoration = (level: number) => Decoration.line({ class: `cm-note-h${level}` });

// The text *inside* an emphasis, code or strike node: everything between its opening
// and closing marks. Marking only the inside lets the markers themselves be hidden
// without the two decorations ever competing for the same range.
const innerRange = (node: any): { from: number; to: number } | null => {
    let first: any = null;
    let last: any = null;
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'EmphasisMark' || child.name === 'CodeMark' || child.name === 'StrikethroughMark') {
            if (!first) first = child;
            last = child;
        }
    }
    if (!first || !last || first.to > last.from) return null;
    return { from: first.to, to: last.from };
};

function buildDecorations(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const { state } = view;
    const doc = state.doc;

    // A change lands *before* the markdown parser has necessarily caught up, and drawing
    // from a half-parsed tree is exactly what makes a freshly typed `- ` lose its bullet:
    // the `ListMark` node is not there yet, so nothing replaces the dash. Asking for the
    // tree to be brought up to date for the visible range first means the glyphs are
    // always drawn from the markdown as it currently reads.
    const tree = ensureSyntaxTree(state, view.viewport.to, 50) || syntaxTree(state);

    // Markers are only shown on the line the caret is on, the way Obsidian reveals them.
    const caretOnLine = (pos: number) => {
        const line = doc.lineAt(pos);
        return state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from);
    };

    tree.iterate({
        from: view.viewport.from,
        to: view.viewport.to,
        enter: (node) => {
            const { from, to } = node;
            switch (node.name) {
                case 'ListMark': {
                    const mark = state.sliceDoc(from, to);
                    const lineEnd = doc.lineAt(from).to;
                    const next = state.sliceDoc(to, Math.min(lineEnd, to + 1));
                    // The space after the marker belongs to the glyph that replaces it.
                    const markerEnd = next === ' ' || next === '\t' ? to + 1 : to;
                    const isTask = /^\[[ xX]\][ \t]/.test(state.sliceDoc(markerEnd, lineEnd));
                    if (/^[-*+]$/.test(mark)) {
                        // A task draws only its box: a bullet beside it would be a second mark.
                        ranges.push((isTask ? hiddenDecoration : bulletDecoration).range(from, markerEnd));
                    } else {
                        // A numbered list keeps its number; it just stops shouting.
                        ranges.push(dimDecoration.range(from, to));
                    }
                    return;
                }
                case 'TaskMarker': {
                    const checked = /[xX]/.test(state.sliceDoc(from, to));
                    ranges.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(from, to));
                    return;
                }
                case 'HeaderMark': {
                    if (caretOnLine(from)) {
                        ranges.push(dimDecoration.range(from, to));
                        return;
                    }
                    const lineEnd = doc.lineAt(from).to;
                    const next = state.sliceDoc(to, Math.min(lineEnd, to + 1));
                    ranges.push(hiddenDecoration.range(from, next === ' ' || next === '\t' ? to + 1 : to));
                    return;
                }
                case 'ATXHeading1':
                case 'ATXHeading2':
                case 'ATXHeading3':
                case 'ATXHeading4':
                case 'ATXHeading5':
                case 'ATXHeading6': {
                    const level = Number(node.name.slice(-1));
                    ranges.push(headingLineDecoration(level).range(doc.lineAt(from).from));
                    return;
                }
                case 'EmphasisMark':
                case 'CodeMark':
                case 'StrikethroughMark': {
                    ranges.push(caretOnLine(from) ? dimDecoration.range(from, to) : hiddenDecoration.range(from, to));
                    return;
                }
                case 'QuoteMark':
                case 'LinkMark': {
                    ranges.push(dimDecoration.range(from, to));
                    return;
                }
                case 'URL': {
                    ranges.push(urlDecoration.range(from, to));
                    return;
                }
                case 'Emphasis': {
                    const inner = innerRange(node.node);
                    if (inner) ranges.push(emphasisDecoration.range(inner.from, inner.to));
                    return;
                }
                case 'StrongEmphasis': {
                    const inner = innerRange(node.node);
                    if (inner) ranges.push(strongDecoration.range(inner.from, inner.to));
                    return;
                }
                case 'Strikethrough': {
                    const inner = innerRange(node.node);
                    if (inner) ranges.push(strikeDecoration.range(inner.from, inner.to));
                    return;
                }
                case 'InlineCode': {
                    const inner = innerRange(node.node);
                    if (inner) ranges.push(codeDecoration.range(inner.from, inner.to));
                    return;
                }
                default:
                    return;
            }
        }
    });

    return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
        // Rebuilt on *every* update, not only the ones the document causes: a background
        // parse finishing arrives as an update of its own, and skipping it would leave the
        // unfinished tree's decorations on screen until the next keystroke.
        this.decorations = buildDecorations(update.view);
    }
}, {
    decorations: value => value.decorations
});

// Wraps or unwraps the selection with a pair of markers — ⌘B, ⌘I and ⌘K, the three
// formatting shortcuts an Obsidian note answers to.
const wrapSelection = (before: string, after: string) => (view: EditorView) => {
    const changes = view.state.changeByRange(range => {
        const selected = view.state.sliceDoc(range.from, range.to);
        const already = selected.length >= before.length + after.length
            && selected.startsWith(before)
            && selected.endsWith(after);
        if (already) {
            const inner = selected.slice(before.length, selected.length - after.length);
            return {
                changes: { from: range.from, to: range.to, insert: inner },
                range: EditorSelection.range(range.from, range.from + inner.length)
            };
        }
        return {
            changes: { from: range.from, to: range.to, insert: `${before}${selected}${after}` },
            range: EditorSelection.range(range.from + before.length, range.to + before.length)
        };
    });
    view.dispatch(changes, { userEvent: 'input' });
    return true;
};

export const MarkdownNoteEditor = ({ initialValue = '', notes, ariaLabel, onChange, onReady }: MarkdownNoteEditorProps) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Kept in refs so the editor is built exactly once: rebuilding CodeMirror on a
    // re-render would throw away the caret, the selection and the undo history.
    const onChangeRef = useRef(onChange);
    const onReadyRef = useRef(onReady);
    const notesRef = useRef(notes);
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
    notesRef.current = notes;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // `[[` offers the vault's own notes, filtered as the link text is typed.
        const wikiLinkSource: CompletionSource = (context: CompletionContext) => {
            const before = context.matchBefore(/\[\[[^\]\n]*/);
            if (!before) return null;
            const list = notesRef.current || [];
            if (list.length === 0) return null;
            const query = before.text.slice(2).toLowerCase();
            return {
                from: before.from + 2,
                options: list
                    .filter(note => note.basename.toLowerCase().includes(query))
                    .slice(0, 40)
                    .map(note => ({ label: note.basename, detail: note.path, apply: `${note.basename}]]` })),
                validFor: /^[^\]\n]*$/
            };
        };

        const state = EditorState.create({
            doc: initialValue,
            extensions: [
                markdown({ base: markdownLanguage }),
                // Deliberately no bracket auto-closing: it would swallow the second `[` of a
                // `[[` link, the one keystroke this card cannot afford to lose.
                keymap.of([
                    ...completionKeymap,
                    // Enter carries a list or task marker on; Backspace clears a bare one.
                    ...markdownKeymap,
                    { key: 'Mod-b', run: wrapSelection('**', '**') },
                    { key: 'Mod-i', run: wrapSelection('*', '*') },
                    { key: 'Mod-k', run: wrapSelection('[[', ']]') },
                    ...defaultKeymap,
                    ...historyKeymap,
                    indentWithTab
                ]),
                history(),
                drawSelection(),
                // Lists indent with a tab, as they do in Obsidian by default.
                indentUnit.of('\t'),
                EditorState.tabSize.of(4),
                EditorView.lineWrapping,
                placeholder('Start writing…'),
                autocompletion({ override: [wikiLinkSource], icons: false, closeOnBlur: true }),
                livePreview,
                EditorView.contentAttributes.of({ 'aria-label': ariaLabel || 'Note', spellcheck: 'false' }),
                EditorView.updateListener.of(update => {
                    if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
                })
            ]
        });

        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        onReadyRef.current?.(view);
        view.focus();

        return () => {
            viewRef.current = null;
            view.destroy();
        };
    }, []);

    // Keys are stopped once they have finished bubbling *past* CodeMirror, so Obsidian's
    // global hotkeys never see a keystroke typed into the note — while CodeMirror's own
    // handling, which runs first on the editor's own element, is left completely alone.
    return (
        <div
            className="note-composer-editor"
            ref={hostRef}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
        />
    );
};
