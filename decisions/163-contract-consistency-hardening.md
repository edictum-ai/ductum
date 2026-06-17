---
date: 2026-05-23
status: accepted
deciders: operator (Arnold Cartagena), Claude (Opus 4.7)
related: 053, 062, 135, 145, 161, 162
---

# ADR 0163: Contract Consistency Hardening

## Status

Accepted.

P0 audit only. Implementation lands in P1-P5 of
`specs/current/contract-consistency-hardening/`. No runtime code changed in
this prompt.

## Decision

For each duplicated truth identified below, one package is named canonical
owner. Other packages re-export, derive from, or render the owner's shape —
they do not fork it.

### 1. Run UI DTO — owner: `@ductum/api/lib/ui-contract`

Canonical type: `RunUiContract` (with `schemaVersion: 'ductum.ui.run.v1'`)
and `buildRunUiContract()` in `packages/api/src/lib/ui-contract.ts`.

Duplication confirmed:

- `packages/dashboard/src/api/client.ts` re-declares `RunUiContract`,
  `UiTone`, and `RunUiStatusKey` as a parallel interface. The two
  declarations are structurally aligned today by hand.

Plan:

- Dashboard imports the DTO via the typed client surface. P1 extracts the
  shared interface into a small contracts module (re-exported by both
  packages) so the declaration site is single. No new dependency.

### 2. Run status presentation — owner: `@ductum/core/run-display`

Canonical: `DisplayStatus`, `deriveDisplayStatus()`, `DISPLAY_STATUS_LABEL`,
`countByDisplayStatus()` in `packages/core/src/run-display.ts`. API uses it
to build `RunUiContract.status`.

Duplication confirmed:

- `packages/dashboard/src/lib/derived-status.ts` redefines the same enum,
  label map, and derive function. The dashboard variant has *extra*
  branches (`stage === 'failed'`, `stage === 'stalled'`) that the core
  function does not — this is a silent fork.
- `packages/dashboard/src/components/signal/helpers.ts#statusOf` adds yet
  another path including `blocked`, `reviewing`, `watching`, `fixing` that
  is not in the canonical enum.
- `packages/dashboard/src/lib/run-presentation.ts` re-implements label and
  tone fallbacks parallel to `buildRunUiContract`.

Plan:

- Dashboard reads `run.ui.status` as the primary source. Local derivation
  is removed except as a documented compatibility fallback gated on
  `run.ui == null`. P1 collapses the fork; the extra signal kinds
  (`reviewing`, `watching`, `fixing`, `blocked`) either move into the
  canonical `DisplayStatus` (with API support) or are dropped — they
  cannot remain dashboard-only without an owner.
- `DISPLAY_STATUS_CLASSES` stays in the dashboard (Tailwind presentation),
  but keyed on the canonical `DisplayStatus`.

### 3. Run cost display / unmeasured state — owner: `@ductum/core` + `@ductum/api/lib/ui-contract`

Canonical: cost classification (`measured` | `pending` | `unmeasured`)
lives in `buildRunUiContract.runCost` against the run's persisted
`costUsd`, `tokensIn`, `tokensOut`, `stage`, `terminalState`.

Duplication confirmed:

- `packages/dashboard/src/lib/run-presentation.ts#runCost` re-implements
  the exact same precedence (usd > 0 → measured, hasTokens → measured /
  '<$0.01', live → pending, else unmeasured). The two formulas are
  byte-identical by hand today.

Plan:

- Dashboard reads `run.ui.cost` directly and removes the parallel
  formula. `formatCost()` stays in dashboard as presentation only.
- Unknown-model cost is never silently substituted: `lookupPricing()`
  returns `null` for unknown ids, the dispatcher records `costUsd = 0`,
  and the UI contract surfaces `state: 'unmeasured'`. This is the
  documented behavior for the `gpt-5.5` class of bugs; P2 adds a
  conformance test that proves an unknown model never inherits another
  model's price.

### 4. Model pricing / catalog / scanner — owner: `@ductum/core/model-registry` (P2 to create)

Three sources of truth exist today, each keyed by model id:

- `packages/core/src/model-pricing.ts` — `MODEL_PRICING` (cache-unaware
  per-1M USD, fallback when OpenRouter live cache is empty).
- `packages/core/src/cost-scanner.ts` — `CODEX_RATES` and `CLAUDE_RATES`
  (cache-aware per-token, codexbar-verified, used by both the local-log
  scanner and the cache-aware delta path).
- `packages/api/src/lib/model-catalog-data.ts` — `MODEL_CATALOG` (model
  list returned to the dashboard, with its own `pricing` floats, harness
  availability, effort sets, and source URLs).

Adding a model today requires three independent edits. The `gpt-5.5`
"unmeasured" regression was caused by exactly this drift.

Plan:

- P2 creates `@ductum/core/model-registry` as the single declarative
  registry. Entries carry: id, aliases, provider, availability,
  supportedHarnesses, supportedEfforts, cache-aware per-token rates
  (scanner shape), cache-unaware per-1M rates (derived from per-token),
  defaultCostTier, sourceUrl.
- `MODEL_PRICING`, `CODEX_RATES`, `CLAUDE_RATES`, `MODEL_CATALOG` are all
  derived from this registry. The catalog endpoint maps over it.
- Unknown ids are explicit `unmeasured` — no prefix-match fallback to an
  unrelated model. The current prefix-match in `lookupPricing` is
  preserved only when the prefix is the same model family (validated by
  the new test).
- OpenRouter live pricing still overrides the static table at runtime;
  the static fallback is replaced, not removed.

### 5. External API input parsers — owner: `@ductum/api/lib/parsers` (P3 to create)

Duplication confirmed:

- `packages/api/src/routes/specs.ts` and `routes/tasks.ts` cast strings
  to `never` for several enum-typed fields (`status`, `complexity`,
  `requiredRole`, dependency `kind`). Enum membership is enforced
  inline in tasks.ts but not in specs.ts.
- Each route re-implements its own validation against typed-but-unchecked
  string sets. Spec import validates tasks with a manual loop including
  `typeof t.name !== 'string'` checks. None of this is shared.

Plan:

- P3 introduces `parseSpecStatus`, `parseTaskStatus`, `parseComplexity`,
  `parseRequiredRole`, `parseDependencyKind`, plus a small
  `parseImportedTask` helper. Each returns the typed enum or throws
  `ValidationError`. `as never` casts on request bodies are removed.
- No new dependency. The existing `optionalString` / `requireString`
  helpers stay; the new parsers compose on top of them.
- Scope is limited to the routes the spec calls out plus any that share
  the same enums. We do not rewrite every route.

### 6. Harness session / event contracts — owner: `@ductum/core` (canonical), `@ductum/harness` (re-exports)

Duplication confirmed:

- `HarnessSession`, `HarnessSessionResult`, `HarnessAdapter`,
  `HarnessKillReason`, `SpawnOptions`-adjacent shapes exist in BOTH
  `packages/core/src/dispatcher-support.ts` and
  `packages/harness/src/types.ts`. The two declarations are kept aligned
  by hand. The harness file extends the core shape with
  `HarnessEvent` and `TokenUsageDelta`, which exist only in harness.

Plan:

- Canonical home is `@ductum/core` because the dispatcher boundary owns
  the spawn/kill/reattach contract. The current import direction
  (`@ductum/harness` already depends on `@ductum/core`) makes this
  acyclic.
- P4 deletes the duplicated declarations from
  `packages/harness/src/types.ts` and re-exports from `@ductum/core`.
  `HarnessEvent` and `TokenUsageDelta` move to a new
  `@ductum/core/harness-events.ts` so both sides reference the same
  union (D162 already requires non-null `harnessSessionId` on
  `session.started`; that requirement carries over verbatim).
- The harness package keeps adapter implementations (`claude`,
  `codex-sdk`, `codex-app-server`, `opencode`, `copilot-sdk`,
  `mock-agent-call-adapter`); they import the contract from core.

### 7. Conformance tests — owner: `@ductum/core/tests/contracts` plus per-package conformance suites (P5)

No cross-cutting conformance suite exists today. D162 already named the
need; this decision schedules the work.

Plan (P5):

- **UI contract conformance:** snapshot tests that exercise
  `buildRunUiContract` on every `DisplayStatus` × cost-state pair. A
  parallel test asserts that the dashboard renders the same labels and
  tones from a fixed `RunUiContract` payload without re-deriving.
- **Model registry parity:** test that every entry in the registry has
  scanner rates and catalog metadata in lockstep (no entry can have
  catalog pricing but missing scanner rates, or vice versa). Test that
  an unknown model produces `state: 'unmeasured'` end-to-end.
- **Harness adapter telemetry conformance:** each adapter must emit
  `session.started` with a non-empty `harnessSessionId` before any
  `cost.updated` or `tool.*` event. Mock + real adapters share the
  fixture.
- **Route DTO conformance:** mutating run endpoints (`approve`, `reject`,
  `retry`, `cancel`) return a `RunUiContract`-decorated run, asserted by
  a shared route test helper.

## Reason

D162 closed the immediate `gpt-5.5` symptom but explicitly named four
boundary-discipline problems: API↔dashboard DTO drift, harness↔API
session id drift, pricing-scanner↔run drift, runtime↔UI state drift.
This decision converts those into named owners so each subsequent
prompt has one place to land its change.

The single thread through every duplication is *additive maintenance
without an owner*. A new model means three table edits. A new run
status means two enum forks. A new harness adapter means re-aligning
two interface declarations. Each of those independent edits is a future
drift bug. Naming an owner per shape removes the per-edit coordination
tax and lets a conformance test catch the rest.

Interfaces are not the goal. One owner per externally consumed shape
is the goal — exactly as the spec README states.

## Consequences

- P1 collapses run UI DTO and run-status presentation. Dashboard loses
  some local types but gains a single source of truth.
- P2 creates the model registry. The three existing tables become
  derived views; the registry is the only place where adding a model
  requires an edit. Unknown models become explicitly `unmeasured`,
  which is a behavior change for any code that today depends on the
  silent prefix-match fallback.
- P3 removes `as never` casts at API request boundaries for the named
  enums. Some routes will reject inputs that previously slipped through
  with stage-mismatched values — that is the intended behavior.
- P4 collapses the harness contract duplication. The harness package
  stops declaring its own `HarnessSession` / `HarnessAdapter`. Existing
  adapters need one import-line edit each.
- P5 adds conformance suites. CI runtime grows modestly; drift detection
  is now executable, not implicit.
- No new dependency is added. Supply-chain posture is preserved
  (exact pins, frozen lockfile).
- The 300-LOC file-size gate is preserved. The new modules
  (`model-registry`, `harness-events`, `lib/parsers`) are split before
  they cross the limit if needed.

## Non-Goals

- No database schema change.
- No schema-validation dependency (zod, valibot, ajv, etc.) added by
  default. If P3 demonstrates a real need, that is a separate decision.
- No rewrite of every route, page, or harness adapter — only the
  surfaces named here.
- No change to Ductum workflow semantics or @edictum/core embedding.
- No new public dashboard pages.

## Inspection Notes (audit evidence)

Files inspected for this audit and the concrete duplications they
contain. Used as the inventory for P1-P5.

- `packages/api/src/lib/ui-contract.ts` — canonical `RunUiContract`.
- `packages/dashboard/src/api/client.ts` lines 121-138 — parallel
  `RunUiContract` / `UiTone` / `RunUiStatusKey` declaration.
- `packages/core/src/run-display.ts` — canonical `DisplayStatus`.
- `packages/dashboard/src/lib/derived-status.ts` — forked
  `DisplayStatus` enum and `deriveDisplayStatus` with extra stage
  branches; forked `DISPLAY_STATUS_LABEL`.
- `packages/dashboard/src/components/signal/helpers.ts` — third
  status taxonomy with non-canonical kinds (`reviewing`, `watching`,
  `fixing`, `blocked`).
- `packages/dashboard/src/lib/run-presentation.ts` — parallel cost
  classification and tone fallback.
- `packages/core/src/model-pricing.ts` — `MODEL_PRICING` per-1M table
  + OpenRouter live cache.
- `packages/core/src/cost-scanner.ts` — `CODEX_RATES`, `CLAUDE_RATES`
  per-token cache-aware tables.
- `packages/api/src/lib/model-catalog-data.ts` — `MODEL_CATALOG` with
  its own pricing floats per model.
- `packages/api/src/routes/specs.ts` — `as never` casts on spec status
  and ad-hoc task validation in `/specs/import`.
- `packages/api/src/routes/tasks.ts` — `as never` casts on task
  status, complexity, requiredRole, assignedAgentId, targetId.
- `packages/core/src/dispatcher-support.ts` — canonical-from-core
  declarations of `HarnessSession`, `HarnessSessionResult`,
  `HarnessAdapter`, `HarnessKillReason`, `ReattachContext`.
- `packages/harness/src/types.ts` — parallel declarations of the same
  shapes, plus the only home for `HarnessEvent` and
  `TokenUsageDelta`.
- `packages/harness/src/claude.ts` — adapter that consumes the harness
  package's local copy of the contract.
