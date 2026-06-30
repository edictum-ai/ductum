# Control-Plane Recovery

Alpha dogfood reference for recovering the Ductum control plane after crashes,
stalled Attempts, or failed dispatch cycles. Single-operator, single-machine.

## First Checks

```bash
ductum repair
ductum status
```

`repair` reports missing Factory, Project, Repository, Agent, assignment, and
readiness blockers. `status` shows the current Project -> Repository -> Spec ->
Task -> Attempt state and the next operator action.

## Attempts

A stalled Attempt means no heartbeat arrived within the configured timeout.
Inspect it before taking action:

```bash
ductum status <attemptId>
ductum logs <attemptId>
```

Retry or cancel through the public Attempt controls:

```bash
ductum retry <attemptId>
ductum cancel <attemptId> --reason "operator cancelled"
```

## Approvals

Reviewed Attempts wait in the dashboard approvals view and in `status`.

```bash
ductum approve <attemptId>
ductum deny <attemptId> --reason "needs rework"
```

`deny` makes the Attempt retryable instead of pretending the work landed.

## Audit Visibility

Attempt detail pages show stage transitions, evidence, updates, and approval
state. Use `status` for the CLI view and the dashboard for timeline detail.

## What Blocks Safe Multi-User Operation

The alpha is single-operator. Before adding a second user:

- No auth or role model. Anyone who reaches the protected API can approve,
  retry, or cancel Attempts.
- No row-level isolation. A second operator sees and can mutate the first
  operator's Attempts.
- Single dispatcher. `activeSessions` is in-memory. Two API processes race on
  dispatch, heartbeat, and stall detection.
- SQLite file lock. Concurrent writes from two API processes contention-fail
  under load.
- Shared worktree namespace. Worktree paths include Attempt ID but not
  operator.

Until these land, Ductum is safe for one operator driving the factory at a time.
