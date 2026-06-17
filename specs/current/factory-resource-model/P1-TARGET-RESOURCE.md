# P1 - Target Resource

## Scope

Add `Target` end to end as the first declarative resource-model primitive.

## Required Reading

- `AGENTS.md`
- `SECURITY.md`
- `specs/CURRENT.md`
- `decisions/053-factory-resource-model.md`
- `decisions/058-minimal-scope-and-reference-non-goals.md`
- `decisions/060-decision-drift.md`
- `decisions/061-target-resource-setup.md`
- `packages/core/src/repos/project.ts`
- `packages/api/src/routes/projects.ts`
- `packages/api/src/lib/settings-config.ts`
- `packages/cli/src/commands/config.ts`

## Deliverable

- `Target` type and SQLite repo.
- Target config validation and sync.
- Target API route.
- CLI `target list`, `target get`, and `target apply`.
- Tests for API persistence and config parsing.
- Sample Edictum ecosystem target manifest.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `061`.
- Non-goals: no `Operation`; no `WorkOrder`; no task `target_id`; no credential
  vault; no sandbox runtime driver.
- Allowed scope: Target resource only, plus dogfood artifacts and import/use of
  generated tasks.
- Verification: targeted core/API/CLI tests, `pnpm build`, CLI/API path used for
  dogfood task creation, `git diff --check`.
- Drift handling: stop and record a new decision or waiver before adding
  task-level fan-out, sandbox execution, model registries, or notification
  backends.

## Behavior Contract

- Invalid or missing Target source fields must fail loudly in settings/API/CLI
  validation.
- Target persistence must round-trip the full normalized spec without silently
  dropping known fields.
- Target CRUD must remain scoped to the owning project.
- This slice must not add `Operation`, `WorkOrder`, task fan-out, sandbox
  runtime behavior, or a credential vault.
- Missing dogfood evidence for applying the Target manifest through the real
  CLI/API path must fail review.

## Slop Review

- Are behavioral tests covering Target invalid input failures?
- Are errors visible in CLI/API output instead of logs only?
- Did the implementation avoid duplicating project/target resolution logic?
- Did it add dead config branches for future features?

## Verification

```bash
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
```
