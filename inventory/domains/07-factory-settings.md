# Factory Settings & Catalogs

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The Factory Settings read surface is mature and well-shaped: a single declarative model registry (D163) feeds pricing, catalogs, and seed; catalogs are typed, redacted, and assembled from DB ConfigResources; runtime/budget settings have clean validate-before-mutate PATCH handlers with current/desired diffing and restart-impact reporting. The main weaknesses are (1) a split write model — the `/api/factory/*` catalogs are deliberately read-only ("P1 not implemented") while the real CRUD lives on a parallel `/api/resources/:kind` route, so catalog writes are not yet first-class in the operator surface; and (2) live legacy carried forward: a Copilot agent/harness/model path that the model registry does not actually support (provider-type mismatch, no pricing), and a `Target` vocabulary compat bridge left over from the P7/D169 rename. Agent-compatibility validation is genuinely wired into dispatch, not dead.

## Model registry (single declarative source)
- **What:** One data-only `MODEL_REGISTRY` list plus typed lookup helpers; D163 names it the sole owner of pricing, scanner rates, and catalog metadata, with three previously-duplicated tables derived from it. Strict alias-aware resolution returns `null` for unknown ids rather than silently inheriting another model's price.
- **Where:** `packages/core/src/model-registry.ts:1-145`, `packages/core/src/model-registry-data.ts:1-214`
- **Maturity:** live-core
- **Quality:** solid — exact/loose index dedup, date-suffix normalization, explicit `unmeasured` semantics; rates sourced and dated (LAST_VERIFIED_AT 2026-06-13).
- **Operator-legibility risk:** none — labels, notes, sourceUrl, and availability are human-facing.
- **Dependencies:** consumed by `factory-seed`, `model-pricing`, `factory-settings` catalog builder, and agent-runtime validation.
- **Disposition (recommended):** KEEP — clean single-source design that already eliminated the drift it was built to fix.
- **Flags:** `ModelProvider` union is only `openai|anthropic|zai`; the Copilot seed path injects `provider: 'github-copilot'`, which has no registry entry (see Copilot legacy entry).

## Model pricing (compute + OpenRouter live cache)
- **What:** Derives per-1M `MODEL_PRICING` from the registry, fetches OpenRouter live list pricing once at dispatcher startup, and computes per-run cost (flat and cache-aware) at the persistence boundary. Harness-reported costs are intentionally ignored.
- **Where:** `packages/core/src/model-pricing.ts:1-271`
- **Maturity:** live-core
- **Quality:** solid — three-layer resolution (per-agent override → live → registry), negative-input clamping, one-time missing-model warning, `null`/0 as explicit unmeasured signal.
- **Operator-legibility risk:** partial — a run showing `$0` cost means "unmeasured model," which an operator must infer from logs/state rather than an explicit surfaced reason.
- **Dependencies:** registry; called by dispatcher/run cost flow and budget gates.
- **Disposition (recommended):** KEEP — correct and well-documented; only the grandfather note needs cleanup.
- **Flags:** legacy — listed in `decisions/112-file-size-grandfather-list.md:49` at 329 LOC but is now 271 LOC; the grandfather entry is stale and should be dropped.

## Factory Settings catalog builder
- **What:** `buildFactorySettingsCatalogs` assembles the full Factory Settings view (Providers/Models/Harnesses/Workflows/Agents/Sandboxes/Notifications/Budgets/Runtime) from DB ConfigResources + Agents, enriching each from the registry and redacting public spawn config.
- **Where:** `packages/core/src/factory-settings.ts:54-292`, types in `packages/core/src/factory-settings-types.ts:1-274`
- **Maturity:** live-core
- **Quality:** solid — pure mapping, provider derivation with model counts, built-in workflow preset merged in; per-resource `kind` guards keep mappers total.
- **Operator-legibility risk:** none — every record is a typed, named DTO with scope/source.
- **Dependencies:** model-registry, public-redaction, catalog-helpers; surfaced by `/api/factory-settings` and the CLI `factory settings` command (read-only display).
- **Disposition (recommended):** KEEP — this is the canonical Factory Settings read model and fits the current operator model.
- **Flags:** none

## Agent-compatibility validation (validate-before-dispatch)
- **What:** `assertFactorySettingsAgentCompatible` rejects agent configs whose provider/providerModelId/harness combination is incompatible per the registry (provider mismatch, unsupported harness). Throws a typed `FactorySettingsValidationError`.
- **Where:** `packages/core/src/factory-settings-validation.ts:1-67`; wired at `packages/api/src/lib/agent-runtime-validation.ts:95`; mapped to an HTTP error in `packages/api/src/lib/errors.ts:75`.
- **Maturity:** live-core
- **Quality:** adequate — genuinely invoked at dispatch time (not dead, despite appearing only in tests at first grep); skips validation for unknown harness types and unknown models, so it is a guard, not a gate.
- **Operator-legibility risk:** none — error messages name the agent, model id, provider, and harness.
- **Dependencies:** registry; runs inside the dispatch agent-runtime resolution path.
- **Disposition (recommended):** KEEP — correct validate-before-mutate semantics on the dispatch path.
- **Flags:** none

## Factory runtime / budget settings PATCH handlers
- **What:** GET/PATCH for Factory Settings (name, mergeMode, heartbeat, budgets) and Factory Runtime (bind host/port, urls, dispatcher, worktree), with unknown-field rejection, current/desired diffing, and `affectedRuntimes`/`restartRequired` reporting.
- **Where:** `packages/api/src/routes/factory-runtime.ts:35-188`, builder logic in `packages/api/src/lib/factory-settings-api.ts:35-272`
- **Maturity:** live-core
- **Quality:** solid — strict allow-list per surface, non-negative budget validation, positive heartbeat validation, persisted-vs-running reconciliation; budget changes applied live to the in-memory `costBudget`.
- **Operator-legibility risk:** partial — `restartRequired`/`affectedRuntimes` is surfaced structurally, but understanding which knob needs which restart still leans on operator interpretation.
- **Dependencies:** factory + runtimeSettings repos, dispatcher status callbacks.
- **Disposition (recommended):** KEEP — clean validate-before-mutate write path that fits the current model.
- **Flags:** none

## Factory catalog routes (read-only, writes stubbed)
- **What:** `/api/factory/providers` + 5 catalog list routes serve the read model; every POST/PATCH on these routes throws `NotImplementedError("not implemented in P1 Factory Settings foundation")`.
- **Where:** `packages/api/src/routes/factory-catalogs.ts:18-47`, mounted via `factory-settings.ts:13` and `app.ts:66`
- **Maturity:** live-peripheral
- **Quality:** adequate — reads are clean; writes are deliberate 501 stubs, so the operator-facing catalog surface is read-only while the real CRUD lives elsewhere (see config-resources route).
- **Operator-legibility risk:** partial — an operator hitting POST `/api/factory/models` gets a "not implemented" error and must know to use `/api/resources/:kind` instead.
- **Dependencies:** `context.repos.catalogs`; parallels the config-resources CRUD route.
- **Disposition (recommended):** REDESIGN — the capability (catalog writes under the Factory Settings surface) is needed but is currently a P1 stub split from the real write path; the two surfaces should converge.
- **Flags:** legacy/dual-surface — two write models for the same catalog data (`/api/factory/*` stub vs `/api/resources/:kind` live).

## Config resource CRUD route + spec normalization
- **What:** `/api/resources/:kind` is the actual create/update/delete surface for Models/Harnesses/WorkflowProfiles/SandboxProfiles/NotificationChannels, with per-kind spec normalization and literal-secret rejection.
- **Where:** `packages/api/src/routes/config-resources.ts:11-78`, `packages/api/src/lib/config-resources.ts:1-144`
- **Maturity:** live-core
- **Quality:** solid — strict per-kind required-field validation, literal-secret scanning on commands/credentials/config, env-reference enforcement for accessRef/secretRefs, secret-ref existence checks before write.
- **Operator-legibility risk:** partial — this is the lower-level `resource`/`kind` vocabulary the redesign moved away from in normal surfaces; an operator must know it backs the Factory Settings catalogs.
- **Dependencies:** configResources + secrets repos; consumed by the catalog builder.
- **Disposition (recommended):** REUSE — sound, security-conscious foundation, but it should sit behind the Factory Settings catalog boundary rather than being its own operator-facing surface.
- **Flags:** legacy vocabulary — `resource`/`kind` surface retired from normal operator flows but still the live write path; security-positive (literal-secret scanning is good).

## Initial factory seed
- **What:** `seedInitialFactoryDatabase` transactionally creates the Factory + default Project + root Repository/Component, seeds the full model catalog from the registry, four built-in harnesses, a workflow profile, a worktree sandbox profile, and optional provider agent sets (anthropic/codex/copilot).
- **Where:** `packages/core/src/factory-seed.ts:1-287`
- **Maturity:** live-core
- **Quality:** adequate — single transaction, idempotency guard against an existing factory; but it seeds a Copilot path the registry does not support.
- **Operator-legibility risk:** none — produces named records.
- **Dependencies:** registry, all seed repos.
- **Disposition (recommended):** REUSE — correct shape for bootstrapping a factory, but the Copilot seed branch should be pruned.
- **Flags:** legacy — `InitialFactoryAgentProvider` includes `'copilot'`; `copilotModel()` seeds `provider: 'github-copilot'` (not a `ModelProvider`) with `harness: 'copilot-sdk'`, so copilot models seed without a registry entry, no pricing, and a provider-type mismatch — matches the post-source-of-truth "cleanup incl OpenCode/Copilot removal" backlog item.

## Operator contract types / mappers / errors
- **What:** Public operator DTOs (`Operator*` records), spec-intake contract with a runtime guard that rejects generated Attempts, and pure mappers from domain records to operator DTOs. Re-exports the Factory Settings DTOs as part of the public contract.
- **Where:** `packages/core/src/operator-contract-types.ts:1-270`, `operator-contract-mappers.ts:1-153`, `operator-contract-errors.ts:1-98`
- **Maturity:** live-core
- **Quality:** solid — mappers are total/pure, `assertSpecIntakeContainsNoAttempts` walks unknown input with cycle protection, errors carry structured `PublicContractIssue`s with human labels and suggested actions.
- **Operator-legibility risk:** none — contract issues are explicitly human-readable.
- **Dependencies:** types, attempt-facade, repository-model.
- **Disposition (recommended):** KEEP — clean public boundary; only the Target bridge inside it is legacy (see below).
- **Flags:** legacy — still imports/uses `Target` and `repositoryFromTarget`; `operatorRepositoryFromTarget` (`operator-contract-mappers.ts:36`) is a compat shim from the P7/D169 Repository rename, exported and used in `api/src/lib/operator-contract.ts:14`; `SpecIntake*` types still carry `targetRef` fields (`operator-contract-types.ts:187,196,218`).

