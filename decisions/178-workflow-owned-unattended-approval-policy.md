---
date: 2026-06-22
status: accepted
deciders: operator policy for P3 auto approval, Codex
related: 053, 054, 166, 177
---

# Decision 178: Workflow-owned unattended approval policy

## Context

P3 auto approval requires Ductum to approve, merge, and optionally push without
an operator click only when the project workflow explicitly permits that mode.
The existing workflow profile owns verification commands, approval copy, and
push command boundaries, but it has no machine-readable unattended policy.
Relying on factory merge flags or inferred CI state would either bypass manual
approval by default or treat unknown CI as green.

## Decision

Add an optional `unattended` section to `WorkflowProfile` YAML. Absence means
manual approval remains the only approval path.

```yaml
unattended:
  auto_approve: true
  auto_merge: true
  auto_push: false
  push_requires: remote_ci # or local_verify
```

Rules:

- `auto_approve` and `auto_merge` must both be true before Ductum may perform an
  unattended approval/merge.
- `auto_push` must be true before an unattended approval may push.
- `push_requires: remote_ci` requires a passing remote CI latch; unknown,
  pending, failed, skipped, or absent CI blocks.
- `push_requires: local_verify` is the only workflow-defined local substitute
  for remote CI and still requires fresh structured verification evidence.
- Invalid or absent values are blocking, not permissive.

## Consequences

The policy is stored in the run's WorkflowProfile snapshot and evaluated at the
approval/merge boundary. Manual `approve` remains available and does not consult
this unattended policy unless the caller explicitly requests unattended mode.
