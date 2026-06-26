# D183 - Counts in summaries come from count queries, not default-limited lists

**Date:** 2026-06-26
**Status:** accepted
**Linked:** legacy issue #35, D060 (decision drift), D173 (operator legibility)

## Context

Legacy issue #35 documented a truthfulness failure mode: summaries, receipts,
and reports can silently become dishonest when they derive counts from list
methods that apply a hidden default limit. A surface that says "50 active runs"
after calling a method that only returns the newest 50 rows is not a summary;
it is a truncated sample mislabeled as a count.

The imported issue body did not include a richer structured spec. The safe
closed-form interpretation is therefore narrow and explicit:

- ban user-facing counts derived from default-limited list methods;
- require count queries or explicit count APIs for summary-style surfaces; and
- add a lightweight repo guard for the known bad patterns.

## Decision

For any user-facing summary, receipt, brief, dashboard stat, or report:

1. **Counts must come from a `COUNT(*)` query or an explicit count API.**
2. **Default-limited list methods must never be used as the source of a
   user-facing count**, even if the caller later reads `.length`.
3. A full unbounded list may still be fetched when the surface truly needs the
   rows themselves, but that is not a substitute for a count API.
4. If a new summary surface cannot use a count query yet, stop and record a
   follow-up decision rather than shipping a silently truncated count.

## Enforcement in this repo

- `AGENTS.md` now states the directive as a repo rule.
- `scripts/check-count-queries.mjs` fails CI on the known bad patterns in
  summary/report/receipt/status/brief files:
  - `repos.runs.listAll()` without an explicit `limit`
  - `api.listAttempts()` without an explicit `limit`
  - `api.listAllRuns()` without an explicit `limit`

This guard is intentionally scoped to the legacy issue's documented failure
mode. It is not a full static proof of count honesty, but it blocks the common
regression shape that made summaries dishonest in the first place.
