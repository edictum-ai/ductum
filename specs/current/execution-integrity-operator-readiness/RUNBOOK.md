# Execution Integrity Readiness Runbook

## Purpose

Use this before trusting a Ductum deployment, after reconcile repairs, and
before closing a dogfood slice as done.

## Required Checks

1. Inspect the operator brief.

```sh
DUCTUM_OPERATOR_TOKEN=local-dev-token node packages/cli/dist/index.js operator brief
```

Expected: dispatcher state is visible, queue counts are visible, and any
execution-integrity contradictions appear in the integrity section and
recommended actions.

2. Inspect execution integrity directly.

```sh
DUCTUM_OPERATOR_TOKEN=local-dev-token node packages/cli/dist/index.js integrity
```

Expected: mode counts show `orchestrated`, `external`, `recorded`, `unknown`,
and `inconsistent`. Any inconsistent task or run has a code and detail.

3. Confirm reconcile is converged without writing.

```sh
curl -sS -X POST \
  -H 'X-Ductum-Operator-Token: local-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}' \
  http://127.0.0.1:4100/api/runs/reconcile
```

Expected: `converged: true`. Dry-run must not create evidence or mutate tasks
or runs.

4. Check dashboard rows.

Open the dashboard and inspect recent run/spec rows. Operators should see
execution mode badges or integrity warnings without reading logs.

## Interpreting Modes

- `orchestrated`: Ductum has session/worktree/commit lineage, or an active
  Ductum session has started.
- `external`: work is explicitly recorded as external through structured
  custom evidence.
- `recorded`: Ductum has a record of work, but not enough lineage or external
  outcome to treat it as orchestrated or external.
- `unknown`: there is no execution signal yet.
- `inconsistent`: the row has a contradiction that needs operator action.

## Operator Rules

- Do not mark a task done because prose says "PASS".
- Do not accept a bakeoff candidate without explicit accept, reject, or fix
  outcome evidence.
- Do not count a hung adversarial review as PASS.
- Use `ductum outcome` or `ductum run-close --done --reason ...` for explicit
  external outcomes.
- Keep `toolsRef` and `policyRef` as metadata unless a later decision changes
  their runtime behavior.
