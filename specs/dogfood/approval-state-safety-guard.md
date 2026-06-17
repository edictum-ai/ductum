# Approval State Safety Guard

## Decision Trace

- decisions/053-factory-resource-model.md
- decisions/060-decision-drift.md
- decisions/104-audited-state-reconciliation.md
- decisions/106-state-convergence-reconcile.md
- decisions/108-execution-integrity-operator-readiness.md

## Behavior Contract

- A failed run must not remain approval-mergeable.
- A reviewed branch that does not contain current `main` must not merge.
- Reconcile must expose and repair stale approval latches through CLI/API flows.
- Evidence must record the commands that prove the state is truthful.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm test`
- `git diff --check`
- `node packages/cli/dist/index.js reconcile --dry-run --json`
- `node packages/cli/dist/index.js operator brief --json`

## Task

Record the approval-state fix that blocks stale approval merges, rejects failed
approval runs, reopens failed roots only after a passing descendant review, and
reconciles stale approval latches without direct database edits.
