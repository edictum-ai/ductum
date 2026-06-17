# Docs Cleanup Inventory - 2026-04-26

## Current Source Of Truth

- `AGENTS.md`
- `specs/CURRENT.md`
- `decisions/053-factory-resource-model.md`
- `decisions/054-harness-plugin-model.md`
- `decisions/055-notification-backends.md`
- `decisions/056-sandbox-resource-model.md`
- `decisions/057-reference-runtime-systems.md`
- `specs/current/factory-resource-model-setup.md`

## Cleaned In This Pass

- `AGENTS.md` no longer points future agents at `impl-001` as the active
  roadmap.
- `CLAUDE.md` now says the repo has working code and points at current
  decisions.
- `STATUS.md` is marked as a historical April 4 snapshot.
- `VISION.md` no longer says the next step is writing the first implementation
  spec.
- `OPEN-QUESTIONS.md` now marks multi-repo coordination as answered by
  `Target` plus fan-out specs.
- `CONTEXT.md` now says enforcement happens locally through `@edictum/core`, not
  edictum-api.
- `ARCHITECTURE.md` and `HARNESS.md` no longer show agent-visible MCP calls
  taking `run_id`.

## Still Worth Cleaning Later

- `README.md` is over the repo's 300-line preference and mixes quick start,
  config reference, CLI reference, and deployment notes. Split into smaller docs
  when touching it next.
- `specs/impl-*` should remain as historical records/import fixtures, but they
  should eventually move under an archive namespace so new agents do not treat
  them as active work.
- `specs/dogfood-*` contains many old failed or recovered runs. Archive them
  after confirming no running Ductum state still references them.
- `docs/analysis/2026-04-06-*` and `2026-04-07-*` are valuable history, but not
  current readiness docs.
- `ARCHITECTURE.md`, `VISION.md`, and `HARNESS.md` still describe the original
  system shape. They should eventually be rewritten around the resource model
  instead of carrying update notes.

## Cleanup Rule

Do not delete or move historical specs blindly. First check whether the CLI
tests, seeded database, or dogfood run history still reference the paths.
