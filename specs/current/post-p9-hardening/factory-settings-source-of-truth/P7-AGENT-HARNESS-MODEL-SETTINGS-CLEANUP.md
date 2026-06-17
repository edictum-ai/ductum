# P7 - Agent, Harness, And Model Settings Cleanup

## Goal

Make agent, harness, and model settings explicit enough for real Factory
routing without raw string confusion.

## Scope

- Normalize Agent fields around role/persona, modelRef, harnessRef, sandboxRef,
  workflow permissions, capabilities, budgets, concurrency, enabled state, and
  secret access refs.
- Normalize Harness fields around adapter type, command/runtime, supported
  sandboxes, supported providers, required secrets, restart behavior, and
  health/test status.
- Normalize Model fields around Ductum model ID, provider model ID, provider,
  availability, supported efforts/options, pricing/rates, scanner source,
  enabled state, source URL, and last verified date.
- Improve validation errors so they identify the exact identity type expected.
- Keep Agents distinct from Models and Harnesses.

## Files Likely Touched

- `packages/core/src/types.ts`
- `packages/core/src/resource-types.ts`
- `packages/core/src/factory-settings-types.ts`
- `packages/core/src/factory-settings-validation.ts`
- `packages/core/src/agent-runtime-resolution.ts`
- `packages/api/src/lib/agent-runtime-validation.ts`
- `packages/api/src/routes/agents.ts`
- `packages/dashboard/src/settings/AgentConfigPanel.tsx`
- `packages/dashboard/src/settings/ModelPicker.tsx`
- `packages/dashboard/src/tests/settings-agent-config.test.tsx`
- `packages/core/src/tests/agent-runtime-resolution.test.ts`

## Explicit Non-Goals

- Do not add new harness adapters.
- Do not add new providers.
- Do not change Edictum workflow semantics.
- Do not collapse Agent, Model, and Harness into one resource.
- Do not implement Telegram notification assignments.

## Acceptance Tests

- Agent validation rejects ambiguous raw model/harness strings when refs are
  required by the typed model.
- Harness compatibility errors name Agent, Model, provider model ID, and
  Harness adapter type separately.
- UI selectors show Model IDs and provider model IDs without conflating them.
- Existing dispatch can resolve a configured Agent into runtime model, harness,
  sandbox, and workflow snapshots.
- Active Attempt snapshots remain stable after settings edits.

## Verification Commands

```bash
pnpm --filter @ductum/core test -- agent-runtime-resolution
pnpm --filter @ductum/core test -- factory-settings
pnpm --filter @ductum/api test -- agents
pnpm --filter @ductum/dashboard test -- settings-agent-config
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P1 for typed settings DTOs.
- P5 for secret refs.
- P6 for typed UI surfaces.

## Risks / Rollback Notes

- Risk: over-modeling makes simple agent setup harder. Keep defaults seeded by
  init and expose advanced fields only where needed.
- Risk: changing Agent shape can break dispatcher resolution. Preserve runtime
  snapshots and add compatibility tests before changing dispatch.
- Rollback: keep old persisted columns readable until all fixtures are updated.
