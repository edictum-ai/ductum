# P1: Exit Condition Matching

**Scope:** Fix @edictum/core exit conditions to match against actual tool args
**Package:** `packages/core`
**Depends on:** None

---

## Required Reading

- `packages/core/src/enforce.ts` — `recordToolSuccess()` method
- `workflows/coding-guard.yaml` — exit conditions (file_read, command_matches)
- `packages/harness/src/claude.ts` — PostToolUse hook that calls reportToolSuccess
- @edictum/core source: check how `recordResult()` evaluates conditions
  - Look in `/Users/acartagena/project/edictum-ts/packages/core/src/workflow/`

## Problem

Exit condition `file_read("README.md")` expects a relative filename.
The harness passes `{ file_path: "/Users/acartagena/project/ductum/README.md" }`.
The condition matcher doesn't find a match, so the workflow never auto-advances.

## Tasks

### 1. Investigate @edictum/core condition matching

Read the @edictum/core source to understand:
- How does `file_read("README.md")` get evaluated?
- What fields does it check in the envelope?
- Does it do substring/basename matching, or exact match?

### 2. Normalize tool args before recording

In `recordToolSuccess()`, normalize the envelope before passing to `recordResult()`:
- For Read/Write/Edit/Glob tools: extract basename or relative path from absolute `file_path`
- For Bash: keep `command` as-is (command_matches conditions use regex)

### 3. Test auto-advance

Write a test that:
1. Starts a run at `implementing` (workflow syncs to `implement`)
2. Manually set workflow to `read-analyze` to test the full flow
3. Records a Read of "README.md"
4. Verifies the workflow advances to `create-branch`

### 4. DB persistence (absorbed from impl-004/P2)

Ensure DB survives restarts:
- `serve.mjs` must NOT delete the DB on startup
- All migrations must be idempotent (check if column/table exists before creating)
- Add `--reset` flag to serve.mjs for explicit DB wipe
- Test: restart server → all runs, activity, evidence preserved

## Verification

- [ ] Reading README.md causes workflow to advance past read-analyze
- [ ] Bash command matching still works (no regression)
- [ ] Tests cover absolute path → relative path normalization
- [ ] Server restart preserves all data
- [ ] `pnpm serve --reset` wipes DB (explicit opt-in)
