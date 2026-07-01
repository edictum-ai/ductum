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

The installed CLI auto-detects the default local API URL and local Factory
operator token. You should not need to prefix commands with
`DUCTUM_OPERATOR_TOKEN=...` for normal local factories. For a non-default local
API or a remote API, set CLI defaults once:

```bash
ductum config api-url set http://127.0.0.1:4100
ductum config token set --stdin
ductum config show
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

Local dashboards should not require copying the factory operator token. On a
loopback API, Settings → Dashboard session can reconnect by setting an HttpOnly
browser session from the local API. The cookie value is an opaque server-side
session id, not the factory operator token, and logout revokes that browser
session. If a one-time welcome link expires, run `ductum dashboard pair` for a
fresh browser link. Local reconnect accepts only loopback, same-origin browser
requests; do not expose `/api/internal/*` through a public reverse proxy. Do not
pass operator tokens in URL query strings; use `ductum config token set`,
`Authorization: Bearer`, or `x-ductum-operator-token`.

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

The dashboard Project page leads with who the Project is for and why it exists,
then shows repository scope, settings, specs, and attempt history. Set
`purpose` and `audience` in Project settings when the default repository-derived
text is not specific enough.

## Factory Settings

```bash
ductum factory settings
ductum repair
```

Factory Settings own Providers, Models, Harnesses, Workflows, Agents,
sandboxes, notifications, budgets, and app settings. Secret-bearing settings
must use `${ENV_VAR}` references or `secret:<id>` Factory Secret references.
Claude Agent SDK attempts run with Ductum-managed settings only: user/project
Claude settings and default Claude skills are disabled, so do not rely on
`~/.claude/settings.json` MCP servers or provider overrides for dispatched
work.

Agent attempts must not publish branches, open/edit/merge PRs, or mutate issues
with shell commands such as `git push`, `gh pr create`, or `gh issue comment`.
Finish with `ductum_complete`; Ductum performs remote GitHub lifecycle writes
through the configured repository GitHub App auth path.

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

`ductum watch --once` is the source of truth for current operator action. The
dashboard Home, Factory Activity, Projects, and command palette use the same
operator brief queue for failed or stalled action-needed work; historical failed
or stalled attempts remain visible as history, but they are not current retry
targets unless they appear in the operator brief.

Dashboard Project and Spec pages show a derived spec brief before task and
attempt history. GitHub issue intake uses the structured objective,
requirements, acceptance criteria, verification commands, and issue link when
available; plain Markdown specs fall back to the first useful non-redacted
paragraph. The full source document stays collapsed by default on the Spec page.
