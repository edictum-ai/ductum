# P18 - Review Verdict Strictness

## Problem

Codex review runs have repeatedly produced useful-looking output but no
machine-readable `PASS`, `WARN`, or `FAIL` verdict. Ductum currently marks those
reviews malformed, which is correct, but the operator flow is still too slow:
the reviewer prompt and completion handling should make the required verdict
harder to miss and the failure easier to recover from.

## Scope

- Write scope: review prompt/completion parsing and tests only.
- Prefer `packages/core/src/post-completion*.ts` and existing tests.
- Do not touch dashboard or onboarding docs in this slice.
- Do not add dependencies.

## Behavior Contract

- Review prompts must require exactly one terminal verdict line:
  `PASS`, `WARN`, or `FAIL`.
- Malformed review completion must remain a failed review, not a code-fix task.
- The failed review must include visible recovery guidance for rerun/retry.
- Existing PASS/WARN/FAIL routing must keep working.

## Verification

```sh
pnpm --filter @ductum/core test -- post-completion-router
pnpm --filter @ductum/core test -- dispatcher
pnpm build
git diff --check
```

## Decision Trace

- Decision `053`: review state must be explicit factory state.
- Decision `060`: malformed review output is drift, not success.
- Decision `108`: operator surfaces must expose truthful state.

## Slop Review

- Attack parsing that accepts prose as a verdict.
- Attack fixes that dispatch implementation work from malformed review output.
- Attack prompts that still allow ambiguous verdict formats.
