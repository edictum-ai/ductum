---
date: 2026-05-01
status: accepted
deciders: operator (Arnold Cartagena), Codex
related: 107, 109, 110, 115
---

# Decision 117: Represent shipped spec backfill as recorded runs with import evidence

## Context

Stage 5 of `factory-readiness-recovery` has to import 30 already-shipped spec
directories into the Ductum DB without pretending Ductum orchestrated the work.

Two schema/runtime constraints matter:

1. `runs.agent_id` is a foreign key to `agents.id`, so a bare git author string
   cannot be written straight into a Run.
2. Execution integrity currently marks any `stage=done` run with a linked commit
   but no Ductum session/worktree lineage as inconsistent unless there is
   explicit structured provenance saying the row is a retrospective record.

## Decision

- Add a dedicated custom evidence kind, `bulk-import-shipped-spec`, for
  retrospective shipped-spec imports.
- Treat that evidence as a **recorded** provenance marker in execution
  integrity. It suppresses the false "done without lineage" contradiction, but
  it does **not** upgrade the run to orchestrated.
- Materialize git authors as synthetic non-dispatch agents keyed by the author
  string when a historical import needs them. These rows exist only so imported
  Runs can preserve authorship while satisfying the foreign key.
- Expose a CLI/API path that:
  - parses markdown spec dirs,
  - resolves matching `feat:` / `fix:` commits from git history,
  - creates/imports the Spec + Tasks idempotently,
  - records one done Run per task with bulk-import evidence,
  - marks abandoned legacy specs failed with explicit reasons.

## Why

This keeps Decision 107 honest. Imported work stays visibly recorded rather than
laundered into orchestrated lineage, while still letting the factory ledger
match what the repo has already shipped.

## Non-goals

- No new top-level primitive or table.
- No fake Ductum session/worktree lineage for historical work.
- No re-running already-shipped tasks just to satisfy the database.
