# P2 - Init Writes SQLite Directly

## Goal

Make `ductum init` create a complete DB-only Factory with no `ductum.yaml`
output.

## Scope

- Replace init scaffolding that writes `ductum.yaml` with direct SQLite Factory
  state creation.
- Replace the post-scaffold welcome API seed with a core DB seeder invoked by
  init before API/browser handoff. The handoff API may serve the dashboard, but
  it must not own Factory seeding.
- Replace init's already-initialized guard so it detects existing DB Factory
  state instead of `ductum.yaml`.
- Seed Factory, desired runtime settings, Project, Repository/Component,
  Agents, Project Agent assignments, providers, models, harnesses, workflow
  profile, sandbox profile, and budget defaults.
- Seed the refreshed built-in model/harness/provider descriptors available at
  this stage.
- Update init output so it tells the operator where the DB-backed Factory lives.
- Update init `.gitignore` and initial commit behavior so local DB/key material
  is not staged or committed by default.
- Update init tests that currently assert YAML file creation.

## Files Likely Touched

- `packages/cli/src/init/**`
- `packages/cli/src/commands/init*.ts`
- `packages/cli/src/serve/factory-data.ts`
- `packages/cli/src/serve/factory-discovery.ts`
- `packages/cli/src/serve/config.ts`
- `packages/api/src/lib/legacy-config-preflight.ts`
- `packages/core/src/legacy-migration.ts`
- `packages/core/src/repos/**`
- `packages/cli/src/tests/init/**`
- `scripts/serve-seed*.mjs`
- `scripts/bootstrap*.mjs`
- `scripts/bootstrap*.test.mjs`

## Explicit Non-Goals

- Do not support legacy migration.
- Do not keep writing a receipt named `ductum.yaml`.
- Do not rebuild Settings UI.
- Do not remove old YAML routes yet; P3 owns removal.
- Do not add new CLI commands.

## Acceptance Tests

- Clean `ductum init` creates a SQLite DB with a Factory row.
- Clean `ductum init` creates no `ductum.yaml`.
- The new DB contains initial Project, Repository/Component, Agent, assignment,
  catalog, workflow, sandbox, and budget records.
- Re-running `ductum init` against a DB-only Factory is rejected by detecting DB
  Factory state, not YAML.
- The post-init API/browser handoff does not depend on
  `/api/settings/config` or a `ductum.yaml` config path.
- The initial git commit does not include `ductum.db`,
  `.ductum/secrets.key`, or any future local secret material.
- `ductum start` can start from the DB-only Factory created by init.
- Init output does not claim YAML is the source of truth.

## Verification Commands

```bash
pnpm --filter @ductum/cli test -- init
pnpm --filter @ductum/cli test -- serve-command
pnpm --filter @ductum/core test
node scripts/bootstrap-support.test.mjs
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P1 must provide the DB/repo/API foundation for seeded settings records.

## Risks / Rollback Notes

- Dangerous stage: init/startup is the first user experience and can strand new
  factories if DB seeding is incomplete.
- Risk: the current welcome seed path already writes partial DB state through a
  spawned API while that API points Settings at `ductum.yaml`. Replace it with a
  core DB seeder before removing YAML output.
- Risk: the current already-initialized guard only detects `ductum.yaml`. A
  DB-only Factory must be protected from accidental re-init.
- Risk: DB-only init can accidentally commit `ductum.db` unless gitignore and
  staging are updated with the seeding change.
- Risk: bootstrap scripts still assume `ductum.yaml`. Update tests before
  changing behavior.
- Rollback: restore prior init YAML scaffolding only before P3 removes the
  legacy paths. After P3, rollback requires a new DB-only fallback, not YAML.
