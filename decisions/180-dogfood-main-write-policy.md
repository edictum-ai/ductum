---
date: 2026-06-26
status: accepted
deciders: Codex, legacy issue #43 follow-up
related: 131, 166, 178
---

# Decision 180: Dogfood main-branch write policy

## Context

Legacy issue #43 records a factory safety gap: this repository could land work
directly on `main`, which makes CI post-hoc and means Ductum's own governed
merge wedge is not enforcing itself on dogfood runs.

The imported issue body is brief and the private GitHub issue body may not be
available to unauthenticated GitHub API calls, so the policy must stay
fail-closed and rely on the imported problem statement.

## Decision

For the Ductum repo, `main` is a protected branch and agents are never direct
writers to it.

- Preferred enforcement is GitHub branch protection on `main` with pull
  requests required and direct pushes blocked.
- When Ductum's workflow profile is enabled, `push.protected_branches` must
  include `main`; agents may only push feature branches, while `main` writes
  stay behind Ductum's approval/merge path.
- If GitHub branch protection and the workflow profile disagree, the safer
  interpretation wins: no direct agent write to `main`.
- Any future unattended `main` write path must remain workflow-owned and must
  not treat missing branch-protection state, missing CI, or missing review
  evidence as permissive.

## Consequences

- `AGENTS.md` now states the repo-level main-branch rule explicitly.
- The dogfood workflow profile remains the machine-readable enforcement surface:
  the rendered workflow blocks pushes to protected branches in implement and
  ship, while still allowing feature-branch pushes when the ship stage permits
  them.
- Tests pin that the Ductum profile renders `main` as protected so the policy
  cannot drift silently.
