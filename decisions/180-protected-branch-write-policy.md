---
date: 2026-06-26
status: accepted
deciders: Codex, operator backlog policy
related: 178
---

# Decision 180: Protected-branch write policy is workflow-owned

## Context

The Ductum repo historically landed changes directly on `main`, which means
GitHub CI only observes the write after it lands and the product's own workflow
gate does not explicitly define how protected branches are allowed to move.
Before dogfooding main writes, the repo needs a fail-closed policy that says
whether protected-branch writes are owned by Ductum's merge gate or by GitHub
branch protection.

## Decision

Add `push.protected_branch_mode` to `WorkflowProfile`:

```yaml
push:
  protected_branches: [main]
  protected_branch_mode: merge_gate_only # or github_pull_request
```

- `merge_gate_only` means agents may still push feature branches, but protected
  branches may only move through Ductum's approval/merge boundary.
- `github_pull_request` means protected branches must land through a PR-backed
  merge. Ductum rejects local branch merges to protected branches when this mode
  is active.
- Missing/invalid values on an enabled profile are blocking, not permissive.

The Ductum repo now documents `merge_gate_only` in its workflow profile until an
operator explicitly switches the repo to GitHub-protected PR delivery.

## Consequences

Workflow profiles now carry a machine-readable protected-branch policy beside
the existing protected-branch push guard and unattended approval policy.
Approval-time merge logic can enforce PR-only delivery for protected branches
without relying on ad hoc repo conventions.
