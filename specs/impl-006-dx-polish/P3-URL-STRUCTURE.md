# P3: Descriptive URLs + Cleanup

**Scope:** Make URLs human-readable, clean up stale artifacts
**Package:** `packages/dashboard`
**Depends on:** P1 (README references URLs)

---

## Tasks

### 1. Descriptive browser tab titles

Keep existing URL paths (/runs/:id, /tasks/:id) — IDs are stable for bookmarks
and sharing. Descriptive context comes from the page title instead:

Set `document.title` based on page content:
- `"mimi on dispatch-retry — Ductum"` (run page)
- `"dx-fixes-round-1 — ductum — Ductum"` (spec page)
- `"dispatch-retry — Ductum"` (task page)

Use a `useEffect` in each page component to update the title.

### 2. Browser tab titles

Set `document.title` on each page:
- Homepage: "Ductum Dashboard"
- Project: "{project.name} — Ductum"
- Run: "{agent} on {task} — Ductum"

### 3. Clean up stale files

- Delete any `.js` / `.js.map` files committed in `src/` directories
- Verify .gitignore prevents future commits of build artifacts

## Verification

- [ ] Browser tab shows descriptive title on each page
- [ ] No stale .js files in src/ directories
- [ ] .gitignore covers build artifacts
