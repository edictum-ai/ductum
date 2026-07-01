# Setting up Ductum on a new machine

This is the checklist for bringing up Ductum on a fresh laptop or server. The
normal product install path is Homebrew; source checkout setup is for Ductum
development.

## 0. Product Install: Homebrew

```bash
brew tap edictum-ai/edictum
brew install ductum
ductum init --no-login --no-browser
ductum start --no-browser
ductum status
```

The Homebrew formula depends on `node@24`, installs Ductum under `libexec`, and
exposes `ductum` on `PATH`. Users should not need a Ductum repo checkout, pnpm,
or `node packages/cli/dist/index.js`.

For Ductum source development, continue with the pnpm workflow below.

The source checkout goal: after you finish, `ductum init` has created the
Factory in SQLite, `pnpm serve` starts the factory, the dashboard renders at
http://localhost:5176, and you can dispatch a task against a real project.

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 24+ for Homebrew, 22.0+ for source | Runtime for the API, dashboard, CLI, harnesses, MCP server. |
| **pnpm** | 10.0+ | Source checkout package manager only. npm/yarn won't work for monorepo development. |
| **Git** | 2.35+ | The dispatcher uses `git worktree add` / `git merge --no-ff` / `git rebase`. 2.35+ is needed for the `worktree remove --force` flag path. |
| **Python 3.11+** | 3.11+ | Only for `node-gyp` when rebuilding `better-sqlite3`. Not used at runtime. |
| **A C++ toolchain** | — | `better-sqlite3` is native. macOS: Xcode CLT (`xcode-select --install`). Linux: `build-essential`. Windows: not officially supported. |

### Install the basics (macOS)

```bash
xcode-select --install
brew install node pnpm git python@3.11
```

### Install the basics (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y build-essential git python3 python3-pip
curl -fsSL https://fnm.vercel.app/install | bash  # or use nvm / volta
fnm install 22
npm install -g pnpm@10
```

## 2. Clone Ductum and install

Skip this section for Homebrew installs.

```bash
git clone git@github.com:edictum-ai/ductum.git
cd ductum
pnpm install --frozen-lockfile
```

This installs all workspace dependencies with the lockfile frozen. **Never** use `pnpm install` (without `--frozen-lockfile`) on first install — the lockfile is authoritative.

The repo disables dependency postinstall scripts by default. `pnpm build`
checks the approved `better-sqlite3` native binding and rebuilds it with scripts
enabled only for `@ductum/core` when the binding is missing. If that scoped
rebuild fails, make sure the C++ toolchain is installed and run:

```bash
pnpm --filter @ductum/core --config.ignore-scripts=false rebuild better-sqlite3
```

## 3. Build everything

Skip this section for Homebrew installs.

```bash
pnpm build
```

This checks native dependencies, then runs `tsc` across every package
(`@ductum/core`, `@ductum/api`, `@ductum/cli`, `@ductum/mcp`,
`@ductum/harness`, `@ductum/dashboard`). First build takes ~30s, subsequent
builds are incremental.

Verify the build:

```bash
pnpm test
```

All packages should report green. You should see numbers like `240 passed` (core), `47 passed` (dashboard), `37 passed` (api), etc.

## 4. Environment variables

Ductum can read model-provider credentials from host env or from agent-scoped
Factory Settings secrets. Use host env for simple local setup; use agent-scoped
`secret:<id>` refs when only one agent should receive a credential or custom
endpoint.

```bash
# ~/.zshrc or ~/.bashrc
export ANTHROPIC_API_KEY="sk-ant-..."          # for claude-agent-sdk harness (sonnet, GLM via Z.AI compat)
export CLAUDE_CODE_OAUTH_TOKEN="..."           # alternative to ANTHROPIC_API_KEY (Claude Max)
export ZAI_API_KEY="..."                       # for GLM routed through Anthropic-compatible Z.AI endpoint
export OPENAI_API_KEY="sk-..."                 # not directly needed — Codex SDK auths via ~/.codex/auth.json
```

For GLM through Z.AI's Anthropic-compatible endpoint, prefer scoping the route
to the GLM agent instead of setting Anthropic-compatible env globally:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "secret:<factory-secret-id>"
  }
}
```

`ductum doctor` and attempt-start preflight treat a configured agent-scoped
provider secret as auth for that agent. The secret value is resolved only when
the agent is spawned. Use the Factory Secret id in the `secret:<id>` reference,
not the display name.

Claude Agent SDK runs use SDK isolation mode. Ductum does not load
`~/.claude/settings.json`, project `.claude/settings.json`, local Claude
settings, or default Claude skills for dispatched attempts; the only MCP server
registered by this harness is Ductum's per-run server. Configure provider
routes, credentials, and Ductum tools through Factory Settings instead of
Claude filesystem settings.

For Codex:

```bash
# Log in to Codex once; the SDK reads ~/.codex/auth.json afterward
codex login
```

For GitHub Copilot (future — not in the current harness matrix):

```bash
gh auth login    # Copilot SDK reads gh's token store
```

Optional (tuning):

```bash
export DUCTUM_ACTIVITY_MAX_BYTES=65536         # run_activity content cap (default 64 KB)
export DUCTUM_HEARTBEAT_INTERVAL_MS=30000      # heartbeat frequency (default 30s)
export DUCTUM_REBASE_BASE=main                 # branch to rebase onto pre-verify (empty = disable)
```

## 5. Initialize the Factory (DB-only)

Ductum is DB-only: `ductum init` creates the Factory in SQLite plus a local
`.ductum/secrets.key`. There is no `ductum.yaml`. From the Ductum repo root:

```bash
alias ductum="node $PWD/packages/cli/dist/index.js"
ductum init --no-login --no-browser
```

For Homebrew installs, use `ductum init --no-login --no-browser` directly.

This writes `ductum.db` and `.ductum/secrets.key` into the Factory directory
and creates a generic local Factory (one Project pointing at `.`, the built-in
catalogs, and an agent for each provider you have authenticated). Both the DB
and the key stay out of git by default.

After init, manage Factory Settings — Providers, Models, Harnesses, Workflows,
Agents, sandboxes, notifications, and budgets — through the dashboard or the
typed Settings APIs. To add another Project or Repository, use the CLI:

```bash
ductum project create myproject --repo /absolute/path/to/git/repo --merge-mode human
ductum project agent assign myproject <agentName> --role builder
ductum repository add myproject --repo /absolute/path/to/another/repo
ductum repair list
```

Literal secrets are not valid Factory Settings values; use `${ENV_VAR}`
references or `secret:<id>` Factory Secret references for secret-bearing fields.

### Repository-scoped GitHub App auth (production path)

Local `gh auth` and PAT-based reads/writes are development-only escape hatches.
Production GitHub issue intake, repository reads, PR creation, PR updates, and
merge/write lifecycle operations should use repository-scoped GitHub App
installation auth through `repository.authRef`.

Create the GitHub App credential JSON with placeholders only, then keep it out
of git:

```json
{
  "mode": "github_app",
  "appId": "YOUR_GITHUB_APP_ID",
  "installationId": "YOUR_INSTALLATION_ID",
  "privateKey": "-----BEGIN RSA PRIVATE KEY-----\nYOUR_TEMP_PRIVATE_KEY\n-----END RSA PRIVATE KEY-----\n"
}
```

Safe operator sequence:

```bash
cat >/tmp/github-app.json <<'EOF'
{
  "mode": "github_app",
  "appId": "YOUR_GITHUB_APP_ID",
  "installationId": "YOUR_INSTALLATION_ID",
  "privateKey": "-----BEGIN RSA PRIVATE KEY-----\nYOUR_TEMP_PRIVATE_KEY\n-----END RSA PRIVATE KEY-----\n"
}
EOF

# 1) Create a Project-scoped Factory secret from a file, never from --value.
ductum factory secret create \
  --project myproject \
  --name github-app \
  --value-file /tmp/github-app.json

# 2) Test that the secret can mint an installation token.
ductum factory secret test <secret-id>

# 3) Bind that secret to the Repository used for intake and PR lifecycle work.
ductum repository update myproject my-repository --auth-ref secret:<secret-id>

# 4) Verify the Repository now shows the safe secret reference.
ductum repository list myproject

# 5) Smoke-check read intake through the bound authRef.
ductum issue intake myproject owner/repo#123 --repository my-repository
```

The `repository list` output should show `AUTH REF` as `secret:<secret-id>`.
That same `repository.authRef` is what Ductum uses for production issue reads
and for write paths such as PR comments, PR creation/updates, and merge/close
lifecycle actions. Do not paste App IDs, installation IDs, private keys, or
installation tokens into issues, prompts, specs, or committed files.

Agent shell commands are not the production GitHub lifecycle path. Ductum blocks
remote publication and mutating PR/issue commands such as `git push`,
`gh pr create`, `gh pr merge`, and `gh issue comment` inside dispatched
attempts; agents finish with `ductum_complete`, then Ductum ships through the
bound repository GitHub App auth flow.

Imported GitHub issues also receive an automated Ductum PR-sync comment with
attempt, branch, commit, PR, and verification evidence when Ductum opens or
updates the linked PR through that GitHub App auth flow.

If you created a temporary proof App or temporary private key material for this
smoke test, rotate the key immediately after proof or delete the temporary App.
Remove `/tmp/github-app.json` when finished.

## 6. Start the factory

For Homebrew installs:

```bash
ductum start --no-browser
```

The installed CLI auto-discovers the default local API URL and local Factory
operator token. For non-default or remote APIs, store defaults once instead of
prefixing every command with environment variables:

```bash
ductum config api-url set http://127.0.0.1:4100
ductum config token set --stdin
```

For source checkouts:

```bash
pnpm serve
```

`pnpm serve` is DB-only: it requires an initialized Factory (step 5) and loads
all runtime values from the Factory DB. On first run, Ductum creates
`DUCTUM_OPERATOR_TOKEN`, saves it in `.env.local`, and starts the API with that
token. To choose the token yourself, run
`node scripts/serve.mjs --operator-token prompt`. (`ductum start` is the
equivalent CLI command for a non-repo install.)

or, to run detached:

```bash
nohup node scripts/serve.mjs > /tmp/ductum-serve.log 2>&1 &
disown
```

You should see:

```
Starting Ductum...
[startup] Harness: claude-agent-sdk loaded
[startup] MCP: factory loaded
[startup] Dispatcher: running (1 adapter(s), polling every 10s)
API running on :4100
Dashboard: http://localhost:5176
```

If `pnpm serve` reports "No Factory setup found", run step 5 first.

Open http://localhost:5176 in a browser. Local loopback factories reconnect the
dashboard by setting an HttpOnly browser session from the local API; operators
should not need to find or paste `DUCTUM_OPERATOR_TOKEN` for normal local use.
If a one-time welcome link expires, open Settings and use "Reconnect locally" or
run `ductum dashboard pair` to mint a fresh short-lived browser link. Raw token
detection remains opt-in and is disabled for public API URLs. Local reconnect
accepts only loopback, same-origin browser requests; do not expose
`/api/internal/*` through a public reverse proxy.

### Docker Smoke

For a container-only onboarding check:

```bash
docker compose up --build
```

Compose stores the Factory DB and `.ductum/secrets.key` in the `ductum-data`
Docker volume (`/data`) and lets `scripts/serve.mjs` bootstrap
`DUCTUM_OPERATOR_TOKEN` into `.env.local` on first run. Run `ductum init --dir
/data` once on a fresh volume before serve can start. Use
`DUCTUM_API_HOST_PORT=4210 DUCTUM_DASHBOARD_HOST_PORT=5276 docker compose up
--build` when another local Ductum is already using the default ports.

## 7. Onboard your first real project

If you already have an application you want to dispatch work on, use the `ductum-onboard` skill from Claude Code:

1. Open Claude Code with your target project as the cwd
2. Say: "onboard this project to ductum"
3. The skill detects your stack, reads your existing CLAUDE.md / AGENTS.md / README.md, and creates `.edictum/workflow-profile.yaml`
4. Register the Repository with `ductum repository add <project> --repo <path>` and attach the workflow through Factory Settings
5. Restart the factory (step 6)

See `.claude/skills/ductum-onboard/SKILL.md` in the Ductum repo for what the skill does.

## 8. First dispatch — prove it works

From the Ductum repo:

```bash
node packages/cli/dist/index.js spec intake ductum specs/examples/cli-onboarding-smoke.yaml --import
```

This audits and imports a small CLI smoke spec, then marks the Task ready.
Within ~10 seconds the dispatcher picks it up if a configured agent is
authenticated. Watch it progress through understand -> implement -> review ->
ship.

If the first dispatch works, you're done. If it doesn't, check:

- **Server logs**: `tail -100 /tmp/ductum-serve.log`
- **Health**: `curl http://localhost:4100/api/health` should return `{"ok":true}`
- **Agents loaded**: `curl http://localhost:4100/api/agents | jq` should show your configured agents
- **Worktree creation**: the dispatcher creates a fresh worktree in `.ductum/worktrees/<project>/<short-id>/` — if that fails, git is misconfigured

## 9. Common first-run problems

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm build` fails rebuilding `better-sqlite3` | Missing C++ toolchain | Install Xcode CLT (macOS) or `build-essential` (Linux), retry with `pnpm --filter @ductum/core --config.ignore-scripts=false rebuild better-sqlite3` |
| Server starts but `claude-agent-sdk` harness missing | `ANTHROPIC_API_KEY` not in env | `export ANTHROPIC_API_KEY=...`, then restart the Ductum API |
| Dispatch creates a run but it hangs at `understand` | Required files in workflow profile don't exist in the target project | Edit `.edictum/workflow-profile.yaml` — set `required_files` to files that actually exist (README.md at minimum) |
| Runs get killed by budget immediately | `perSpecHardUsd` is too low for your model | Raise the Factory cost budget through the dashboard or the typed Settings API |
| Verify always fails | Your verify commands don't run cleanly in a fresh worktree | SSH into the worktree (`.ductum/worktrees/<project>/<short-id>/`) and run them manually to reproduce |
| Worktree verification resolves packages from the main checkout | Older dependency links point back to the source checkout | Run `pnpm native:deps` in the worktree; it repairs source-checkout `node_modules` links and keeps `@ductum/*` workspace packages local to the worktree |

## 10. Next reads

- `README.md` — full config reference and CLI commands
- `.claude/skills/ductum-onboard/SKILL.md` — how onboarding new projects works
- `.claude/handover.md` — the latest session handover (what's in flight, what's next)
- `packages/core/src/enforce.ts` — how Edictum workflow stages are actually enforced
