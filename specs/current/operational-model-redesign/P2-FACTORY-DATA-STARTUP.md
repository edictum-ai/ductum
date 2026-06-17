# P2 — Factory Data Directory And Startup Boundary

## Executor

Codex direct.

## Problem

Startup currently starts the API and mutates state through config seeding. The
redesign requires DB/UI/CLI to be source of truth after setup and requires
validation before mutation.

## Scope

- Introduce the per-Factory data directory boundary, defaulting under
  `~/.ductum`.
- Make `ductum start` start or open the control plane for an existing Factory.
- If no Factory exists, route to setup/migration instead of an empty app.
- Add preflight validation and boundary checks before legacy config import would
  write state.
- Keep `pnpm serve` as a contributor/dev path, not the normal operator path.
- Prepare startup to avoid reseeding from `ductum.yaml` after P6 migration
  exists.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- P0 design review output.
- D147 global install.
- D149 browser handoff.
- D150 legacy bootstrap path retained.
- D155 publishable package shape.

## Behavior Contract

P2 is a startup boundary and preflight stage only. It must not implement the full
legacy `ductum.yaml` migration and must not disable legacy config as startup
input until P6 provides the migration path.

## Non-Goals

- No full migration implementation; P6 owns that.
- No disabling legacy `ductum.yaml` startup input until P6 lands.
- No dashboard IA cutover; P7 owns that.
- No service manager implementation beyond what is needed to preserve current
  start behavior.
- No new dependencies.

## Drift Handling

Record a decision before changing the migration cutoff, deleting the contributor
startup path, or moving P6 migration behavior into P2.

## Slop Review

Attack:

- start paths that mutate before preflight;
- P2 silently implementing half of P6;
- breaking `pnpm serve` for contributors;
- claiming `ductum.yaml` is ignored before migration exists.

## Acceptance

- Existing startup behavior remains compatible while the new Factory boundary is
  introduced.
- Missing Factory routes to setup/migration planning.
- Invalid legacy config can be preflighted before mutation.
- Contributor startup remains available through an explicit dev path.

## Verification

Run relevant CLI/API tests plus:

```sh
pnpm build
pnpm -r test
git diff --check
```
