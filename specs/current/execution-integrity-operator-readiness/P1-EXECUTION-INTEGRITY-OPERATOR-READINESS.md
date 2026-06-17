# P1 - Execution Integrity Operator Readiness

Harden execution-integrity operator surfaces so Ductum can be trusted before
deployment or unattended operation.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `058`, `059`, `060`, `064`, `066`,
  `085`, `092`, `097`, `103`, `104`, `105`, `106`, `107`, and `108`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference; no automatic bakeoff acceptance; no Edictum behavior
  change; no `toolsRef` or `policyRef` runtime behavior in this slice.
- Allowed scope: spec/runbook artifacts, core/API integrity summary shape,
  operator brief output, CLI output, dashboard run/spec/task visibility,
  behavioral tests, dogfood records, review artifacts, and verification
  evidence.
- Drift handling: record a decision before adding storage, a new top-level
  primitive, broad success inference, policy behavior, `toolsRef`/`policyRef`
  runtime semantics, or a second reconcile/integrity path.

## Behavior Contract

This prompt is bound to the source-of-truth Behavior Contract in `README.md`.
Implementation must satisfy every item there, especially:

- The adversarial review path must fail visibly unless a real PASS is recorded,
  or unresolved findings are imported as tasks with evidence.
- CLI output must preserve visible mode counts and example rows for
  orchestrated, external, recorded, unknown, and inconsistent work.
- API operator brief JSON and CLI operator brief text must make integrity
  contradictions, mode counts, and sampled issue details visible without
  requiring log inspection.
- Dashboard run rows must preserve API execution-mode fields and render
  inconsistent rows with visible warnings.
- Dashboard project/spec task rows must resolve task execution integrity from
  API data and render unresolved task contradictions visibly.
- Failed or active runs with evidence prose saying "PASS" must not become done,
  external, or cleanly successful.
- Evidence output must preserve external outcome and bakeoff outcome evidence
  as explicit structured `custom` evidence with `kind: external-outcome` or
  `kind: bakeoff-candidate-outcome`.
- Agent runtime behavior must preserve `toolsRef` and `policyRef` as
  metadata-only refs in this slice.
- Reconcile dry-run must remain converged on clean state and must not create
  execution-outcome evidence.
- API/CLI/dashboard implementation must fail review if it adds a new table,
  primitive, dependency, second policy system, reconcile path, duplicate
  classifier, or Edictum policy change.

## Implementation Notes

- Reuse `packages/core/src/execution-integrity.ts` and API helper functions.
- Keep summary/sample derivation in one API helper instead of duplicating
  classifier rules in routes or UI.
- Keep CLI output compact, but include mode counts plus examples for every
  non-empty mode.
- Use dashboard badges with clear labels for inconsistent rows; do not infer
  success from integrity state.
- Add docs under `docs/` for deployment/readiness checks.

## Slop Review

- Did behavioral tests prove a failed or active run with prose saying "PASS"
  does not become successful or external?
- Did behavioral tests prove a done task without session/worktree/commit
  lineage or explicit external outcome stays inconsistent?
- Did behavioral tests or explicit evidence prove unresolved bakeoff candidates
  remain operator-visible while the spec/task looks terminal?
- Did explicit evidence prove integrity states are visible in API, CLI, and UI?
- Did reviewers attack duplicate reconcile/integrity logic instead of accepting
  a second classifier?
- Did reviewers attack fake abstractions, dead config, or future features?
- Did reviewers confirm missing or invalid inputs fail loudly and do not rely
  on logs?
- Did reviewers confirm Ductum coordinates state while Edictum remains the
  policy system?
- Did the prompt and review carry this Decision Trace?

## Verification

```sh
ductum spec contract-check ductum specs/current/execution-integrity-operator-readiness --path
ductum spec drift-review ductum execution-integrity-operator-readiness
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
curl -sS -X POST -H 'X-Ductum-Operator-Token: local-dev-token' -H 'Content-Type: application/json' -d '{"dryRun":true}' http://127.0.0.1:4100/api/runs/reconcile
```
