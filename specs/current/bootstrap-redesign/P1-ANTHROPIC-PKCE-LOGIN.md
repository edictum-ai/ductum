# P1 — Anthropic PKCE Login (inside `ductum init`)

## Problem

D132 ships a working Anthropic PKCE flow as `ductum login`, writing
`~/.claude/.credentials.json`. It works in isolation. But end users
running `ductum init` for the first time still have to know to *also*
run `ductum login` afterward. The TUI should walk Claude subscription
auth as part of the init flow — single command, no env vars, no
follow-up.

This is the slice D130 deferred and D132 explicitly left as a "wizard"
follow-up.

## Scope

CLI only. Touches:

- `packages/cli/src/init/steps/auth-anthropic.ts` (new) — TUI step.
- `packages/cli/src/login/` (existing) — refactor: extract the PKCE
  core out of the standalone `login` command into a reusable function
  that `ductum init` can call directly. **Do not change the existing
  `ductum login` surface or its tests.** Both entry points share the
  PKCE core; behavior parity is enforced by tests.
- `ductum.yaml` scaffolder updated: when Anthropic auth was acquired,
  the scaffolder writes a Claude agent entry to `agents:`.

Does **not** add:

- Codex login (P2).
- GitHub Copilot OAuth (P2).
- Browser handoff to dashboard (P3).
- Token-refresh handling (out of arc; D130 non-goal).

## Behavior Contract

### 1.1 New TUI step

After P0's "confirm" step and before "scaffold," the TUI inserts:

**Auth — Claude (Anthropic):**

1. **Detect existing creds.** Reuse D132's
   `scripts/bootstrap-support.mjs` `resolveProviders()` (or a CLI-side
   port) to check whether Anthropic is already authenticated via env
   var or ambient creds. If yes, the step prints "Detected
   `<provider/source>`" and skips to the next step (no re-auth).
2. **Prompt: "Sign in to Claude now?"** y/N, default y. If N, the
   scaffolder writes `agents: []` (P0 behavior) and prints a banner
   pointing at `ductum login` for later.
3. **Run PKCE.** Reuse the extracted PKCE core. Print the device-code
   URL the user should visit (browsers open automatically per D149,
   suppressed by `--no-browser`). Wait for the callback.
4. **Confirm.** On success, write the Claude agent entry to
   `ductum.yaml`'s `agents:` list. On failure, print the structured
   error envelope (D135 §3) with `code: "auth_anthropic_failed"` and
   suggested actions:
   - `ductum init --resume` (re-enters at the auth step)
   - `ductum login` (standalone)

### 1.2 Claude agent entry the scaffolder adds

```yaml
agents:
  - name: claude-builder
    role: builder
    harnessRef: claude-agent-sdk
    modelRef: claude-sonnet-4-6
    systemPromptRef: builder-default
    sandboxRef: worktree-default
    notificationChannelRef: stdout
harnesses:
  - name: claude-agent-sdk
    runtime: claude-agent-sdk
    version: 0.2.119   # exact pin per D52
```

Names and refs match the conventions already in `ductum.yaml` examples
in this repo. The exact agent shape verifies against `@ductum/core`'s
factory loader before write — if validation fails, scaffolder emits
`code: "init_yaml_invalid"` and rolls back.

### 1.3 D135 contract conformance

- **Envelope:** new event kinds `init.auth_started`,
  `init.auth_detected_existing`, `init.auth_pkce_url_emitted`,
  `init.auth_completed`, `init.auth_failed`.
- **Structured errors:** new codes `auth_anthropic_failed`,
  `auth_pkce_callback_timeout`, `auth_pkce_callback_port_in_use`,
  `init_yaml_invalid`. Each ships a `suggestedActions` array.
- **Cost field:** N/A.
- **Cancel/SIGINT:** mid-PKCE Ctrl-C closes the callback server,
  emits `init.auth_failed` with `reason: "sigint"`, and rolls back
  the scaffolder if it had begun writing.

### 1.4 Reuse, do not duplicate

The extracted PKCE core lives at
`packages/cli/src/login/pkce-core.ts`. Both `ductum login` and
`ductum init` import it. No PKCE logic duplicated. Tests for both
entry points share the same fixture set and exercise the same code
path; a divergence is a test failure.

### 1.5 File-size budget

`auth-anthropic.ts` ≤120 LOC. `pkce-core.ts` extracted size depends
on what comes out of D132's existing `login-command.ts` — split
further if the extraction would push any file over 300 LOC. No new
grandfather entries.

## Verification

- New tests in `packages/cli/src/tests/init/auth-anthropic.test.ts`:
  detected-existing path, declined path, successful PKCE path
  (mocked callback), timeout path, port-in-use path, SIGINT cleanup.
- Existing `login-command.test.ts` still green and exercises the
  same `pkce-core.ts`.
- `validate-env.test.ts` (`@ductum/api`) still green.
- `pnpm --filter @ductum/cli test` green.
- `pnpm build` green.
- File-size gate green.

## Exit Demo

Recorded as evidence in `evidence/p1-pkce-demo.txt`.

On a machine with **no** `ANTHROPIC_*` env vars, no
`~/.claude/.credentials.json`:

```sh
node /path/to/ductum/packages/cli/dist/index.js init
# Steps 1-4 from P0 unchanged.
# New step prompts "Sign in to Claude now?" → Enter (yes).
# Browser opens to claude.ai PKCE URL.
# Operator clicks approve in the browser.
# TUI shows "Signed in. Wrote claude-builder to ductum.yaml."
cat ~/ductum/factory/ductum.yaml
# `agents:` now contains claude-builder; `harnesses:` lists claude-agent-sdk.
ls -la ~/.claude/.credentials.json
# File exists with mode 0600.
```

Re-running `ductum init` on the same machine prints "Detected
anthropic via ambient ~/.claude/.credentials.json" and proceeds without
re-prompting.

## Drift Handling

- Pi-mono's PKCE helper changes shape upstream and we want to absorb
  the change? D125 still blocks Pi as a dep; we keep the local port.
  Record the divergence as a decision (D125 follow-up) before
  copying any new code.
- Anthropic changes the PKCE scope strings? Update the constants in
  `pkce-core.ts`, regenerate fixtures, record a decision noting the
  upstream change date and what scopes shifted.
- Callback port collision rate is too high in real-world use? Move
  port discovery from "random in 49152-65535" to a
  user-configurable env (`DUCTUM_LOGIN_PORT`). Decision required;
  no silent change.

## Slop Review

- Attack a P1 commit that copies PKCE code instead of refactoring
  D132's existing flow into a shared core.
- Attack any new credential storage path other than what D132
  established (`~/.claude/.credentials.json` or
  `$CLAUDE_CONFIG_DIR/credentials.json`). New paths fragment the
  detect-existing logic.
- Attack a TUI flow that auto-opens the browser without honoring
  `--no-browser` (D149).
- Attack a scaffolder that writes a Claude agent entry whose
  `modelRef`/`harnessRef`/`sandboxRef` don't validate against
  `@ductum/core`'s factory loader.
- Attack a PR that introduces refresh-token handling. Out of arc
  (D130 non-goal); needs its own decision.
- Attack a flow that doesn't roll back on SIGINT mid-PKCE.
