# P5: Command Palette + Copy Buttons

**Scope:** Cmd+K global search, copy-to-clipboard, small UX improvements
**Package:** `packages/dashboard`, `packages/api`
**Depends on:** None

---

## Tasks

### 1. Search API endpoint

`GET /api/search?q=<query>` — searches across:
- runs (by ID prefix)
- tasks (by name, LIKE match)
- specs (by name)
- projects (by name)
- agents (by name)

Returns: `{ type: 'run'|'task'|..., id: string, name: string, url: string }[]`
Limit 10 results, ordered by relevance (exact match first, then prefix, then contains).

### 2. Command palette component

Triggered by Cmd+K (Mac) / Ctrl+K (Windows).
Shows search input + results list.
Keyboard navigable (arrow keys + Enter to navigate).
ESC to close.

Use shadcn Dialog or a custom overlay.

### 3. Copy buttons

Add copy-to-clipboard on hover/click for:
- Run ID (on RunDetail header)
- Task ID (on TaskDetail)
- Commit SHA (on RunDetail git section)
- Branch name
- PR URL

Use `navigator.clipboard.writeText()`.
Show brief "Copied" tooltip/toast.

### 4. Small UX improvements

- Absolute timestamps on hover (currently only relative)
- Cost formatting: show "$0.00" not "$0.0000" for zero; "<$0.01" for tiny amounts
- Keyboard shortcut: `r` on run page to retry (with confirmation)

## Verification

- [ ] Cmd+K opens search palette
- [ ] Search finds runs, tasks, specs by name/ID
- [ ] Copy buttons show on hover for IDs and git refs
- [ ] Absolute timestamp shown on tooltip hover
