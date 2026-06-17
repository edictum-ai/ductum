# Sandbox Shell DB Access Gap

## Decision Trace

- decisions/053-factory-resource-model.md
- decisions/056-sandbox-resource-model.md
- decisions/058-minimal-scope-and-reference-non-goals.md
- decisions/060-decision-drift.md
- decisions/081-sandbox-runtime-driver.md
- decisions/108-execution-integrity-operator-readiness.md

## Behavior Contract

- Ductum-managed agents must use CLI/API/MCP-supported flows for factory state.
- A worktree run must not read or mutate the live factory SQLite database
  through shell commands.
- Unsupported sandbox claims must fail loudly with operator-visible evidence.
- The CLI/API must expose the supported next command when an agent needs
  factory state.

## Evidence

- During run `JUbYMoiM7gKk`, the agent executed `sqlite3` commands against
  `/Users/acartagena/project/ductum/ductum.db` from a Ductum-managed worktree.
- The observed commands inspected tables/schema/rows. No write was observed,
  but the sandbox boundary allowed direct live DB access.

## Task

Close or explicitly block live factory DB access from Ductum-managed shell
commands, and replace the workflow with supported CLI/API/MCP state inspection
commands.

## Implemented Guard

- `EnforcementManager.authorizeTool` rejects Bash commands that reference the
  configured factory DB path, SQLite sidecar paths, or `DUCTUM_DB_PATH`.
- The rejection records a blocked gate evaluation, updates the run
  `blockedReason`, and creates `tool.command_blocked` evidence.
- Worktree-relative traversal to the protected DB path is blocked before
  Edictum workflow evaluation.
