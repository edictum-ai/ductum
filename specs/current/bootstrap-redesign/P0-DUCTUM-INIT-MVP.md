# P0 — `ductum init` MVP

## Problem

`scripts/bootstrap.mjs` ships from inside the repo and assumes the
operator already cloned and `cd`'d into `ductum/`. End users on fresh
machines have no path to a working factory. The first stage of the
bootstrap-redesign arc is the TUI skeleton: a single `ductum init`
command that creates a factory directory, scaffolds a `ductum.yaml`,
prints next steps, and exits cleanly. **No auth, no provider login, no
browser.** Those land in P1, P2, P3.

## Scope

CLI + scripts only. Adds:

- `packages/cli/src/commands/init.ts` (new) — entry point.
- `packages/cli/src/init/` (new directory) — TUI step handlers,
  scaffolders, prompt copy.
- `@clack/prompts@1.2.0` + `@clack/core@1.2.0` (transitive) added to
  `packages/cli/package.json`. Exact pins; commit lockfile changes;
  audit per D151.
- Default install location: `~/ductum` (configurable via prompt).
- Default project layout: `~/ductum/<projectName>/{ductum.yaml, .gitignore, .ductum/}`.

Does **not** add:

- Anthropic / Codex / Copilot login (P1, P2).
- Browser handoff to dashboard (P3).
- Global npm publish wiring (P4).
- Any change to `scripts/bootstrap.mjs` (per D150).

## Behavior Contract

### 0.1 Command surface

- `ductum init` runs the interactive TUI. TTY required for human
  mode; falls back to `--json` non-interactive mode otherwise.
- `ductum init --dir <path>` skips the directory prompt.
- `ductum init --name <projectName>` skips the project-name prompt.
- `ductum init --json` (D135 §1) emits one NDJSON envelope per
  progress event. Required prompts in this mode become validation
  errors with `code: "init_missing_arg"` (D135 §3).
- `ductum init --help` lists every flag, rendered through the
  output-mode helper (`packages/cli/src/output.ts`).

### 0.2 Steps the TUI walks

1. Welcome banner (one screen, dismissable with Enter).
2. **Where to install?** default `~/ductum`. Validates the path is
   writable, doesn't already contain a `ductum.yaml`, and isn't a git
   repo with uncommitted changes. If it exists with a `ductum.yaml`
   already, the TUI exits with structured error
   `code: "init_already_initialized"` and `suggestedActions[0].cmd =
   "ductum start --dir <path>"`.
3. **Project name?** default `factory`. Slug-validated.
4. **Confirm** the resolved paths and the `ductum.yaml` skeleton
   contents. Single y/N confirmation.
5. Scaffolding step (no prompts, just status updates):
   - mkdir the project dir
   - write `ductum.yaml` skeleton (no agents enabled yet, no harness
     configured)
   - write `.gitignore` (matches the repo's current root .gitignore
     for `.env.local`, `.ductum/`, `node_modules/`)
   - `git init` and one initial commit (operator can opt out with
     `--no-git`)
6. **Next steps** banner: prints exactly 3 commands the operator can
   run next. P1, P2, P3 expand this list as they ship.

### 0.3 `ductum.yaml` skeleton (P0 emits)

Minimal valid factory shape per D53. P0's skeleton intentionally
references **no agents** — adding agents is P1/P2's job (because they
require auth to be set up first).

```yaml
factory:
  name: <projectName>
  version: 1
  cli:
    outputMode: auto

projects:
  - name: <projectName>
    path: .

agents: []   # P1/P2 add Claude / Codex / Copilot entries here

harnesses: []
sandboxes: []
notificationChannels: []
```

This is invalid for *running* the factory (no agents → nothing
dispatches), but valid for `ductum spec import` and `ductum status`.
P1's exit demo flips `agents: []` to a real Claude entry.

### 0.4 D135 contract conformance

- **Output mode (§1):** `ductum init` reads `--json | --human`,
  `DUCTUM_OUTPUT`, `factory.cli.outputMode`, then `auto`.
- **Envelope (§2):** every `--json` event uses `{schemaVersion: 1,
  kind: "init.<step>", data: {...}, ts: ...}`. New kinds:
  `init.started`, `init.directory_resolved`, `init.scaffolded`,
  `init.completed`. Add to D135's stream registry as part of this PR.
- **Structured errors (§3):** failures use `code: "init_*"` and ship a
  `suggestedActions` array. Codes registered in this PR:
  `init_already_initialized`, `init_path_unwritable`, `init_missing_arg`,
  `init_invalid_project_name`, `init_git_uncommitted`.
- **Cost field (§6):** N/A — `ductum init` does not spend agent tokens.
- **Cancel/SIGINT (§8):** Ctrl-C during the TUI emits one
  `{"kind":"init.cancelled","data":{"reason":"sigint"}}` envelope and
  exits 130. Partial scaffolding is rolled back (the project dir
  created but unwritten is removed).

### 0.5 File-size budget

Each new file ≤300 LOC per repo rule. Expected split:

- `init.ts` — entry, flag parsing (≤80 LOC)
- `init/steps/welcome.ts`, `init/steps/directory.ts`,
  `init/steps/project-name.ts`, `init/steps/confirm.ts`,
  `init/steps/scaffold.ts`, `init/steps/next-steps.ts` (≤80 LOC each)
- `init/scaffolders/factory-yaml.ts` (≤80 LOC)
- `init/scaffolders/git-init.ts` (≤60 LOC)

No grandfather-list entries needed.

## Verification

- New unit tests in `packages/cli/src/tests/init/` for: directory
  validation, project-name slug validation, scaffolding writes the
  expected files, error codes match D135 §3 shape, `--json` mode
  emits envelopes for every documented kind, SIGINT cleanup.
- `pnpm --filter @ductum/cli test` green.
- `pnpm test:scripts` green.
- File-size gate green (no new grandfather entries).
- `pnpm build` green.

## Exit Demo

Recorded as evidence in `evidence/init-mvp-demo.txt` plus a
`worktree.snapshot` evidence row.

```sh
# In a tmp directory, no Ductum repo cloned:
node /path/to/ductum/packages/cli/dist/index.js init
# TUI walks 4 prompts.
# Project dir is created at ~/ductum/factory/.
# `cat ~/ductum/factory/ductum.yaml` shows the skeleton.
# `cd ~/ductum/factory && git log` shows one commit.
node /path/to/ductum/packages/cli/dist/index.js init   # second run
# TUI exits with init_already_initialized error and suggested action.
```

The demo doesn't require auth or a running serve. P0 is *just* the
shell.

## Drift Handling

- Hit a real-machine OS quirk that needs another dep (e.g., path
  permissions on macOS sandbox)? Audit per D52, record as a
  follow-up decision, then add. Do not silently `pnpm add`.
- Discover that `@clack/prompts@1.2.0` has a regression and need
  1.3.0? Re-audit (1.3.0 was 4 days old at spec time; verify the
  buffer at install time) and amend D151.
- TUI ergonomics push the `init.ts` file over 300 LOC? Split. Don't
  grandfather.

## Slop Review

- Attack any commit that adds login flow before P1 dispatches.
  P0 is intentionally login-free.
- Attack a `ductum init` that prompts more than 4 times.
- Attack a `--json` mode that emits anything other than envelope-shaped
  NDJSON.
- Attack a scaffolder that writes outside the chosen project dir.
- Attack a scaffolder that doesn't roll back on SIGINT.
- Attack a `ductum init` that touches `scripts/bootstrap.mjs`.
- Attack a PR that adds an entry to `agents:` in the scaffold (that's
  P1's exit demo).
