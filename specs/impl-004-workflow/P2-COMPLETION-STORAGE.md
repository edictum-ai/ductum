# P2: Completion Storage + DB Persistence

**Scope:** Store completion summaries, ensure DB survives restarts
**Package:** `packages/core`, `packages/api`
**Depends on:** None

---

## Required Reading

- `packages/core/src/db.ts` — migration system
- `packages/api/src/lib/run-ops.ts` — `completeRun()` function
- `packages/mcp/src/server.ts` — `ductum_complete` handler
- `scripts/serve.mjs` — server startup

## Tasks

### 1. Add completion_summary to runs table

Migration `006_completion_summary`:
```sql
ALTER TABLE runs ADD COLUMN completion_summary TEXT;
```

### 2. Store summary on ductum_complete

When the agent calls `ductum_complete(result)`, store the result text in `runs.completion_summary`.
Update `completeRun()` in run-ops.ts to accept and store the summary.

### 3. Expose in API and dashboard

- GET /api/runs/:id already returns the full run — `completion_summary` will be included
- Dashboard: show completion summary on RunDetail (e.g., collapsible section at the top for done runs)

### 4. DB persistence

Ensure `serve.mjs` does NOT delete the DB on startup.
Ensure all migrations are idempotent (check if column/table exists before creating).
Add a `--reset` flag to serve.mjs for when the dev explicitly wants a fresh DB.

## Verification

- [ ] Agent's ductum_complete text stored in runs.completion_summary
- [ ] GET /api/runs/:id returns completion_summary field
- [ ] Restart server → all data preserved
- [ ] `pnpm serve --reset` wipes DB (explicit opt-in)
