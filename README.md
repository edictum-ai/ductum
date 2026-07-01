# Ductum

Ductum is a local-first factory control plane for agentic software work. It
tracks Projects, Repositories, Specs, Tasks, Attempts, Factory Settings, and
Repair items so agent work can be assigned, audited, approved, retried, and
closed without losing the operator trail.

The product wedge is governed execution for real agent work: read before edit,
verify before remote publication, approval before risky transitions, GitHub App
lifecycle writes instead of agent shell pushes, and no done state before
required evidence is present.

## Install

Homebrew is the primary install path:

```sh
brew tap edictum-ai/edictum
brew install ductum
ductum init --no-browser --no-login
ductum start --no-browser
ductum status
```

By default, `ductum init` creates the local factory under
`~/.ductum/factories/default`, and `ductum start` uses that external Factory
data directory unless you pass `--dir`.

The installed CLI auto-discovers the default local API URL and operator token
from local Factory state. For non-default or remote APIs, store CLI defaults
once:

```sh
ductum config api-url set http://127.0.0.1:4100
ductum config token set --stdin
```

For local loopback factories, the dashboard reconnects with an HttpOnly browser
session from the local API. That cookie is an opaque, revocable browser session,
not the factory operator token. The reconnect endpoints accept only loopback,
same-origin browser requests; do not expose `/api/internal/*` through a public
reverse proxy. Normal local use should not require copying the factory operator
token; if a welcome link expires, run `ductum dashboard pair` or reconnect from
Settings. Do not put operator tokens in URLs; use `ductum config token set`,
`Authorization: Bearer`, or `x-ductum-operator-token` for scripted calls.

The generated Homebrew formula installs Ductum under `libexec`, depends on
`node@24`, and exposes the `ductum` wrapper on `PATH`. npm remains a secondary
install path while Homebrew distribution is hardened:

```sh
npm install -g ductum
```

## Development Setup

Source checkouts still use pnpm:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Use `pnpm build:homebrew-artifact` to build a platform-specific Homebrew
release tarball and generated `Formula/ductum.rb` outside the repository
checkout.

## Operator Flow

```sh
ductum project create my-project --repo /absolute/path/to/repo --merge-mode human
ductum project agent assign my-project <agentName> --role builder
ductum spec intake my-project /path/to/spec --import
ductum attempt start <taskId> --agent <agentName> --project my-project
ductum watch <attemptId>
```

Approve, deny, retry, or cancel through the Ductum CLI so the audit trail stays
inside the factory.

Fresh Anthropic factory defaults use Claude Sonnet 5 for the builder and Claude
Opus 4.8 for review. Model pricing is registry-derived: Sonnet 5 uses
Anthropic introductory rates through August 31, 2026 and standard rates from
September 1, 2026. Codex and Claude cost scanners price logs by usage
timestamp, and `unpriced`/`unmeasured` usage is surfaced explicitly instead of
being treated as free `$0` spend.
