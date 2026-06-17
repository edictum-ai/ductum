# P1 - Audited State Reconciliation

Implement persistent audit records for state reconciliation repairs.

## Decision Trace

- Decisions: `022`, `025`, `026`, `053`, `059`, `060`, `064`, `066`, `092`,
  `103`, `104`, and `105`.
- Non-goals: no new primitive/table/dependency; no second policy system; no
  broad success inference from evidence/review prose; no dashboard redesign.
- Allowed scope: reconcile audit payloads, run updates, API structured output,
  CLI/API-visible state, behavioral tests, dogfood records, and review artifacts.
- Drift handling: record a decision before adding a new table, task update
  stream, generalized success inference, dashboard redesign, or policy behavior.

## Behavior Contract

This prompt is bound to the source-of-truth Behavior Contract in
`README.md`. Implementation must satisfy every item there, especially:

- Run and task repairs must create visible run updates and evidence records.
- Audit evidence or run update write failures must fail loudly and must not
  leave an in-transaction repair half-recorded.
- Dry-run reconcile must not mutate runs, tasks, run updates, or evidence.
- API and CLI output must preserve visible audit identifiers for repairs and
  post-commit side-effect failures.

Reconcile stays narrow: no new table, primitive, dependency, policy system,
marketplace, or broad success inference.

## Implementation Notes

- Prefer a small helper that writes a run update and `custom` evidence together.
- Include `kind: "state-reconcile"` in the evidence payload.
- Use existing run update and evidence repos; do not add storage.
- Keep dry-run branches read-only.

## Slop Review

- Did behavioral tests prove every reconcile mutation path gets persistent
  evidence or a stated reason
  why it did not mutate?
- Did explicit evidence show audit payloads are useful for later operator
  inspection, not just marker rows?
- Did behavioral tests attack dry-run and prove it remains fully read-only?
- Did the implementation avoid duplicate reconciliation logic, a new table, or
  a fake abstraction?
- Did it avoid broad success inference from evidence or review text?
- Did it avoid swallowed or logs-only recovery explanations?
- Did tests prove behavior on the DB state after reconcile?

## Verification

```sh
ductum spec contract-check ductum specs/current/audited-state-reconciliation --path
ductum spec drift-review ductum audited-state-reconciliation
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
