# D169: Public operator CLI surface retirement

Date: 2026-06-10

## Status

Accepted.

## Context

D166 accepted the operational model redesign: Factory -> Project ->
Repository/Component -> Spec -> Task -> Attempt, with Factory Settings owning
factory-level configuration.

Dogfooding `ductum@0.1.3` showed the public CLI still exposed older operator
layers as normal paths: `run`, `target`, `resource`, `config`, `operator`,
`doctor`, `queue`, and multiple debug-style task/run commands. Those commands
kept the old assembly-manual workflow alive even when the internal model had
moved on.

Hiding obsolete commands or preserving them as compatibility aliases was
rejected. That keeps sediment in the product surface and makes the normal
operator path ambiguous.

## Decision

The normal public operator surface is:

Factory -> Project -> Repository -> Spec -> Task -> Attempt ->
Repair/Approval.

The public top-level CLI keeps only the commands that serve that model:

- `init`
- `start`
- `status`
- `repair`
- `project`
- `repository`
- `spec`
- `task`
- `attempt`
- `approve`
- `deny`
- `retry`
- `cancel`
- `watch`
- `logs`
- `factory`

Obsolete public CLI command surfaces are removed rather than hidden,
namespaced, or kept as aliases. Removed surfaces include the old
`run`/`run-close`, `target`, `resource`, `config`, `operator`, `doctor`,
`queue`, `dispatcher`, `integrity`, `agent`, `telegram`, `turns`, and `budget`
operator paths.

Stale API compatibility routes for deleted operator workflows are removed when
they have no current dashboard, script, or internal runtime consumer.

Internal API/runtime mechanics may remain only when they are not exposed as an
operator workflow. Internal fields or helpers that still support repair,
status, dashboard rendering, enforcement, or runtime bookkeeping do not
justify reintroducing their old CLI command surfaces.

Fresh setup must not require `config migrate-legacy`, and `ductum.yaml` is not
the normal operator authority.

## Consequences

`ductum --help` teaches the normal path first:

```sh
ductum init --no-login --no-browser
ductum start --no-browser
ductum project create <name> --repo <path> --merge-mode human
ductum repair
ductum status
```

Scripts, docs, API guidance, core guidance, and dashboard copy must not tell
operators to run deleted commands.

No legacy alias retirement ledger is needed for this change because no
compatibility aliases are kept. Future reintroduction of compatibility or
debug surfaces needs a new decision and must not appear in the normal
top-level help.

Dogfooding should use the clean public path and fix missing state through
`repair`, not by manually driving old run/target/resource/config machinery.
