# P2 - Structured Review Contract

## Decision Trace

- D054: harness adapters emit events; Ductum owns review orchestration.
- D173: malformed/failed states must be operator-legible through
  `whatToDoNext`.
- P1 must land first so malformed reviews surface reliably.

## Behavior Contract

- [ ] Runtime must reject reviewer and judge completions that do not validate
  against one strict structured contract; evidence: core parser/router tests.
- [ ] Empty or malformed output must retry at most once when policy allows, then
  fail/quarantine loudly with recovery instructions; evidence: post-completion
  tests.
- [ ] Best-of-N winner selection must reject invalid candidate IDs, missing
  scores, policy mismatch, and ineligible winners; evidence: bakeoff outcome
  tests.
- [ ] FAILS if CLI/API compare surfaces hide malformed counts or recovery state;
  evidence: API/CLI tests.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/post-completion.test.ts src/tests/post-completion-router
pnpm -C packages/api build
pnpm -C packages/api exec vitest run src/tests/bakeoff-compare-policy.test.ts src/tests/routes/bakeoff-verdict-evidence.routes.test.ts
pnpm -C packages/cli build
pnpm -C packages/cli exec vitest run src/tests/bakeoff-command.test.ts
node scripts/check-file-size.mjs
git diff --check
```

## Drift Handling

If the structured contract needs a new public response type or migration, record
the decision before implementing it.

## Slop Review

- [ ] Attack missing or invalid inputs: empty text, prose-only PASS, duplicate verdicts,
  invalid JSON, unknown candidate, missing score, policy mismatch.
- [ ] Attack runtime behavior: prove malformed review cannot retry forever or keep a
  candidate active forever.
- [ ] Attack explicit evidence: evidence can help, but cannot silently override a
  rejected contract.

## Objective

Make reviewer and judge output strict enough for unattended bakeoffs.

## Read first

- `packages/core/src/post-completion.ts`
- `packages/core/src/bakeoff-outcomes.ts`
- `packages/core/src/post-completion-router-route-review.ts`
- `packages/core/src/post-completion-router-route-blind-review.ts`
- `packages/api/src/routes/bakeoffs.ts`
- `packages/api/src/lib/bakeoff-compare.ts`
- Existing tests under `packages/core/src/tests/post-completion*` and
  `packages/api/src/tests/*bakeoff*`

## Allowed Scope

- Review prompt shape, parser, structured verdict validation, malformed handling,
  API/CLI compare fields, and retry/quarantine behavior tied to malformed output.

## Non-goals

- Do not weaken the verdict format to accept ambiguous prose.
- Do not make evidence alone sufficient when the explicit completion contract is
  missing unless the fallback is validated and operator-visible.
- Do not add a new model provider or harness.

## Implementation Notes

- Prefer a single typed contract for code review and Best-of-N judge output.
- Keep old PASS/WARN/FAIL support only if it maps cleanly into the structured
  contract and remains fail-closed.
- Store enough evidence to compute malformed-output rate for P6.

## Acceptance Criteria

- A malformed review produces exactly one automatic stricter retry if allowed;
  otherwise it becomes a visible operator item.
- A valid structured review/judge result routes exactly once.
- Bakeoff compare shows why a verdict did not select a winner.
- The final verdict contract is included in prompts and tests.

## Stop Conditions

- A parser change that makes casual prose count as PASS.
- An infinite or unbounded malformed retry path.
- A hidden failed review that does not show in status/compare after P1.
