# Execution Integrity Readiness

Use this before trusting a Ductum deployment and before closing dogfood work as
done.

## Checks

1. Repair:

```sh
ductum repair
```

Any execution-integrity contradiction must appear as a repair blocker.

2. Status:

```sh
ductum status
```

`status` should show Project, Repository, Spec, Task, Attempt, approval, and
repair counts that match the dashboard.

If the deployment uses a non-default API URL or a token that cannot be
auto-discovered from local Factory state, configure the CLI once with
`ductum config api-url set <url>` and `ductum config token set --stdin`.

3. Dashboard:

Recent Attempt, Spec, and Task rows should show execution mode badges or
integrity warnings from API data. Do not rely on logs to find contradictions.

## Rules

- Do not treat prose saying "PASS" as success.
- Do not mark tasks done without Ductum lineage or explicit external outcome.
- Do not clean dirty failed or paused attempt worktrees until useful partial
  work is saved and a trusted task outcome exists. Use
  `ductum attempt cleanup <attemptId> --worktree` for the cleanup record.
- Do not accept bakeoff candidates without structured accept/reject/fix outcome
  evidence.
- Do not count a hung adversarial review as PASS.
- Keep `toolsRef` and `policyRef` metadata-only until a later decision changes
  runtime behavior.
