# P6: CLI

**Scope:** Command-line interface for admin and agent operations
**Package:** `packages/cli`
**Depends on:** P4 (REST API)
**Deliverable:** `ductum` CLI with admin commands, agent commands, and status monitoring
**Verification:** `cd packages/cli && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §8 (MCP Tool Surface — CLI mirrors these for agent commands)
- `decisions/001-founding-session.md` §D7 (MCP + CLI are thin clients of same REST API)
- `ARCHITECTURE.md` §Agent work modes (push mode vs pull mode)

## Tasks

### 1. Scaffold CLI package

- `packages/cli/package.json` with dependency: `commander`
- `packages/cli/tsconfig.json` extending base
- Workspace dependency on `@ductum/core` (for types)
- `bin` field pointing to compiled entrypoint

### 2. API client (reuse from MCP)

Import or copy the `DuctumApiClient` from `packages/mcp/src/api-client.ts`. If shared, extract to `packages/core/src/api-client.ts` and import from both packages.

### 3. Admin commands

File: `packages/cli/src/commands/admin.ts`

```
ductum init                         # Initialize factory (creates DB, default config)
ductum project list                 # List projects
ductum project create <name>        # Create project
ductum project show <name>          # Show project detail
ductum project delete <name>        # Delete project
ductum agent list                   # List agents
ductum agent register <name>        # Register agent (interactive: model, harness, capabilities)
ductum agent show <name>            # Show agent detail
ductum agent delete <name>          # Delete agent
ductum assign <agent> <project> <role>  # Assign agent to project with role
ductum spec list <project>          # List specs for project
ductum spec create <project> <name> # Create spec
ductum spec approve <spec-id>       # Approve spec for implementation
ductum task list <spec-id>          # List tasks for spec
ductum task create <spec-id> <name> # Create task (reads prompt from stdin or --file)
ductum task depend <task> <depends-on>  # Add task dependency
ductum task dag <spec-id>           # Show task DAG (ASCII visualization)
```

### 4. Agent commands (mirror MCP tools)

File: `packages/cli/src/commands/agent-ops.ts`

```
ductum next-task [--project <name>] [--role <role>]   # Get next unblocked task
ductum accept <task-id>                                # Claim task, start run
ductum complete <run-id> --result <msg> [--pr <url>]   # Complete run
ductum update <run-id> --message <msg>                 # Report progress
ductum heartbeat <run-id>                              # Send heartbeat
ductum decide <run-id> --decision <text> --context <text> [--alt <text>...]  # Record decision
ductum gate-check <run-id> --stage <target>            # Request stage transition
ductum wait <run-id> --for <ci|review|approval> [--timeout <seconds>]  # Enter wait
ductum fail <run-id> --reason <text> [--recoverable]   # Report failure
ductum evidence <run-id> --type <type> --payload <json> # Attach evidence
ductum link <run-id> [--branch <b>] [--commit <c>] [--pr <url>]  # Link git artifacts
ductum context <task-id>                                # Get crash recovery context
```

### 5. Status commands

File: `packages/cli/src/commands/status.ts`

```
ductum status                    # Overview: active runs, ready tasks, stalled runs
ductum status <run-id>           # Run detail: stage, evidence, git artifacts, cost
ductum runs [--active|--stalled|--done]  # List runs by status
ductum history <run-id>          # Stage transition history
ductum decisions [--spec <id>] [--task <id>] [--run <id>]  # List decisions
ductum cost [--project <name>] [--agent <name>]  # Cost summary
```

### 6. CLI entrypoint

File: `packages/cli/src/index.ts`

- Parse global option: `--api-url` (default `http://localhost:4100`)
- Register all command groups
- Error handling: display error message and exit code

### 7. Output formatting

File: `packages/cli/src/format.ts`

- Table output for lists (aligned columns)
- JSON output with `--json` flag on any command
- Color-coded status badges (green=done, yellow=active, red=failed, gray=blocked)
- DAG visualization as ASCII tree

### 8. Tests

File: `packages/cli/src/tests/commands.test.ts`

Mock API client. Test:
- `init` creates factory
- `project create` / `list` / `show` / `delete`
- `agent register` / `list`
- `accept` -> returns run ID
- `gate-check` -> shows allowed/blocked
- `status` -> shows overview
- `task dag` -> renders ASCII DAG
- `--json` flag outputs valid JSON
- Missing required args show usage help
- API errors display cleanly

## Verification Checklist

- [ ] `pnpm test` in packages/cli — all pass
- [ ] All admin CRUD commands work
- [ ] All agent operation commands mirror MCP tools
- [ ] `ductum status` gives useful overview
- [ ] `ductum task dag` renders readable ASCII DAG
- [ ] `--json` flag works on all commands
- [ ] Error messages are user-friendly
- [ ] `ductum --help` shows all commands
- [ ] CLI binary is executable after build
