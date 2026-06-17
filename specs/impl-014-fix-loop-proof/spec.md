# impl-014 — Fix Loop Proof

A minimal spec that exercises the impl → review FAIL → fix → re-review
→ ship loop on a real factory dispatch with cheap GLM agents. The
prompt intentionally describes only the happy path of the helper, so
round-1 review is likely to flag missing edge cases and round-2 fix
adds them.

## Goals

- Add one tiny utility helper, but with deliberate edge cases that
  the round-1 implementation will probably miss.
- Round-2 fix completes the missing cases.

## Tasks

| # | Task | Scope |
|---|------|-------|
| 1 | P1-CSV | New `packages/core/src/utils/csv.ts` exporting `parseCsvRow(line)` plus a vitest. Round 1 may miss quoted-field handling. |
