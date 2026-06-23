# Ductum

Ductum is a local-first factory control plane for agentic software work. It
tracks Projects, Repositories, Components, Specs, Tasks, Attempts, Factory
Settings, and Repair items so agent work can be assigned, audited, approved,
retried, and closed without losing the operator trail.

The current wedge is governed execution for real agent work: read before edit,
verify before push, approval before risky transitions, no push to protected
branches, and no done state before required evidence is present. Ductum
coordinates the work; Edictum enforces the process boundaries.

## Install

```sh
npm install -g ductum
```

Requirements:

- Node.js 22+
- Git
- Provider auth for the agents you enable. `ductum init` handles the normal
  local setup path; `ductum repair` reports missing provider or Agent readiness.

Ductum uses `better-sqlite3` for the local factory database. A normal npm
install builds or fetches that native binding. Installing with lifecycle scripts
disabled can leave the API unable to start.

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
ductum spec intake my-project path/to/spec.yaml --import
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

## Configuration And Secrets

Inspect Factory Settings and use Repair for missing setup:

```sh
ductum factory settings
ductum repair
```

Literal secrets do not belong in config files, logs, evidence, exports, or
public JSON. Use environment-variable references such as `${ANTHROPIC_API_KEY}`
for provider credentials and notification settings.

## What Ships

The npm package includes:

- the `ductum` CLI
- the local API server runtime
- dashboard static assets
- workflow templates
- sample specs used by the bootstrap demo

Source and issue tracker: https://github.com/edictum-ai/ductum
