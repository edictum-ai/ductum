<p align="center">
  <img src="docs/brand/ductum-mark.svg" alt="Ductum fork mark" width="96" height="96">
</p>

<h1 align="center">Ductum</h1>

<p align="center">
  <strong>Conduct the work across agents.</strong><br>
  Orchestration for AI agent fleets.
</p>

Ductum is a local-first agent factory for software work. It dispatches work to
agents, tracks attempts and evidence, and keeps approval, CI, and GitHub
lifecycle decisions tied to the exact commit that was verified.

## Status

Ductum is in active development. It is useful for local dogfooding and for
teams that want to experiment with governed agent workflows, but the surface is
still changing. Expect rough edges, especially around setup, UI polish, and
provider-specific harness behavior.

## Why Ductum Exists

Agents can write code quickly. The hard part is keeping the surrounding process
honest:

- Did the agent read the required context before editing?
- Which repository, branch, commit, and task did this attempt belong to?
- What tests or checks actually ran?
- Was the result reviewed?
- Did the pull request match the commit that was verified?
- Were required checks green for that exact commit?
- Who approved the risky transition?
- What evidence proves the work is done?

Ductum records those transitions in a local factory database and exposes them
through a CLI, API, dashboard, and per-run MCP tools.

## What It Does

- Tracks Projects, Repositories, Specs, Tasks, Attempts, Agents, Factory
  Settings, evidence, approvals, and repair items.
- Runs agent attempts in isolated git worktrees.
- Enforces workflow stages such as read-before-edit, implementation,
  verification, review, ship, and approval.
- Captures run activity, tool decisions, evidence, verification output, and
  completion summaries.
- Supports local operator approval, denial, retry, cancellation, pause, and
  cleanup flows.
- Uses repository-scoped GitHub App auth for issue intake, PR creation, PR
  updates, and merge lifecycle writes when configured.
- Keeps agent shell commands separate from the GitHub write path.
- Provides a dashboard for activity, projects, specs, runs, settings, repair,
  and operational health.

## Core Concepts

**Factory**

The local Ductum control plane. It stores state in SQLite under the factory data
directory, usually `~/.ductum/factories/default`.

**Project**

A named workspace that owns one or more repositories, agent assignments, specs,
and attempts.

**Repository**

A git repository Ductum can dispatch work against. Repositories can be local-only
or connected to GitHub.

**Spec**

A bundle of task prompts. Specs can come from Markdown spec packages or GitHub
issue intake.

**Task**

One dispatchable unit of work from a spec.

**Attempt**

One execution of one task by one agent in a tracked worktree.

**Evidence**

Structured records attached to a run: tests, lint, review, CI observations,
merge state, operator decisions, and other proof.

**Approval**

An operator-controlled transition. Approval is separate from the agent's
completion text and from the GitHub actor that performs remote writes.

## Install

Homebrew is the primary install path:

```sh
brew tap edictum-ai/edictum
brew install ductum
ductum init --no-login --no-browser
ductum start --no-browser
ductum status
```

By default, `ductum init` creates a local factory under
`~/.ductum/factories/default`. `ductum start` starts the local API and dashboard
for that factory.

For non-default local API settings, see
[docs/CLI_ONBOARDING.md](docs/CLI_ONBOARDING.md).

The dashboard uses a local browser session for loopback factories. Do not put
operator tokens in URLs, committed files, issues, specs, prompts, screenshots, or
logs.

## Quick Start

Create or register a project:

```sh
ductum project create my-project --repo /absolute/path/to/repo --merge-mode human
ductum project agent assign my-project <agent-name> --role builder
ductum project agent assign my-project <reviewer-name> --role reviewer
ductum status
```

Import work:

```sh
ductum spec intake my-project /absolute/path/to/spec-package --import
ductum spec list my-project
ductum task list <spec-id>
```

Start an attempt:

```sh
ductum attempt start <task> --agent <agent-name> --project my-project
ductum watch <attempt-id>
ductum logs <attempt-id>
ductum status <attempt-id>
```

Operate the result:

```sh
ductum approve <attempt-id>
ductum deny <attempt-id> --reason "Needs a smaller patch"
ductum retry <attempt-id>
ductum cancel <attempt-id>
```

Use `ductum watch --once` for the current operator queue:

```sh
ductum watch --once
```

## GitHub Flow

Ductum can import GitHub issues and create/update pull requests when a
repository is configured with GitHub App installation auth.

The intended flow is:

1. Import or create a task.
2. Run an agent attempt in a Ductum worktree.
3. Record verification and review evidence.
4. Create or update the linked PR through Ductum.
5. Check that the PR head SHA matches the verified attempt commit.
6. Wait for required checks for that exact SHA to pass.
7. Approve through Ductum.
8. Merge through the configured GitHub App path.
9. Record final merged state and merge commit evidence.

PR creation alone is not a done signal. Pending, failing, cancelled, stale, or
missing checks should keep work active or send it back through repair.

Agents should not publish branches, open pull requests, edit issues, or merge
pull requests from their shell. Those remote writes belong to the Ductum
lifecycle path.

## Dashboard

The local dashboard includes:

- Factory Activity: current approvals, active attempts, ready tasks, and work
  needing operator attention.
- Projects: repository scope, specs, settings, and attempt history.
- Specs and Tasks: imported work, task DAGs, dispatch state, and attempt links.
- Run Detail: transcript, evidence, gates, diffs, review status, and operator
  actions.
- Settings: providers, models, harnesses, workflows, agents, budgets, and
  runtime configuration.
- Ops Health: process status, dispatcher status, database state, worktree
  inventory, recent audit events, and guarded cleanup.

Local dev dashboard defaults to `http://127.0.0.1:5176`. Installed/local factory
startup may also serve the built dashboard from the API port depending on how it
is started.

## Development

Source checkouts use pnpm:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Run the local development stack:

```sh
pnpm dev
```

Useful scripts:

```sh
pnpm lint
pnpm test:integration
pnpm audit:deps
pnpm build:publish-package
pnpm build:homebrew-artifact
```

The monorepo packages are:

- `packages/core` - durable model, repos, dispatcher, enforcement, workflow
  runtime, and post-completion routing.
- `packages/api` - Hono API, GitHub lifecycle integration, dashboard API, and
  local server entrypoint.
- `packages/cli` - `ductum` command line interface.
- `packages/dashboard` - React dashboard.
- `packages/harness` - agent harness adapters.
- `packages/mcp` - per-run Ductum MCP server.
- `packages/ductum` - publishable package wrapper.

## Security Notes

Ductum is designed to keep operator authority separate from agent execution:

- Agent attempts run in tracked worktrees.
- Workflow gates are evaluated by Ductum, not by agent self-report.
- Secret-bearing settings should use local environment references or factory
  secret references, not literal secret values in committed config.
- Operator tokens, provider credentials, private keys, and installation tokens
  must stay out of git, prompts, specs, issues, screenshots, and logs.
- GitHub write operations should use repository-scoped GitHub App auth when
  configured.
- Dependency versions are exact-pinned and CI uses a frozen lockfile.
- Dependency postinstall scripts are disabled by default, with only explicitly
  trusted native packages rebuilt.
- GitHub Actions are pinned by commit SHA.

See [SECURITY.md](SECURITY.md) for the supply-chain policy.

## Current Limits

- The setup flow is still being hardened.
- The dashboard is being actively refined.
- Provider and model support depends on local factory settings and available
  harness adapters.
- Windows is not currently a first-class target.
- Remote and multi-machine execution paths are design goals, not the default
  local path.

## More Documentation

- [docs/SETUP.md](docs/SETUP.md) - detailed local and source setup.
- [docs/CLI_ONBOARDING.md](docs/CLI_ONBOARDING.md) - operator CLI workflow.
- [docs/DOCKER.md](docs/DOCKER.md) - Docker development and runtime image notes.
- [docs/EXECUTION_INTEGRITY_READINESS.md](docs/EXECUTION_INTEGRITY_READINESS.md)
  - integrity checks before trusting a run outcome.
- [design/README.md](design/README.md) - target architecture and design
  direction.

## License

See [LICENSE](LICENSE).
