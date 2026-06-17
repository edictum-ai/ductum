# Data Model & Migrations

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The data model is a single SQLite database fronted by a clean per-table repository layer, with a 40-step append-only migration ledger (db-migrations.ts) that faithfully records the full schema history including three live stage-machine rewrites (008/014) and the Target->Repository/Component transition (036). The current primitive model (Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt) is well-typed and the AttemptRuntimeSnapshot seals most of a job bundle. The main legacy debt is the retired-but-live `targets` table plus its repo/type/materializer chain, which survives only as a fallback in resolveTaskScope, and a file-size gate that exempts grandfathered files by path so db-migrations.ts has silently grown 819->1169 LOC. Quality is solid; the principal risks are operator-legibility of the dual repository/target/legacy-repos scope resolution and the unbounded growth of grandfathered files.

## Migration ledger (db-migrations.ts)
- **What:** Append-only array of 40 ordered migrations (`001`–`040`) applied once each via a `schema_migrations` table; covers the full schema history including three full `runs` table rebuilds for stage-machine changes and the Target->Repository/Component transition.
- **Where:** `packages/core/src/db-migrations.ts:5-891` (MIGRATIONS), `applyMigration` `:895-1130`, `db.ts:21-49` (runner, FK-off rebuild list).
- **Maturity:** live-core
- **Quality:** solid — idempotent guards via `hasColumn` for ALTERs, table rebuilds wrapped in `foreign_keys=OFF` transactions (`db.ts:24-39`), backfill (039) is covered by a dedicated test (`tests/db-migrations-best-of-n.test.ts`).
- **Operator-legibility risk:** partial — the ledger doubles as the audit trail of three stage vocabularies (`accepted/implementing/...` -> `read-analyze/...` -> `understand/implement/ship/done`); an operator reading mid-history rows must know which migration era a stage value belongs to.
- **Dependencies:** better-sqlite3; consumed only by `initDb`. Everything downstream depends on the final schema shape.
- **Disposition (recommended):** KEEP — chronological ledger is intentionally not split (grandfathered, D112); rewriting it would destroy audit order.
- **Flags:** legacy — file has grown 819->1169 LOC since its grandfather entry was recorded; the size gate exempts by path only so this growth is invisible to CI (see file-size note below).

## Core record types (types.ts)
- **What:** Branded-ID record interfaces for the whole primitive model: Factory, Project, Agent, Spec, Task, Decision, Run, Evidence, GateEvaluation, SessionRunMapping, etc., plus runtime-snapshot value types.
- **Where:** `packages/core/src/types.ts:30-300`; lifecycle enums imported from `lifecycle-types.js`.
- **Maturity:** live-core
- **Quality:** solid — branded IDs prevent cross-entity ID confusion; deprecations are annotated honestly (`RunStage` `:27-28`, `ciStatus`/`reviewStatus` `:212-215`).
- **Operator-legibility risk:** partial — `Run` carries both the new `attemptSnapshot`/`runtime*` snapshot fields and the deprecated `ciStatus`/`reviewStatus` latch fields; an operator inspecting a raw Run row sees both eras side by side.
- **Dependencies:** consumed by every package; `Task.targetId` still a first-class non-optional field (`:152`) alongside optional `repositoryId`/`componentId` (`:153-154`).
- **Disposition (recommended):** KEEP — accurate model of shipped reality; deprecated fields are flagged, not hidden.
- **Flags:** legacy — `Task.targetId: TargetId | null` is required while the replacement repository/component fields are optional, inverting the intended primacy.

## Repository/Component model + materializer (resource-types.ts, repository-model.ts)
- **What:** The current P4/D169 scope vocabulary: Repository (with derived identity/readiness) and Component, plus pure functions to materialize a Repository from a spec and to derive Repository/Component from a legacy Target.
- **Where:** `resource-types.ts:46-116` (Repository/Component types), `repository-model.ts:10-95` (materialize/readiness/github-parse + `repositoryFromTarget`/`componentFromTarget`).
- **Maturity:** live-core
- **Quality:** solid — readiness derivation and GitHub-remote parsing are pure and unit-tested (`tests/repository-model.test.ts`); identity falls back local->name deterministically.
- **Operator-legibility risk:** none — derived readiness fields give the operator a typed view of git/local/github state.
- **Dependencies:** `materializeRepository` used by `SqliteRepositoryRepo`; `repositoryFromTarget`/`componentFromTarget` used by `task-scope.ts` fallback only.
- **Disposition (recommended):** KEEP — this is the live source-of-truth vocabulary post-D169.
- **Flags:** legacy-adjacent — `repositoryFromTarget` mints a Repository whose `id` is the Target's id and `componentFromTarget` builds a synthetic `${target.id}:component` id; harmless but couples the live model to the retired Target shape.

## Repository/Component repos (repos/repository.ts)
- **What:** SQLite repos for the `repositories` and `components` tables (CRUD + upsert + name lookup), the live scope persistence layer.
- **Where:** `repos/repository.ts:54-178`; tables from migration `036` (`db-migrations.ts:783-811`, idempotent variant `:1058-1092`).
- **Maturity:** live-core
- **Quality:** solid — consistent row-mapping, `assertChanges`/`assertFound` guards, `UNIQUE(project_id,name)` / `UNIQUE(repository_id,name)` enforced at schema level.
- **Operator-legibility risk:** none
- **Dependencies:** `materializeRepository`; consumed by api routes (`routes/repositories.ts`) and `task-scope.ts`.
- **Disposition (recommended):** KEEP — the intended primary scope persistence.
- **Flags:** none

## Task scope resolution (task-scope.ts)
- **What:** Resolves a Task to a (Repository, Component) pair through three precedence tiers: explicit task repository/component -> legacy Target -> legacy `repos[]` string array (with a synthetic local repository fallback).
- **Where:** `packages/core/src/task-scope.ts:21-95`; `TaskScopeSource = 'task' | 'target' | 'legacy-repos'` `:6`.
- **Maturity:** live-core (with two legacy fallback tiers)
- **Quality:** adequate — correct precedence and validation (component/repository mismatch throws), but three resolution paths in one function is a comprehension load.
- **Operator-legibility risk:** high — when a task resolves via `target` or `legacy-repos`, the scope an attempt actually runs against is computed at dispatch time and not visible as a stored field; an operator must read the resolver to know which repository a legacy task hits.
- **Dependencies:** TargetRepo, RepositoryRepo, ComponentRepo, SpecRepo; relies on `repositoryFromTarget`/`componentFromTarget` and `syntheticLocalRepository`.
- **Disposition (recommended):** REUSE — keep the resolver but it should sit behind a single stored/sealed scope once the Target and `repos[]` fallbacks are retired.
- **Flags:** legacy — both the `target` and `legacy-repos` tiers exist only to read retired vocabularies; `syntheticLocalRepository` fabricates `id: 'legacy:<value>'` rows that never hit the DB.

## Targets table + Target repo/types (legacy)
- **What:** The pre-P7 `targets` table, `Target`/`TargetSpec`/`TargetSource` types, and `SqliteTargetRepo`. Superseded by Repository/Component (D169 retired `target` as an operator CLI surface).
- **Where:** table `db-migrations.ts:538-551` (022) + `tasks.target_id` (024 `:574-579`); types `resource-types.ts:8-44`; repo `repos/target.ts:33-96`; `TargetId` brand `types.ts:12`.
- **Maturity:** legacy-retired (still wired)
- **Quality:** adequate — code itself is clean, but it persists a retired concept; still constructed in `api/src/index.ts:103`, `api/src/lib/deps.ts:236`, and passed into task-scope at dispatch.
- **Operator-legibility risk:** partial — `targets` rows and `tasks.target_id` remain queryable and writable; an operator can still create state in a retired surface.
- **Dependencies:** consumed by `task-scope.ts` fallback and api route wiring; `repositorySpecFromTarget`/`repositoryFromTarget` bridge it to the live model.
- **Disposition (recommended):** REMOVE — candidate for deletion once existing factories have no `target_id` rows; gate removal on a one-time backfill of `target_id` -> `repository_id`/`component_id`, then drop the table, repo, types, and the `target` scope tier.
- **Flags:** legacy — retired-but-undeleted; `Task.targetId` is still a required field, keeping the dead concept structurally load-bearing.

## ConfigResource table + repo (Factory Settings backing)
- **What:** Generic `config_resources` table (kind in WorkflowProfile/Model/Harness/SandboxProfile/NotificationChannel) and its repo; this is the live persistence behind the Factory Settings catalogs even though `resource` was retired as an operator CLI verb (D169).
- **Where:** table `db-migrations.ts:554-571` (023); repo `repos/config-resource.ts:35-111`; catalog adapter `repos/factory-catalog.ts:13-46` -> `factory-settings.ts:49-68`.
- **Maturity:** live-core (internal backing) under a retired public name
- **Quality:** solid — typed kind/spec union (`resource-types.ts:118-186`), factory-vs-project scoping via partial unique indexes (`:567-570`).
- **Operator-legibility risk:** partial — the operator sees typed "Providers/Models/Harnesses/..." in Factory Settings, but they are all rows of one `config_resources` table keyed by `kind`; the storage name (`resource`) contradicts the retired vocabulary.
- **Dependencies:** `ConfigBackedFactoryCatalogRepo` -> `buildFactorySettingsCatalogs`; the P0 source-of-truth audit (`factory-settings-source-of-truth/P0-contradiction-audit.md`) flags typed Factory Settings APIs as the intended replacement.
- **Disposition (recommended):** REUSE — sound storage, but the retired `resource` naming should move behind the typed Factory Settings DTO boundary the P0 audit specifies.
- **Flags:** legacy-naming — `config_resources` / `ConfigResource` keep the retired `resource` vocabulary as the live settings store.

## AttemptRuntimeSnapshot + builder (attempt-types.ts, attempt-snapshot.ts)
- **What:** The sealed job-bundle captured per attempt: spec, task, project(+config), repository, component, agent, provider, model, harness, workflow, sandboxProfile, execution. Persisted to `runs.attempt_snapshot` (migration 037).
- **Where:** types `attempt-types.ts:85-99`; builder `attempt-snapshot.ts:25-93`; column `db-migrations.ts:814-816` (037); stability test `tests/attempt-snapshot-settings-stability.test.ts`.
- **Maturity:** live-core
- **Quality:** solid — captures resolved runtime identity (provider/model/harness adapter keys, pricing, sandbox, workflow) at dispatch, sealing roughly 7 of the 9 intended bundle fields.
- **Operator-legibility risk:** none — this is precisely the typed evidence an operator needs to know what an attempt ran against.
- **Dependencies:** AgentRuntimeResolution, model-registry, Repository/Component; written by RunRepo `updateAttemptSnapshot`.
- **Disposition (recommended):** REUSE — strong foundation; per the established finding it does not yet seal secrets/credential bindings or pin host/container identity (`execution.hostId` is recorded `:84-85` but not enforced), so it sits behind the future sealed-bundle boundary.
- **Flags:** security-adjacent — snapshot records no resolved secret refs and does not bind the host/sandbox the attempt is allowed to run on; ties to the known dispatch env-leak and laptop-bound sandbox findings.

## OperatorAttempt snapshot facade (attempt-facade.ts)
- **What:** Maps a Run to the operator-facing Attempt DTO, returning a `full` snapshot when `attemptSnapshot` exists or reconstructing a `partial-legacy` view (with `missingFields`) from the older `runtime*` columns for pre-037 runs.
- **Where:** `packages/core/src/attempt-facade.ts:5-89`; `OperatorAttemptSnapshot` type `attempt-types.ts:101-107`; tested `tests/attempt-facade.test.ts`.
- **Maturity:** live-core
- **Quality:** solid — honest `legacy`/`completeness`/`missingFields` reporting; status derivation handles all terminal states (`:76-83`).
- **Operator-legibility risk:** none — explicitly surfaces which fields are missing on legacy runs instead of faking a full bundle.
- **Dependencies:** `Run`, `OperatorAttempt`; consumed by api operator-contract mappers.
- **Disposition (recommended):** KEEP — correct, well-bounded legacy-compat shim.
- **Flags:** none

## DB init + inspection (db.ts)
- **What:** Opens the SQLite file (WAL, FK on), runs pending migrations transactionally (FK off for table-rebuild migrations), and inspects DB state (missing / no_schema / empty / has_factory).
- **Where:** `packages/core/src/db.ts:7-72`; rebuild-migration allowlist `:24-31`.
- **Maturity:** live-core
- **Quality:** solid — each migration is one transaction + ledger insert; rebuild list correctly toggles FK enforcement (which cannot change inside a transaction); migration-presence test in `tests/db.test.ts`.
- **Operator-legibility risk:** none
- **Dependencies:** db-migrations.ts; entry point for every package that opens the factory DB.
- **Disposition (recommended):** KEEP — minimal, correct migration runner.
- **Flags:** maintenance — the rebuild allowlist (`:24-31`) is a hand-maintained string list; a future table-rebuild migration that forgets to add its id here would run with FK enforcement on and could fail mid-rebuild.

## File-size grandfather gate (data-model files)
- **What:** The "no file over 300 LOC" gate (`scripts/check-file-size.mjs`) exempts files listed in decision D112 by path; db-migrations.ts and run.ts are exempted.
- **Where:** `scripts/check-file-size.mjs:23` (path-only exemption), `decisions/112-file-size-grandfather-list.md:22,34`.
- **Maturity:** live-peripheral (enforcement tooling)
- **Quality:** fragile — the gate checks only `grandfatherList.paths.has(relPath)`, so a grandfathered file may grow without limit; db-migrations.ts grew 819->1169 LOC (+350) and run.ts 456->501 since the recorded entries, invisible to CI.
- **Operator-legibility risk:** partial — the recorded LOC in D112 no longer matches reality, so the decision doc overstates how contained these files are.
- **Dependencies:** D112 decision list; CI file-size gate.
- **Disposition (recommended):** DECIDE — either cap grandfathered files at their recorded LOC (fail on growth) or accept unbounded growth; current behavior silently erodes the 300-LOC rule for the largest data-model files.
- **Flags:** legacy/process — grandfather exemption is path-only; recorded LOC values are stale (819 vs actual 1169).
