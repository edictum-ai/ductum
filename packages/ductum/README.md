# Ductum

> [!WARNING]
> **Retired and unsupported.** Do not install this package for new use. The
> published `ductum` releases are preserved only as historical artifacts, and
> a successor is not yet public.

Ductum is a local-first factory control plane for agentic software work. It
tracks Projects, Repositories, Components, Specs, Tasks, Attempts, Factory
Settings, and Repair items so agent work can be assigned, audited, approved,
retried, and closed without losing the operator trail.

The current wedge is governed execution for real agent work: read before edit,
verify before remote publication, approval before risky transitions, GitHub App
lifecycle writes instead of agent shell pushes, and no done state before
required evidence is present. Ductum coordinates the work; Edictum enforces the
process boundaries.

## Historical installation record

There is no supported installation path. Remove an existing installation with
the applicable command:

```sh
brew uninstall ductum
npm uninstall -g ductum
```

## Quick Start

Create a factory and start or reopen the local control plane:

```sh
ductum init --no-login --no-browser
ductum start --no-browser
```

Check readiness and the next operator action:

```sh
ductum repair
ductum status
```

Attach a repository to a Project:

```sh
ductum project create my-project --repo /absolute/path/to/repo --merge-mode human
ductum repository list my-project
```

Import work and start an Attempt:

```sh
ductum spec intake my-project path/to/spec-or-directory --import
ductum status
ductum attempt start <taskId> --agent <agentName> --project my-project
ductum watch <attemptId>
```

When an Attempt reaches an operator decision:

```sh
ductum approve <attemptId>
ductum deny <attemptId> --reason "Needs a smaller patch"
ductum retry <attemptId>
```

## Operator Model

- Factory: the local control plane.
- Project: the daily product or system boundary.
- Repository: a local Git checkout attached to a Project.
- Component: optional subdirectory scope inside a Repository.
- Spec: an operator work request.
- Task: a concrete repository-scoped unit of work.
- Attempt: one execution try for a Task.
- Factory Settings: Providers, Models, Harnesses, Workflows, Agents, sandboxes,
  notifications, budgets, and app settings.
- Repair: actionable readiness and recovery blockers.

`ductum watch --once` and the dashboard's operator brief agree on current
operator action. Failed or stalled history is still shown for context, but only
operator-brief rows are labeled as current action-needed work.

The dashboard Ops Health page shows process and dispatcher status, database
schema state, worktree inventory, recent audit events, and guarded
inactive-worktree cleanup. Cleanup requires explicit operator confirmation and
records an audit event.

Project pages lead with who the Project is for and why it exists. Use Project
settings to store the Project purpose and audience when the repository-derived
fallback is too generic. Spec cards and Spec pages show the work brief before
Tasks and Attempts, then summarize what happened, tracked spend, missing
usage/pricing, and the next operator action. GitHub issue intake uses the issue
objective and structured fields; plain Markdown specs use the first useful
non-redacted paragraph, with the full source document collapsed by default.

## Configuration And Secrets

Inspect Factory Settings and use Repair for missing setup:

```sh
ductum factory settings
ductum repair
```

Literal secrets do not belong in config files, logs, evidence, exports, or
public JSON. Use environment-variable references such as `${ANTHROPIC_API_KEY}`
or Factory Secret references such as `secret:<id>` for provider credentials and
notification settings.

Claude Agent SDK attempts are isolated from Claude filesystem settings. Ductum
does not load user/project/local Claude settings or default Claude skills for
dispatched work, and the harness registers only Ductum's per-run MCP server.
Put provider credentials and custom endpoints in Factory Settings instead.

Fresh Anthropic factory defaults use Claude Sonnet 5 for the builder and Claude
Opus 4.8 for review. Model pricing is registry-derived: Sonnet 5 uses
Anthropic introductory rates through August 31, 2026 and standard rates from
September 1, 2026. Codex and Claude cost scanners price logs by usage
timestamp, and `unpriced`/`unmeasured` usage is surfaced explicitly instead of
being treated as free `$0` spend.

## What Ships

The npm package includes:

- the `ductum` CLI
- the local API server runtime
- dashboard static assets
- workflow templates
- sample specs used by the bootstrap demo

Source and issue tracker: https://github.com/edictum-ai/ductum
