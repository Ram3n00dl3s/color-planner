# Project Rules & Guidelines - Sleek Google Calendar (Obsidian Plugin)

## 1. Strict UI & Styling Rules
- **ABSOLUTE BAN ON PURPLE ACCENTS & COLORED BORDERS**:
  - NEVER use purple accent boxes, purple outlines, purple borders, or Obsidian's default `--interactive-accent` / `--interactive-accent-rgb` (which defaults to purple `#7c3aed` in Obsidian).
  - Never use purple `#7c3aed`, `#8b5cf6`, or any purple tint for focus, hover, selection, editing, drag-and-drop targets, chips, or modal states.
  - **NO COLORED BORDERS OF ANY KIND**: Do NOT add colored borders (yellow, purple, etc.) around boxes, inputs, or editing containers.
  - All input/box borders must be neutral Obsidian theme variables (`var(--background-modifier-border)` or `transparent`).
  - Interactive and focus states rely solely on clean background hovers (`var(--background-modifier-hover)`) and neutral focus states (`box-shadow: none !important; outline: none !important;`).
  - Text selection (`::selection`) must remain neutral (`var(--text-selection, rgba(255, 255, 255, 0.2))`), never purple.

## 2. To-Do Items Styling & Behavior
- To-do item text color: White (`#ffffff`).
- Checkboxes: Circular, slightly larger (18px), unfilled circle with clean yellow checkmark inside when completed (`#facc15`).
- Completed items immediately drop to the bottom of the list.
- Editing an existing to-do: clicking on the text enables immediate inline editing; the edit box must use a neutral border (`border: 1px solid var(--background-modifier-border)`), NEVER colored borders or purple. Do NOT auto-select text on focus (place cursor at end).
- Clearing completed tasks: checkmark icon button in header clears completed items without jitter or layout shifts.

## 3. Description & Text Inputs
- Never apply `.trim()` on active typing handlers or input synchronization effects.
- Stop event propagation (`e.stopPropagation()`) on keydown handlers for inputs/textareas to prevent Obsidian core or hotkey listeners from intercepting spaces or keys.

## 4. Calendar Grid & Event Creation
- Creating a new event via drag must strictly occur in a downward (or downward-angle) direction (`deltaY > dragThreshold`).
- Upward motions (`deltaY < 0`) must NEVER initiate or create an event tile.

## 5. Note Integration & Vault Safety (Read-Only)
- The calendar plugin is STRICTLY READ-ONLY with respect to user notes and daily notes.
- NEVER modify, rewrite, delete lines from, append to, or disrupt the user's note files (`app.vault.modify`).
- NEVER convert text, bullet points, or paragraphs in user notes into checkboxes.
- All to-do completions, additions, edits, or removals inside the calendar plugin must remain in the calendar's internal state without altering note files.

## 6. Build & Rebuild Rule (MANDATORY)
- After ANY source change under `src/` (`.ts`, `.tsx`, `.css`, etc.), ALWAYS run `npm run build` before finishing so the compiled `main.js` bundle matches the source.
- Obsidian loads the bundled `main.js`, not the TypeScript source. A change is NOT complete or inspectable until `main.js` has been rebuilt.
- Always report the build result (success/failure) in the final summary so the user can immediately test the change in Obsidian.
- If the build fails, fix the error and rebuild before declaring the task done. Never leave `src/` and `main.js` out of sync.
- For iterative work `npm run dev` (esbuild watch) may be used, but still confirm a fresh, successful build when the task ends.
- Remind the user to reload the plugin in Obsidian (toggle it off/on, or use a hot-reload plugin) after a rebuild.


