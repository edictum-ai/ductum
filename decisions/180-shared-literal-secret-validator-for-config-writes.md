# D180: One shared literal-secret validator rule for config-writing paths

## Context

Issue `#40` called out the P9 drift where runtime config writes and migration-era
validation could diverge. The literal-secret scanner already exists centrally in
`@ductum/core`, but write paths were still responsible for wiring it by hand.
That made it easy for one config surface to validate while another silently
missed the same check.

## Decision

All normal config-writing paths must do one of these before they persist
operator-authored config:

1. call a shared config-write helper that routes through the central
   literal-secret validator; or
2. carry an explicit `CONFIG_WRITE_VALIDATION_EXEMPTION` marker because the
   path does not persist normal secret-bearing config.

Current coverage:

- `packages/api/src/routes/config-resources.ts` → `prepareConfigResourceSpecWrite`
- `packages/api/src/routes/agents.ts` → `prepareAgentSpawnConfigWrite`
- `packages/api/src/routes/factory.ts` → exemption, no secret-bearing fields
- `packages/api/src/routes/factory-runtime.ts` → exemption, no secret-bearing fields
- `packages/api/src/routes/factory-secrets.ts` → exemption, encrypted secret store
- `packages/api/src/workflow-profiles.ts` → exemption, validated workflow path metadata only

The shared helpers must remain thin adapters over the central core secret
scanner so runtime behavior and future migration/import behavior cannot drift.

## Consequences

- New config write surfaces must either join the shared helper path or declare a
  reviewed exemption in code.
- `scripts/check-config-write-validation.mjs` is the grep gate for the current
  inventory. A path that drops the shared helper or exemption marker fails the
  repo script gate.
- Secret storage itself remains a deliberate exception because it stores
  encrypted secret payloads rather than normal config literals.
