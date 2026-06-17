# Execution Integrity Readiness

Use this before trusting a Ductum deployment and before closing dogfood work as
done.

## Checks

1. Repair:

```sh
DUCTUM_OPERATOR_TOKEN=local-dev-token node packages/cli/dist/index.js repair
```

Any execution-integrity contradiction must appear as a repair blocker.

2. Status:

```sh
DUCTUM_OPERATOR_TOKEN=local-dev-token node packages/cli/dist/index.js status
```

`status` should show Project, Repository, Spec, Task, Attempt, approval, and
repair counts that match the dashboard.

3. Dashboard:

Recent Attempt, Spec, and Task rows should show execution mode badges or
integrity warnings from API data. Do not rely on logs to find contradictions.

## Rules

- Do not treat prose saying "PASS" as success.
- Do not mark tasks done without Ductum lineage or explicit external outcome.
- Do not accept bakeoff candidates without structured accept/reject/fix outcome
  evidence.
- Do not count a hung adversarial review as PASS.
- Keep `toolsRef` and `policyRef` metadata-only until a later decision changes
  runtime behavior.
