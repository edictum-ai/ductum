# OpenClaw Operator Guide: Using Ductum

For autonomous operators interacting with a Ductum factory. Covers operations,
not installation.

```bash
alias ductum='node packages/cli/dist/index.js'
ductum config api-url set http://127.0.0.1:4100
ductum config token set --stdin
```

## Start And Inspect

```bash
ductum start --no-browser
ductum repair
ductum status
```

`status` is the primary operator view for Projects, Repositories, Specs, Tasks,
Attempts, approvals, active work, and repair-needed state.

## Create Work

```bash
ductum project create <project> --repo <path> --merge-mode human
ductum project agent assign <project> <agentName> --role builder
ductum spec create <project> <specName>
ductum task create <specId> <taskName> --agent <agentName> --role builder
ductum task depend <taskId> <dependsOnId>
ductum spec approve <specId>
```

Import a pre-written spec directory with its task DAG:

```bash
ductum spec import <path> --project <project>
```

## Attempts

```bash
ductum attempt start <taskId> --agent <agentName> --project <project>
ductum watch <attemptId>
ductum status <attemptId>
ductum logs <attemptId>
```

Stages: `understand` -> `implement` -> `ship` -> `done`. `fixing`
remediates specific CI/review findings. `stalled` needs operator action.

## Approval

When merge mode is `human`, reviewed Attempts wait for manual approval.

```bash
ductum approve <attemptId>
ductum deny <attemptId> --reason <text>
ductum retry <attemptId>
ductum cancel <attemptId> --reason <text>
```

Approving merges the worktree into the base branch and cleans up descendant
Attempts.

## Quick Reference

| Action | Command |
|---|---|
| Factory status | `ductum status` |
| Repair readiness | `ductum repair` |
| Import spec | `ductum spec import <path> --project <name>` |
| Start Attempt | `ductum attempt start <taskId> --agent <name> --project <name>` |
| Monitor Attempt | `ductum watch <attemptId>` / `ductum status <attemptId>` |
| Approve / Deny | `ductum approve <attemptId>` / `ductum deny <attemptId> --reason <text>` |
| Retry / Cancel | `ductum retry <attemptId>` / `ductum cancel <attemptId> --reason <text>` |
