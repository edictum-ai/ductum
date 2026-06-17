# P7 — UI And CLI Cutover

## Executor

Codex direct.

## Problem

The normal operator surface still teaches old words and data-grid thinking. The
redesigned product needs Home, Projects, Factory Activity, Factory Settings,
Repair, and public CLI vocabulary that match the operator model.

## Scope

- Add or update Home, Projects, Factory Activity, Factory Settings, and Repair
  surfaces.
- Put Specs, Tasks, Attempts, Repositories, and Components under Projects.
- Put Agents, Providers, Models, Harnesses, Workflows, sandboxes,
  notifications, budgets, and app settings under Factory Settings.
- Replace normal public wording: Attempt not Run, Repository/Component not
  Target, Factory Settings not Resources, applying configuration not seed.
- Update normal CLI help and status output.
- Keep debug/migration compatibility explicit and out of the first successful
  loop.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D119 dashboard is an operator inbox.
- D135 agent-first control plane contract.
- D144 CLI output mode toggle.

## Behavior Contract

P7 is an umbrella prompt and should be split before execution unless P0/P1-P6
leave it clearly small. Preferred split: CLI cutover first, UI information
architecture second, Repair views third.

## Non-Goals

- No full dashboard rewrite unrelated to the information architecture.
- No removal of debug internals required for development.
- No raw enum labels in normal UI.
- No new dependencies.

## Drift Handling

Record a decision before implementing all UI/CLI cutover work as one large
stage, reintroducing old public words, or showing internal enum values as normal
labels.

## Slop Review

Attack:

- Home that becomes a database dashboard again;
- normal help that documents run/target/resource as the redesigned path;
- Repair hidden outside the normal operator loop;
- raw enum labels in normal UI.

## Acceptance

- `ductum start`/status shows project summary, Factory Activity, and next
  actions.
- Normal UI no longer exposes generic resources, seed, target, or run as primary
  labels.
- Normal CLI docs use redesigned nouns.
- Repair points to exact records and fields.

## Verification

Run relevant CLI/dashboard/API tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
