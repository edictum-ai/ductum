# P4: Structured Completion + Cleanup

**Scope:** Agents return structured data; remove dead state machine code
**Package:** `packages/core`, `packages/mcp`, `packages/dashboard`
**Depends on:** P2 (Edictum as source of truth)
**Deliverable:** Structured completion data; old dual-lifecycle code removed

---

## Required Reading

- `specs/impl-009-edictum-integration/spec.md` §Schema Changes
- `packages/mcp/src/server.ts` — ductum_complete handler
- `packages/api/src/lib/run-ops.ts` — completeRun()

## Tasks

### 1. Structured completion payload

Update `ductum_complete` to accept optional structured fields:

```typescript
ductum_complete({
  result: "Built spec-import command with 20 tests",
  pr: "https://github.com/edictum-ai/ductum/pull/42",
  branch: "feat/spec-import",
  files_changed: 5,
  tests_added: 20,
  tests_total: 152,
})
```

Store in `completion_data` JSON column on runs table.

### 2. Migration

```sql
ALTER TABLE runs ADD COLUMN completion_data TEXT;  -- JSON
```

### 3. Dashboard completion display

For done runs, show structured completion data prominently:
- PR link, branch name
- Files changed, tests added/total
- Summary text (collapsible if long)

### 4. Remove dead code

After P2 is done, clean up:
- Remove `VALID_TRANSITIONS` from state-machine.ts
- Remove `evaluateMergeGate()` and `resolveLatch()`
- Remove `WORKFLOW_STAGE_BY_RUN_STAGE` from enforce.ts
- Remove old `RunStage` type values (implementing, pre-push-review, etc.)
- Remove parallel latch fields from Run (ciStatus, reviewStatus)
  or mark as deprecated
- Update all tests referencing old stages

### 5. Update system prompt for structured completion

Tell agent to include structured fields in ductum_complete call.

## Verification

- [ ] ductum_complete accepts structured fields
- [ ] completion_data stored in JSON column
- [ ] Dashboard shows structured completion for done runs
- [ ] No references to old RunStage values (implementing, pre-push-review, etc.)
- [ ] No VALID_TRANSITIONS or WORKFLOW_STAGE_BY_RUN_STAGE in codebase
- [ ] All tests updated and passing
