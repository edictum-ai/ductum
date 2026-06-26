# D182 — Plan equals run minus writes

**Date:** 2026-06-26
**Status:** accepted
**Linked:** GitHub issue #34 (legacy migrated), D166

## Context

The imported issue asks Ductum to stop treating dry-run/plan output as a second
implementation. On 2026-06-26, the live GitHub issue URL returned 404, so the
repo only had the migrated prompt summary: the old migration dry-run had a
parallel code path and printed hardcoded zeros. Per the issue safety note, this
work stays narrowly scoped to an enforceable directive plus behavioral proof in
current code.

## Decision

Every new CLI/API dry-run or plan surface must execute the same orchestration as
its real write path, with writes stubbed at the boundary.

That means:

- keep validation, reads, branching, and summary derivation shared;
- stub only the mutating filesystem/API/DB writes;
- forbid separate dry-run-only counters, placeholders, or hardcoded summaries;
- require a test that compares dry-run and apply behavior from the same runner.

`ductum onboard --dry-run` is the reference implementation for this directive:
it now reuses the real onboarding runner, keeps the real project lookup, and
stubs only workflow-profile writes plus API mutations.

## Consequences

- Dry-run output can accurately reflect create-vs-attach behavior.
- Future regressions should fail in tests when plan and apply drift.
- When legacy source context is missing or ambiguous, prefer a narrow shared-run
  refactor over a broad rewrite.
