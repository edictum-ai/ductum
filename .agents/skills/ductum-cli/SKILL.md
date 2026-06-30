---
name: ductum-cli
description: Operate the Ductum factory through the DB-backed Ductum CLI. Use for Ductum project/repository/spec/task/attempt/status/watch/approve/deny/retry work, factory dogfooding, or when asked to run work through Ductum. Never use ductum.yaml.
---

# Ductum CLI

Ductum is DB-backed after init. Use the CLI as the operator surface.

Do not use `ductum.yaml`, do not edit SQLite directly, and do not call API routes with curl unless the user is explicitly debugging API behavior.

## Normal Commands

Factory/project setup:

```bash
ductum init
ductum start
ductum status
ductum project list
ductum project create <project> --repo /absolute/path/to/repo --merge-mode human
ductum project agent assign <project> <agent-name> --role builder
ductum repository add <project> --repo /absolute/path/to/repo
```

Dashboard/API access:

```bash
ductum init --no-login --no-browser
ductum start --no-browser
ductum config api-url set http://127.0.0.1:4100
ductum config token set --stdin
```

- The installed CLI auto-discovers the default local API URL and local Factory
  operator token. Use `ductum config api-url set ...` and
  `ductum config token set --stdin` for non-default, remote, or manual recovery
  paths; do not prefix every command with `DUCTUM_OPERATOR_TOKEN=...`.
- If the dashboard says `Operator token required`, open `/settings` and use
  Settings → Dashboard session → Reconnect locally. Loopback factories set an
  HttpOnly browser session without exposing the raw operator token.
- Do not print the operator token in chat or logs. Manual token copy from the
  token file or `.env.local` is only a recovery path for unusual browser/API
  setups.
- Raw browser token auto-detect is intentionally disabled unless the API was
  started with explicit local opt-in
  (`DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT=1`).

Agent/project setup:

```bash
ductum factory settings
ductum project agent list <project>
ductum project agent assign <project> <agent-name> --role builder
ductum project agent assign <project> <agent-name> --role reviewer
ductum project agent unassign <project> <agent-name> --role builder
```

- Agents are Factory Settings records. Create or edit Agents in the dashboard
  when the CLI only needs to assign existing Agents to Projects.
- A Project must have at least one builder assignment before normal dispatch is
  useful.
- Best-of-N needs 2-5 builder Agents assigned to the Project and one reviewer
  Agent whose model differs from every builder model.
- If a Best-of-N builder set uses a Claude-family model, choose a reviewer from
  a non-Claude model family. If no builder uses Claude, prefer the strongest
  assigned Claude-family reviewer when available.
- Use `ductum project show <project>` to confirm repositories, specs, and
  assigned Agents before importing or dispatching specs.
- For provider/model aliases such as GLM through a Claude-compatible mapping,
  create or edit a Factory Agent in the dashboard with the correct model,
  harness, capabilities, and credentials for that factory, then assign it to the
  Project.
- If a project has only two builder models, it can run normal work and create
  two-candidate bakeoffs, but it still needs a third, different reviewer model
  before Best-of-N review can complete.

Spec intake/import:

```bash
ductum spec intake <project> /absolute/path/to/spec-or-directory --import
ductum spec import /absolute/path/to/spec-directory --project <project>
ductum spec list <project>
```

Best-of-N / bakeoff:

```bash
ductum spec bakeoff create <project> <name> \
  --prompt-file /absolute/path/to/prompt.md \
  --builders <agent-a,agent-b,agent-c> \
  --reviewer <reviewer-agent> \
  --policy quality-gated-cost-aware \
  --verify "pnpm test"
ductum spec bakeoff compare <spec-id>
```

- Use 2-5 builders. Include cheap models when useful, but broken work cannot win.
- Builder and reviewer models must always differ.
- Prefer the strongest assigned reviewer whose model differs from every
  builder. Keep the reviewer from a different model family when possible.
- For frontend/UI bakeoffs, include the strongest assigned frontend-capable
  builder and choose a different-model reviewer.
- Use the dashboard compare view when product judgment matters.
- Approve only through the normal Ductum approval path after a winner is selected.

Task and attempt work:

```bash
ductum task list <spec-ref>
ductum task assign <task-id> <agent-name>
ductum attempt start <task-id> --agent <agent-name> --project <project>
ductum watch <run-id>
ductum status <run-id>
```

Approval loop:

```bash
ductum approve <run-id>
ductum deny <run-id> --reason "<reason>"
ductum retry <run-id>
ductum cancel <run-id>
```

Stalled attempt recovery:

```bash
ductum status
ductum watch --once
ductum status <full-attempt-id>
ductum logs <full-attempt-id> --limit 80
```

- Do not retry a stalled Attempt blindly.
- Use `ductum watch --once` when `ductum status` reports stalled or failed
  work; it lists every Needs Attention item with the full retry target.
- `ductum status` may also show past stalled Attempts as history. Only rows in
  Needs Attention are current repair targets.
- Inspect `ductum status <full-attempt-id>` and
  `ductum logs <full-attempt-id> --limit 80` before retrying.
- If logs show a dirty target worktree, partial edits, missing credentials, or
  verification/environment failure, stop and report the exact blocker instead
  of retrying over it.
- Restart-created stalls are expected when a harness session cannot reattach;
  treat them as operator recovery, not as proof the implementation failed.
- Copy and use full Attempt IDs in commands. Abbreviated IDs in labels are for
  display only.

Factory settings:

```bash
ductum factory settings
```

## Model/Agent Rules

- Use Factory Settings to discover the local Agent names, models, harnesses,
  and credentials. Do not hardcode another operator's agent aliases.
- Prefer the strongest assigned builder for high-risk or UI-heavy work.
- Prefer a strong reviewer for important reviews.
- Builder and reviewer must be different models.
- Do not use deprecated or unroutable models. Check Factory Settings/model
  catalog when unsure.

## Safety Rules

- Do not start implementation until a spec/task exists.
- Do not bypass the contract gate with `--waive-contract` unless the user explicitly accepts the gap.
- Do not manually merge worktree branches. Use Ductum approval commands.
- Do not claim a run is complete until `ductum watch`/`ductum status` shows the current state.
- When a command fails, report the exact failure and the next CLI command to recover.
