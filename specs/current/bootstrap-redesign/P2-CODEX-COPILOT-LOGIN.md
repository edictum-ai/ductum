# P2 — Codex + GitHub Copilot Login (inside `ductum init`)

## Problem

D130 detects credentials for Codex (via `OPENAI_API_KEY`) and Copilot
(via `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` / `gh auth
status` / `~/.config/gh/hosts.yml`). Detection is not acquisition. End
users without those credentials still have to know to run `gh auth
login`, get a Copilot-scope token, paste an OPENAI key from the OpenAI
dashboard, etc.

This stage extends `ductum init` to *acquire* those credentials in
the TUI, matching how the Anthropic step (P1) acquires Claude
subscription auth.

## Scope

CLI only. Touches:

- `packages/cli/src/init/steps/auth-codex.ts` (new) — TUI step.
- `packages/cli/src/init/steps/auth-copilot.ts` (new) — TUI step.
- `packages/cli/src/login/codex.ts` (new) — Codex login logic.
- `packages/cli/src/login/copilot.ts` (new) — Copilot OAuth logic.
- `packages/cli/src/init/steps/agent-pickers.ts` (new) — TUI step
  that follows Anthropic/Codex/Copilot acquisition and asks which
  agent roles the operator wants enabled by default.
- `ductum.yaml` scaffolder updates: writes Codex / Copilot agent
  entries when those auth paths succeed.

Does **not** add:

- AWS Bedrock / Google Vertex auth (D130 non-goal, kept).
- Token rotation / refresh handling (D130 non-goal, kept).
- Browser handoff to dashboard (P3).

## Behavior Contract

### 2.1 Codex login step

Codex (the OpenAI CLI / SDK we already integrate with) supports both
API key and subscription paths. P2 implements:

1. **Detect existing.** `resolveProviders()` for `openai`. If
   `OPENAI_API_KEY` is set, skip and proceed.
2. **Prompt: "Sign in to OpenAI now?"** Default skippable since
   subscription users may not need OpenAI at all. y/N, default N.
3. **If yes:** present three sub-options:
   - "Paste API key" — input field, validates against
     `https://api.openai.com/v1/models` with the pasted key, saves
     to `.env.local` (mode 0600) as `OPENAI_API_KEY=...`.
   - "Subscription login (Codex)" — open
     `https://chatgpt.com/codex` (or whatever the current Codex CLI
     uses), wait for callback, store the token. **Verify the exact
     URL and callback shape against the codex-cli upstream before
     implementing.** Record what's verified as a decision in this
     PR.
   - "Skip — I'll do this later" — no-op.
4. **Confirm.** On success, scaffolder writes a Codex agent entry.

### 2.2 Copilot OAuth step

Copilot uses GitHub OAuth + a Copilot-scoped token. P2 implements:

1. **Detect existing.** Reuse D130's `resolveProviders()` for
   `github-copilot`. If detected (env or `gh auth status` or
   hosts.yml), skip.
2. **Prompt: "Enable GitHub Copilot agent?"** default N.
3. **If yes:** the TUI prefers `gh auth login` if `gh` is on PATH
   (call out to it via `child_process.spawn` with stdio inherited),
   otherwise walk a device-code OAuth flow against the GitHub
   `device/code` endpoint with scope `read:user`. Verify scope
   strings against current GitHub Copilot docs at implementation
   time; do not infer from D130.
4. **Confirm.** On success, scaffolder writes a Copilot agent entry.
   Token is stored in `.env.local` as `COPILOT_GITHUB_TOKEN=...`
   (matches D130's preferred precedence).

### 2.3 Agent-pickers step (new in P2)

Follows the auth steps. Asks: "Which agents should be enabled by
default?" multi-select over the providers that just authenticated
successfully. Selected providers get an agent entry written to
`ductum.yaml`. Unselected ones don't. The operator can always edit
later; the TUI does not gate.

### 2.4 D135 contract conformance

- **Envelope:** new event kinds `init.auth_codex_started`,
  `init.auth_codex_completed`, `init.auth_codex_skipped`,
  `init.auth_copilot_started`, `init.auth_copilot_completed`,
  `init.auth_copilot_skipped`, `init.agents_selected`.
- **Structured errors:** new codes `auth_codex_failed`,
  `auth_codex_invalid_key`, `auth_copilot_failed`,
  `auth_copilot_gh_not_installed`,
  `auth_copilot_device_code_timeout`. Suggested actions per code.
- **Cost field:** N/A.
- **Cancel/SIGINT:** any mid-OAuth Ctrl-C closes the local callback
  listener, does not write any partial credentials to disk.

### 2.5 Credential storage

- Anthropic: `~/.claude/.credentials.json` (D132 location, unchanged).
- OpenAI: `.env.local` line `OPENAI_API_KEY=...` (mode 0600).
- Copilot: `.env.local` line `COPILOT_GITHUB_TOKEN=...` (mode 0600).
  If `gh auth login` was used, leave the token where `gh` placed it
  (`~/.config/gh/hosts.yml`); don't duplicate.

The TUI prints exactly where each credential was written and the
revoke/regenerate URL for each provider.

### 2.6 File-size budget

Each new step ≤120 LOC. `login/codex.ts` and `login/copilot.ts`
≤200 LOC each; split if larger. No new grandfather entries.

## Verification

- New tests for each step covering: detected-existing, declined,
  successful (mocked HTTP), timeout, gh-not-installed, SIGINT.
- Existing tests stay green: `validate-env.test.ts`,
  `login-command.test.ts`, `bootstrap-support.test.mjs`.
- `pnpm --filter @ductum/cli test` green.
- `pnpm test:scripts` green.
- `pnpm build` green.
- File-size gate green.

## Exit Demo

Recorded as evidence in `evidence/p2-codex-copilot-demo.txt`.

On a machine with no `OPENAI_API_KEY`, no `gh` config, no
`COPILOT_*`:

```sh
node /path/to/ductum/packages/cli/dist/index.js init
# Through P0/P1 steps unchanged.
# Codex step: choose "paste API key", paste real key, key validated
# Copilot step: choose "device-code OAuth", complete in browser
# Agent-pickers: select all 3 → claude-builder, codex-builder, copilot-builder
cat ~/ductum/factory/.env.local
# Lines for OPENAI_API_KEY, COPILOT_GITHUB_TOKEN (mode 0600)
cat ~/ductum/factory/ductum.yaml
# `agents:` lists 3 entries
node /path/to/ductum/packages/cli/dist/index.js init   # second run
# All 3 detected; no re-prompt; TUI says "Detected: anthropic, openai, github-copilot"
```

## Drift Handling

- Codex CLI upstream changes the subscription URL or callback shape
  → record verified URL/shape as a decision before merging.
- GitHub changes Copilot scope strings → record verified scope as a
  decision before merging.
- A provider rate-limits the token-introspection check we use to
  validate pasted keys → drop the validation rather than silently
  accept invalid keys (better to fail-fast at first run than store
  garbage).

## Slop Review

- Attack any commit that hard-codes a Codex URL without verifying
  against current codex-cli upstream and recording the verification
  as a decision.
- Attack any commit that hard-codes Copilot scope strings without
  the same evidence trail.
- Attack any flow that writes a token to disk before validating
  it against the provider's API.
- Attack any flow that doesn't print "where I stored your token,
  how to revoke" after success — this is a D130 explicit requirement.
- Attack any flow that auto-enables agents the operator didn't
  pick. Selection is in the agent-pickers step.
- Attack any commit that touches the Claude path D132 already
  established. P1's path is canonical for Anthropic.
