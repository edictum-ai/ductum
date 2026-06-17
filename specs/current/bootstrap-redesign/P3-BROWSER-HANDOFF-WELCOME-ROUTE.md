# P3 — Browser Handoff + Dashboard `/welcome` Route

## Problem

After P0-P2 ship, `ductum init` produces a working `ductum.yaml` and
authenticated agents. The operator then has to *remember* to start
serve, find the dashboard URL, navigate there, and figure out where
to import their first spec. The factory should walk them across that
gap. The browser is the right surface; the TUI just needs to open
it pointed at the right place.

## Scope

CLI + dashboard:

- `packages/cli/src/init/steps/start-and-handoff.ts` (new) — a final
  step in `ductum init` that starts (or detects) `pnpm serve` and
  opens the dashboard at `/welcome` once it's up.
- `open@11.0.0` added to `packages/cli/package.json`. Exact pin;
  audit per D151 (already covered).
- `packages/dashboard/src/routes/welcome.tsx` (new) — the dashboard
  route operators land on. Walks "import your first spec" via the
  existing spec-import API and existing factory health endpoints.
- Dashboard router updated to register `/welcome`.
- A new `ductum start` CLI command (separate from `pnpm serve`) so
  operators on a globally-installed `ductum` (P4) have a stable
  entry. `ductum start` is a thin wrapper that boots the API + the
  bundled dashboard from the install location.

Does **not** add:

- Implementation of D119 dashboard-as-operator-inbox. `/welcome` is a
  scoped first-run onboarding page; D119 is its own arc.
- Any change to authn/authz on dashboard routes — `/welcome` requires
  a valid operator token like every other route.
- Persistent state for "have I seen the welcome page?" — kept simple:
  the route is always reachable; `ductum init` opens it once.

## Behavior Contract

### 3.1 Final step in `ductum init`

After agent-pickers (P2) and scaffold:

1. **Prompt: "Start the dashboard now?"** y/N, default y.
2. If yes:
   - Detect whether `ductum start` (or `pnpm serve` in dev mode) is
     already running on the configured port. If yes, skip the start.
   - Otherwise, spawn `ductum start` as a detached child process.
     Capture stdout/stderr to `~/.ductum/logs/serve-<timestamp>.log`.
   - Wait for the API health endpoint (`GET /api/factory`) to return
     2xx, with a 60s timeout. Print progress as envelope events
     (`init.serve_starting`, `init.serve_ready`,
     `init.serve_timeout`).
3. **Open the browser** to
   `http://<host>:<port>/welcome?token=<operator-token>`. Honor:
   - `--no-browser` flag → print the URL, don't open.
   - `DUCTUM_NO_BROWSER=1` env → same as the flag.
   - Non-TTY → don't open (assume scripted use).
4. Print final next-steps banner (3 commands max).

### 3.2 `ductum start` CLI command

- `ductum start` boots API + bundled dashboard. No-op if a serve is
  already healthy on the configured port.
- `ductum start --port <n>` overrides port. Default 3210 (matches
  current dev convention; verify against `ductum.yaml.factory`
  defaults at implementation time).
- `ductum start --foreground` runs in the foreground (default
  detached when invoked from `ductum init`; default foreground when
  invoked directly by an operator).
- D135 contract: envelope-shaped startup events when `--json`.

### 3.3 Dashboard `/welcome` route

The route is a single React page with three sections:

1. **Welcome banner** — names the factory (from `factory.name` in
   `ductum.yaml`), the agents wired up (from agents list), and the
   project (from projects[0].name).
2. **Import your first spec** — UI flow that:
   - either uploads a `.md` file from disk
   - or imports the bundled `specs/examples/hello-readme/` (lives in
     the package — P4 ships it inside the global install)
   - calls existing `POST /api/specs` with the imported content
   - shows progress via the SSE event stream (`/api/events`,
     filtering `kind=spec.imported`)
3. **What happens next** — once a spec exists, link to the spec page
   and to the run that the dispatcher will pick up.

The route reads from existing API endpoints. No new API surface
unless an existing endpoint is missing required filtering (in which
case: record a decision, ship the API change as a separate commit,
then add the dashboard usage).

### 3.4 D135 contract conformance

- **Envelope:** new event kinds `init.serve_starting`,
  `init.serve_ready`, `init.serve_timeout`,
  `init.browser_opened`, `init.browser_skipped`.
- **Structured errors:** new codes `serve_start_failed`,
  `serve_health_timeout`, `serve_port_in_use`. Suggested actions
  per code.
- **Cost field:** N/A.
- **Cancel/SIGINT:** Ctrl-C kills the spawned serve only if
  `init` started it (track ownership). Don't kill a serve the
  operator already had running.

### 3.5 File-size budget

`start-and-handoff.ts` ≤180 LOC. `welcome.tsx` ≤250 LOC; split into
section components if it grows. `ductum start` command ≤150 LOC.
No new grandfather entries.

## Verification

- New tests for `start-and-handoff.ts`: serve-already-up,
  serve-spawn-then-ready, serve-timeout, --no-browser, SIGINT
  cleanup.
- Dashboard component test for `welcome.tsx`: renders
  factory/agents from props, file-upload path, sample-import path,
  SSE-progress rendering.
- `ductum start` command tests: port-in-use, foreground/detached,
  envelope output mode.
- Existing API tests stay green; no API behavior changed unless
  flagged in §3.3.
- `pnpm build` green for both `@ductum/cli` and the dashboard.
- File-size gate green.

## Exit Demo

Recorded as evidence in `evidence/p3-handoff-demo.txt`.

On a clean machine, post-P0/P1/P2 successful run:

```sh
node /path/to/ductum/packages/cli/dist/index.js init
# Walks all prior steps. Final step:
# "Start the dashboard now?" → Enter (yes)
# Browser opens to http://localhost:3210/welcome?token=...
# Operator sees: factory name, claude/codex/copilot agents listed
# Operator clicks "Import sample spec (hello-readme)"
# Dashboard shows progress streaming over SSE
# Spec lands. Operator clicks the linked run page.
```

`--no-browser` path:

```sh
node /path/to/ductum/packages/cli/dist/index.js init --no-browser
# Identical, except final step prints the URL instead of opening
```

## Drift Handling

- Default port `3210` already in use → fall back to ephemeral
  port, write resolved port to `ductum.yaml.factory.cli.port`,
  record as a decision so the default-port choice has evidence.
- `open` 11.0.0 has a regression on macOS or Linux → revert to
  printing URL only; record incident as a decision; do not silently
  swap to a different package without the D52 audit.
- `/welcome` page needs API surface that doesn't exist yet → record
  a decision; ship API change as a separate commit; then ship
  dashboard.

## Slop Review

- Attack any flow that opens the browser without honoring
  `--no-browser` or `DUCTUM_NO_BROWSER`.
- Attack any flow that kills a serve the operator already had running.
- Attack any `/welcome` route that ships behind unauth (must require
  operator token like every other dashboard route).
- Attack any sample-spec import that bypasses existing
  `POST /api/specs` validation.
- Attack any commit that adds D119-shaped surface beyond the
  scoped `/welcome` first-run page.
- Attack any flow that opens the browser at a URL containing the
  operator token in the *fragment* (still leaks via Referer in
  some cases) — token belongs in `Authorization` header on the
  subsequent fetch, not in the URL beyond the initial handoff.
  **Re-evaluate this attack vector at implementation time:** if
  passing the token via URL on first load is the only practical
  handoff, document it as a known cookie-rotated short-lived
  redirect (the dashboard exchanges the URL token for a session
  cookie on first load and then strips the URL).
