# P2 - Profile Placeholders

## Scope

Add minimal persisted resource shells for `WorkflowProfile`, `Model`, `Harness`,
`SandboxProfile`, and `NotificationChannel`.

## Decision Trace

- Decisions: `053`, `054`, `055`, `056`, `057`, `058`, `060`, `061`, `062`.
- Non-goals: no Pi-only rewrite; no second policy system; no remote sandbox
  orchestration; no notification marketplace.
- Allowed scope: resource config storage, validation, API list/get/apply, and no
  behavior migration.
- Verification: config parsing tests, API persistence tests, `pnpm build`.
- Drift handling: record an explicit decision before adding runtime behavior or
  fields copied only because a reference system has them.

## Behavior Contract

- Invalid resource kind/spec/project references must fail loudly before
  persistence.
- Resource shells must round-trip their specs through CLI/API output without
  dropping declared keys silently.
- Config that declares one resource kind while targeting another collection must
  be rejected with an operator-visible validation error.
- Resource shell apply/list/get paths must not claim runtime enforcement;
  unsupported runtime-enforcement fields must remain inert in output or be
  rejected explicitly.

## Slop Review

- Are behavioral tests checking rejected invalid resource specs, not only
  happy-path shape?
- Are missing project refs operator-visible?
- Did this duplicate config resource normalization logic?
- Did it add dead config branches for future features?

## Required Reading

- `specs/current/factory-resource-model-targets.md`
- `packages/core/src/resource-types.ts`
- `packages/api/src/lib/settings-config.ts`

## Deliverable

Small resource tables and config parsing that preserve `Agent != Model != Harness
!= SandboxProfile`.

## Dogfood

Apply `resources.yaml` through `ductum resource apply`, then record the P2 run,
decision, and evidence against the imported P2 task.
