---
name: ductum-cli
description: Drive the Ductum factory through its CLI. Use for Factory, Project, Repository, Component, Spec, Task, Attempt, Factory Settings, Repair, approval, and recovery work. Never use curl, sqlite3, or hand-edited ductum.yaml as a substitute for a shipped command.
---

# ductum-cli

Ductum is the factory control plane. Use the CLI for supported state reads and
writes.

## Hard Rules

1. No curl for API state.
2. No `sqlite3 ductum.db`.
3. No hand-edited live `ductum.yaml`.
4. No `--no-verify` on commits.
5. No agent-side resets. Ductum owns Attempt state.
6. Never pass `run_id` to tools. Session binding owns that internally.

Set the local alias:

```sh
export DUCTUM="node packages/cli/dist/index.js"
```

## Normal Path

```sh
$DUCTUM init --no-login --no-browser
$DUCTUM start --no-browser
$DUCTUM project create <project> --repo "$PWD" --merge-mode human
$DUCTUM repair
$DUCTUM status
```

## Project And Repository

```sh
$DUCTUM repository list <project>
$DUCTUM repository add <project> --repo /absolute/path/to/git/repo
```

`--repo` must be an existing Git repository.

## Factory Settings

```sh
$DUCTUM factory settings
$DUCTUM repair
```

Factory Settings own Providers, Models, Harnesses, Workflows, Agents,
sandboxes, notifications, budgets, and app settings. Secret-bearing settings
must use `${ENV_VAR}` references.

## Specs And Tasks

```sh
$DUCTUM spec intake <project> <path> --import
$DUCTUM spec list <project>
$DUCTUM task list <specId>
$DUCTUM task create <specId> <name> --repo <repositoryName> --role builder --file <prompt.md>
$DUCTUM task dag <specId>
```

## Attempts

```sh
$DUCTUM attempt start <taskIdOrName> --agent <agentName> --project <project>
$DUCTUM watch <attemptId>
$DUCTUM logs <attemptId>
$DUCTUM status <attemptId>
$DUCTUM approve <attemptId>
$DUCTUM deny <attemptId> --reason "<reason>"
$DUCTUM retry <attemptId>
```

## Self-Test

A fresh agent reading only this skill plus `AGENTS.md` must be able to:

1. Create a Project from a local Git checkout with `project create --repo`.
2. Confirm readiness with `repair` and `status`.
3. Import a Spec with `spec intake --import`.
4. Start a Task with `attempt start`.
5. Approve, deny, or retry the resulting Attempt.

Zero curl. Zero `sqlite3`. Zero hand-edited live YAML.
