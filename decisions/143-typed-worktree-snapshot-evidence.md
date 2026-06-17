# D143 — Typed Worktree Snapshot Evidence

Date: 2026-05-03

Status: Implemented

## Context

D115 Gap 3 called out that abandoned or verified worktrees had no typed evidence
shape. D135 formalized `worktree.snapshot` as the registry-backed payload for
agent-first consumers.

## Decision

Implementation and fix completion now attach a `custom` evidence row whose
payload kind is `worktree.snapshot` whenever the completion has a real git
worktree. The snapshot is recorded after Ductum syncs branch and commit fields,
and after the final verification result for that completion is known.

For verify-free workflows, the payload records `command: "(none)"`, `exitCode:
0`, and `tail: "(no verify commands configured)"`. For failed verification, the
exit code is `1` and the tail is the last 40 lines, capped at 4000 characters.

The dashboard evidence tab now dispatches typed payloads through a small
registry renderer. `worktree.snapshot` renders branch, commit, diff stat, verify
status, command, and output tail without forcing operators or agents to parse a
raw JSON blob.

## Consequences

Agents can distinguish worktree snapshots from generic operator notes and can
read a stable payload shape. Non-git temporary worktree paths do not emit this
evidence kind because the required branch and commit fields would be synthetic.
