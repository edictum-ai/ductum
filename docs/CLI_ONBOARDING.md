# CLI Onboarding

This is the supported no-curl path for a Ductum operator.

## Normal Path

For product installs, use Homebrew first:

```bash
brew tap edictum-ai/edictum
brew install ductum
ductum init --no-login --no-browser
ductum start --no-browser
ductum project create ductum --repo "$PWD" --merge-mode human
ductum project agent assign ductum <agentName> --role builder
ductum repair
ductum status
```

For source checkouts:

```bash
pnpm install --frozen-lockfile
pnpm build

alias ductum="node $PWD/packages/cli/dist/index.js"
ductum init --no-login --no-browser
ductum start --no-browser
ductum project create ductum --repo "$PWD" --merge-mode human
ductum project agent assign ductum <agentName> --role builder
ductum repair
ductum status
```

If `repair` reports missing Factory Settings, fix those settings through the
normal setup path and rerun `ductum repair`. Do not edit live DB state.

## Project And Repository

```bash
ductum project create ductum --repo "$PWD" --merge-mode human
ductum project agent assign ductum <agentName> --role builder
ductum repository list ductum
ductum repository add ductum --repo /absolute/path/to/another/git/repo
ductum status
```

`--repo` must point at an existing Git repository.

## Factory Settings

```bash
ductum factory settings
ductum repair
```

Factory Settings own Providers, Models, Harnesses, Workflows, Agents,
sandboxes, notifications, budgets, and app settings. Secret-bearing settings
must use `${ENV_VAR}` references.

## Specs, Tasks, Attempts

```bash
ductum spec intake ductum specs/examples/cli-onboarding-smoke.yaml --import
ductum spec list ductum
ductum task list <specId>
ductum task dag <specId>
ductum status
ductum attempt start <taskId> --agent <agentName> --project ductum
ductum watch <attemptId>
ductum logs <attemptId>
ductum status <attemptId>
```

Approve, deny, or retry:

```bash
ductum approve <attemptId>
ductum deny <attemptId> --reason "Needs a smaller patch"
ductum retry <attemptId>
```

Repair is the first stop when work does not start:

```bash
ductum repair
ductum status
```
