# P6 - Bakeoff Stats Matrix

## Decision Trace

- D053/D166: bakeoffs are Specs/Tasks/Attempts, not a separate top-level
  operation.
- P2 provides structured verdict/malformed information.
- P4 proves model routes before spending on a matrix.

## Behavior Contract

- [ ] Bakeoff stats must include cost, tokens, wall time, attempts, pass/fail,
  malformed rate, review pass rate, judge, winner, human override, and failure
  category; evidence: API/CLI tests.
- [ ] Runtime must reject a matrix that omits configured/routable GLM 5.2, GPT
  5.5, Opus 4.8, or Sonnet 4.6 without a doctor-proven block; evidence: live
  matrix output.
- [ ] Runtime must reject reviewer/judge assignments that reuse builder models
  where policy requires separation; evidence: bakeoff create validation tests.
- [ ] FAILS if stats change meaning or hide approval state after
  approval/merge/push; evidence: compare output before and after approval.

## Verification

Run and report exact output:

```sh
pnpm -C packages/api build
pnpm -C packages/api exec vitest run src/tests/bakeoff-compare-policy.test.ts src/tests/bakeoff-scoring.test.ts src/tests/routes/bakeoff.routes.test.ts
pnpm -C packages/cli build
pnpm -C packages/cli exec vitest run src/tests/bakeoff-command.test.ts
pnpm -C packages/dashboard build
pnpm -C packages/dashboard exec vitest run
node scripts/check-file-size.mjs
git diff --check
```

Then run one live matrix only after P1/P2/P4 are verified.

## Drift Handling

If durable stats require a migration, record it and include upgrade tests. Do not
derive user-facing stats from raw log archaeology when durable rows exist.

## Slop Review

- [ ] Attack runtime behavior: malformed, skipped, failed, approved, and
  rerun attempts must count in the correct bucket.
- [ ] Attack provenance: GLM, GPT, Opus, and Sonnet stats must not collapse
  by harness or alias.
- [ ] Attack runtime behavior: after an accepted winner, compare must not ask for
  stale approval.

## Objective

Add truthful bakeoff stats and run the four-model matrix needed to judge
unattended quality/cost.

## Read first

- `packages/api/src/lib/bakeoff-compare.ts`
- `packages/api/src/lib/bakeoff-scoring.ts`
- `packages/cli/src/commands/spec-bakeoff.ts`
- `packages/dashboard/src` bakeoff compare panel
- P1/P2/P4 outputs

## Allowed Scope

- API/CLI/dashboard compare stats, persisted metrics if needed, model identity
  labeling, live matrix creation/reporting.

## Non-goals

- Do not run the live matrix before provider doctor and lifecycle fixes are
  green.
- Do not use stale or failed historical bakeoffs as the final stats proof.
- Do not hardcode local-only agent names without reading Factory Settings.

## Implementation Notes

- Include per-model and per-judge rows.
- Track malformed output rate separately from implementation failure.
- Keep approved/accepted winner state separate from pending approval.

## Acceptance Criteria

- API and CLI expose the stats.
- Dashboard renders the same stats without a second interpretation.
- Live matrix report includes the four requested models or a doctor-proven
  explicit block for any missing one.

## Stop Conditions

- Provider doctor reports a required model unroutable.
- Lifecycle status still has active ghosts or hidden failed reviews.
- Stats cannot distinguish model/provider/account identities.
