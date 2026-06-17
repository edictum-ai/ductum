# API / HTTP Surface

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The HTTP surface is a Hono app (packages/api/src/app.ts) split into ~25 route-group registrars, mostly thin controllers that delegate to lib/ helpers and repos — a healthy, consistent shape. The current operator model (Project/Repository/Component/Spec/Task/Attempt + Factory Settings) is well covered and live. The runs.ts router is the heavy-traffic core and is large (527 LOC, grandfathered) but solid. Legacy is concentrated and identifiable: targets.ts is a fully-wired Target CRUD surface retired by D169 but never deleted (and still bridged inside repositories.ts), config-resources exposes the retired "resource" verb (though its underlying data is live infra), and a couple of deprecated/unauthenticated run-control endpoints linger.

## Runs router (runs.ts + run-control.ts)
- **What:** The core execution surface: list/get runs, dispatch/accept, complete/fail/cancel/retry, gate-check, evidence, link, approve/approve-rebase/reject, budget+turns extend/deny, reconcile, plus internal authorize-tool / report-tool-success / tokens / reset / harness-session-id.
- **Where:** `packages/api/src/routes/runs.ts:103-470`; `packages/api/src/routes/run-control.ts:12-172`
- **Maturity:** live-core
- **Quality:** solid — thin handlers delegating to `lib/run-ops.ts`, typed evidence validation (`validateEvidencePayload` runs.ts:482), structured 409 conflict envelopes on cancel (runs.ts:332), cost-precheck-before-write on tokens (run-control.ts:103).
- **Operator-legibility risk:** none — returns UI-decorated run DTOs (`decorateRunWithUi`) and structured suggested-actions, not raw state.
- **Dependencies:** `context.enforcement` (per-run EnforcementManager/WorkflowRuntime, D27), `run-ops.ts`, `cancelRun`, `reconcile`; session lifecycle via `context.endSession`/`dispatchTask`.
- **Disposition (recommended):** KEEP — fits the model; the only coupling is dispatcher<->live-session (covered by the session-lifecycle REDESIGN elsewhere, not the HTTP layer).
- **Flags:** `POST /api/runs/:id/resolve-latch` is marked `@deprecated` (run-control.ts:151) and still resets to stage on fail — dead latch concept, REMOVE candidate. runs.ts is 527 LOC (grandfathered oversize per D112).

## Run-control internal endpoints (authorize-tool / plugin-probe)
- **What:** Harness-internal enforcement plumbing under `/api/internal/*`: `authorize-tool` and `report-tool-success` (C3 internal path), `plugin-probe`, plus `/api/runs/:id/reset` and `/api/runs/:id/tokens`.
- **Where:** `packages/api/src/routes/run-control.ts:13-171`; auth bypass at `packages/api/src/middleware/operator-auth.ts:24`
- **Maturity:** live-core
- **Quality:** adequate — authorize-tool/report-tool-success are guarded by a separate session-control token (`requireSessionControl`), correctly honoring C3 (authorize_tool is internal, not operator-token-gated). But `GET /api/internal/plugin-probe` (run-control.ts:162) sits under the blanket `/api/internal/*` operator-auth bypass and only requires a `session_id` query arg — no token at all.
- **Operator-legibility risk:** partial — `reset`/`resolve-latch` act directly on workflow stages with little operator framing.
- **Dependencies:** `lib/session-control.ts`, `lib/run-ops.ts`, EnforcementManager.
- **Disposition (recommended):** REUSE — keep authorize-tool path as-is; tighten/relocate plugin-probe out of the unauthenticated `/api/internal/*` umbrella.
- **Flags:** SECURITY: `/api/internal/plugin-probe` is reachable without the operator token (operator-auth.ts:24 whitelists the whole `/api/internal/` prefix); it is read-only status today but the broad prefix bypass is a latent hole if more `/api/internal/` routes are added.

## Projects router
- **What:** Project CRUD, project-scoped agents assignment (roles), project runs (enriched SQL join), project tasks/specs; onboarding accepts inline `repositories[]` and back-fills the legacy `project.repos` string array.
- **Where:** `packages/api/src/routes/projects.ts:158-346` (raw SQL `listProjectRuns` at :74-156)
- **Maturity:** live-core
- **Quality:** adequate — works and is the canonical top-level entity; carries a 70-line hand-written SQL join and a compatibility `repos` mirror (`repositoryLegacyRef`, projects.ts:213) maintained alongside the real Repository rows.
- **Operator-legibility risk:** none — emits enriched rows with `ui` contract.
- **Dependencies:** `repos.projects/repositories/components/projectAgents`, `dag`, `execution-integrity.ts`, `ui-contract.ts`.
- **Disposition (recommended):** KEEP — core entity; the `repos` string-array mirror is migration sediment to retire once nothing reads `project.repos`.
- **Flags:** legacy `project.repos` dual-write/mirror kept in sync via `syncProjectRepos` (repositories.ts:135) and onboarding (projects.ts:213).

## Repositories / Components router
- **What:** Repository + Component CRUD under projects (the P7/D169 rename of Target). Includes a Target compatibility bridge that surfaces un-migrated Targets as synthetic repositories.
- **Where:** `packages/api/src/routes/repositories.ts:15-104`; bridge in `listRepositoriesWithTargetBridge` (:117-133) and `repositoryWithComponents` fallback (:106-115)
- **Maturity:** live-core
- **Quality:** adequate — the current model surface, but still reaches into `context.repos.targets` to bridge legacy rows (`componentFromTarget`/`repositoryFromTarget`).
- **Operator-legibility risk:** none.
- **Dependencies:** `lib/repositories.ts`, `repos.repositories/components/targets`, `@ductum/core` target-bridge helpers.
- **Disposition (recommended):** KEEP — correct model surface; remove the Target bridge once Target rows are confirmed fully migrated (tie to targets.ts removal).
- **Flags:** legacy coupling to the Target repo/bridge; will need coordinated removal with targets.ts.

## Targets router (legacy)
- **What:** Full Target CRUD (`/api/projects/:id/targets`, `/api/targets/:id`) — the pre-P7 vocabulary renamed to Repository/Component by D169.
- **Where:** `packages/api/src/routes/targets.ts:10-54`; registered at `app.ts:70`
- **Maturity:** legacy-retired
- **Quality:** adequate (code works) but superseded — D169 retired the public `target` CLI verb; no CLI command calls these routes (only `cli/src/types.ts` and test helpers reference the client methods; api-client.ts:81-90 retains dead methods).
- **Operator-legibility risk:** partial — "Target" is now off-model vocabulary that confuses the operator surface.
- **Dependencies:** `repos.targets`, `lib/targets.ts normalizeTargetSpec`; still indirectly used by the repositories.ts migration bridge and spec-intake `resolveTargets`.
- **Disposition (recommended):** REMOVE — retire the route + client methods after confirming no remaining Target rows need the migration bridge; this is exactly the "legacy not deleted" the operator flagged.
- **Flags:** LEGACY: retired by D169 but route still registered (app.ts:70); dead client methods in `cli/src/api-client.ts`.

## Config-resources router (the retired "resource" verb)
- **What:** Generic CRUD for `/api/resources/:kind` where kind ∈ {WorkflowProfile, Model, Harness, SandboxProfile, ...} — backs agent `resourceRefs` (modelRef/harnessRef/etc).
- **Where:** `packages/api/src/routes/config-resources.ts:11-78`; kinds in `lib/config-resources.ts`
- **Maturity:** live-peripheral
- **Quality:** adequate — the underlying config-resource data is live infrastructure (consumed by `resolveAndValidateAgentRuntime` in agents.ts:45 and validated against secrets), but it is exposed under the `resource` noun that D169 retired from the normal operator surface.
- **Operator-legibility risk:** partial — surfaces the off-model "resource" vocabulary the redesign demoted; data should now live behind Factory Settings (Models/Harnesses/Workflows).
- **Dependencies:** `repos.configResources`, `lib/secret-refs.ts`, agent runtime resolution.
- **Disposition (recommended):** REUSE — keep the data/repo (live), but expect this generic `/api/resources/:kind` surface to sit behind the Factory Settings boundary rather than a standalone "resource" route.
- **Flags:** vocabulary drift — `resource`/`resources` is a retired normal surface (D169) even though the data is live.

## Factory + Factory Settings routers
- **What:** Factory get/put, dispatcher status/cycle, cost-budget, operator-brief, execution-integrity, home-view-state, worktree cleanup; plus Factory Settings tree (`/api/factory/settings`, `/api/factory/runtime`, catalogs, secrets).
- **Where:** `factory.ts:18-178`; `factory-settings.ts:10-15` (composes `factory-runtime.ts`, `factory-catalogs.ts`, `factory-secrets.ts`)
- **Maturity:** live-core
- **Quality:** solid — strict field allowlisting (`rejectUnknown`, factory-runtime.ts:110), settings/runtime split with applied/restartRequired result envelopes, budget normalization. Catalog writes intentionally 501 (`rejectP1CatalogWrite`, factory-catalogs.ts:45) — documented P1 stub, not a bug.
- **Operator-legibility risk:** none — operator-brief + execution-integrity are purpose-built legibility surfaces.
- **Dependencies:** `lib/factory-settings*.ts`, `repos.factory/catalogs/runtimeSettings/factoryViewState`, dispatcher hooks (`cycleDispatcher`, `setHeartbeatTimeoutSeconds`).
- **Disposition (recommended):** KEEP — directly implements the D166 Factory Settings model.
- **Flags:** catalog POST/PATCH are deliberate 501 stubs (writes unimplemented since P1) — DECIDE whether to finish or hide them.

## Factory secrets router
- **What:** Encrypted FactorySecret CRUD + test under `/api/factory/secrets`, scope factory|project.
- **Where:** `packages/api/src/routes/factory-secrets.ts:18-90`
- **Maturity:** live-peripheral
- **Quality:** solid — encrypts at rest via `encryptFactorySecret`/`loadFactorySecretKey`, never returns payloads (only metadata), scope validation enforced.
- **Operator-legibility risk:** none.
- **Dependencies:** `@ductum/core` FactorySecret crypto, `repos.secrets`, `context.factoryDataDir`.
- **Disposition (recommended):** KEEP — sound secret-store API. Note (out of HTTP scope): per established audit, this system is wired to notifications but NOT to dispatch env injection — the leak is in claude.ts, not here.
- **Flags:** none in the route itself.

## Specs / Spec-intake / Tasks / Task-sync routers
- **What:** Spec CRUD + dependencies + cascading delete; SpecIntake v1 bulk import (repositories→components→tasks with target/agent resolution); Task CRUD, agent assignment, dependencies (cycle-checked), status/complete with execution-integrity guards; task prompt sync.
- **Where:** `specs.ts:16-168`; `spec-intake.ts:27-195`; `tasks.ts:19-297`; `task-sync.ts:8-23`
- **Maturity:** live-core
- **Quality:** solid — transactional import rollback (specs.ts:103), DAG cycle validation (tasks.ts:146), done-gate requires execution lineage or explicit external outcome (tasks.ts:190, `isPrimaryTaskExecutionIssueCode`), active-run conflict guards.
- **Operator-legibility risk:** none.
- **Dependencies:** `repos.specs/tasks/taskDependencies`, `dag`, `lib/spec-ops.ts`, `execution-integrity.ts`, `task-source-scope.ts`.
- **Disposition (recommended):** KEEP — central to the operator model.
- **Flags:** tasks.ts still accepts/validates `targetId` (tasks.ts:44-53) and spec-intake still threads `targetRef`/`resolveTargets` (spec-intake.ts:168-185) — Target vocabulary lingering in the live import path; REUSE-with-cleanup once Targets removed.

## Agents + Bakeoffs routers
- **What:** Agent CRUD with runtime validation, health/reset, model catalog; Best-of-N bakeoff creation (builders+blind reviewer) and compare/status.
- **Where:** `agents.ts:23-178`; `bakeoffs.ts:16-266`
- **Maturity:** agents live-core; bakeoffs live-peripheral
- **Quality:** solid — agents enforce no-literal-secrets + known-secret-refs (agents.ts:60-61), modelRef/legacy-model mutual exclusion; bakeoffs enforce distinct-model reviewer rules and duplicate-config rejection. Bakeoff is a richer/experimental flow but well-guarded and transactional.
- **Operator-legibility risk:** none.
- **Dependencies:** `lib/agent-runtime-validation.ts`, `model-catalog.ts`, `repos.agents/projectAgents`, `bakeoff-compare.ts`.
- **Disposition (recommended):** KEEP agents; KEEP bakeoffs (DECIDE if Best-of-N is in the current narrow wedge — it is peripheral to process-enforcement).
- **Flags:** none.

## Events (SSE) router
- **What:** Two SSE streams — `/api/events` (global, resumable via last-event-id, enveloped + redacted, with run-failed suggested-actions) and `/api/events/stream` (scoped by run/task/spec/project).
- **Where:** `packages/api/src/routes/events.ts:55-247`
- **Maturity:** live-core
- **Quality:** solid — heartbeat keepalive, abort cleanup on both `stream.onAbort` and request signal, `approval.requested` suppressed from the public stream, suggested-actions built for max-turns failures.
- **Operator-legibility risk:** none — events are normalized and enveloped.
- **Dependencies:** `context.events` bus, `lib/envelope.ts`, `errors-structured.ts`.
- **Disposition (recommended):** KEEP.
- **Flags:** two parallel event endpoints with different shapes — minor duplication; DECIDE whether `/api/events/stream` is still needed.

## Telegram router
- **What:** Telegram approval notifications + webhook (callback approve/deny), status, chat-discovery, test-send.
- **Where:** `packages/api/src/routes/telegram.ts:16-202`
- **Maturity:** live-peripheral
- **Quality:** solid — webhook secret compared with `timingSafeEqual` (telegram.ts:138), outbound errors redacted via `redactPublicText`, server-side token use so the browser never sees the bot token.
- **Operator-legibility risk:** none.
- **Dependencies:** `lib/telegram*.ts`, `lib/telegram-runtime.ts`, notification backend, `context.events`.
- **Disposition (recommended):** KEEP — the one wired notification backend; fits approval-boundary wedge.
- **Flags:** webhook is under the operator-auth bypass (operator-auth.ts:24) but compensates with its own secret-token check — acceptable.

## Welcome-handoff router
- **What:** Mint/exchange one-time welcome handoff token (sets HttpOnly operator cookie) and serve the bundled sample spec for the onboarding wizard.
- **Where:** `packages/api/src/routes/welcome-handoff.ts:16-138`
- **Maturity:** live-peripheral
- **Quality:** solid — TTL + single-use consume semantics, Secure/HttpOnly/SameSite=Strict cookie (:130), structured error envelopes; `/api/internal/welcome/exchange` is bypass-exempt by design but requires a valid minted token.
- **Operator-legibility risk:** none.
- **Dependencies:** `lib/handoff-tokens.ts`, bundled `assets/specs/examples/hello-readme`.
- **Disposition (recommended):** KEEP — onboarding-critical, well-guarded.
- **Flags:** none.

## Search router
- **What:** Cross-entity quick-search (`/api/search`) over projects/specs/tasks/runs/decisions/agents with ranked results and dashboard deep-link URLs.
- **Where:** `packages/api/src/routes/search.ts:55-198`
- **Maturity:** live-peripheral
- **Quality:** solid — parameterized LIKE with proper `ESCAPE '\\'` and metacharacter escaping (`escapeLike`, search.ts:39), no injection surface; bounded to 10 results.
- **Operator-legibility risk:** none.
- **Dependencies:** raw `context.db` queries.
- **Disposition (recommended):** KEEP.
- **Flags:** none (hand-written SQL but parameterized and escaped).

## MCP transport router
- **What:** Per-run HTTP MCP transport at `/api/mcp/:runId` (POST/GET/DELETE) — run identity from URL path, never an arg (D22). Lazily imports optional `@ductum/mcp`.
- **Where:** `packages/api/src/routes/mcp.ts:21-78`
- **Maturity:** live-core
- **Quality:** adequate — verifies run exists, stateless per-request server with teardown; honors C5/D22 (no run_id in args). Builds `apiUrl` from `localhost:${DUCTUM_PORT}` which assumes loopback co-location.
- **Operator-legibility risk:** none (agent-facing, not operator-facing).
- **Dependencies:** optional `@ductum/mcp`, `@modelcontextprotocol/sdk`.
- **Disposition (recommended):** KEEP.
- **Flags:** hardcoded `http://localhost:PORT` self-call (mcp.ts:57) won't survive a non-loopback/remote API host — minor, tied to the laptop-bound sandbox REDESIGN.

## Decisions / Evidence / Attempts (read + append surfaces)
- **What:** Decisions list/create (append-only ADR rows); Evidence + gate-evaluation read-only listing per run; Attempts read-only views (Attempt = run projection).
- **Where:** `decisions.ts:8-34`; `evidence.ts:6-14`; `attempts.ts:8-35`
- **Maturity:** live-core
- **Quality:** solid — thin, typed, read-mostly; Attempt surfaces use `operatorAttemptFromRun` projection so operators see Attempts not raw runs.
- **Operator-legibility risk:** none.
- **Dependencies:** `repos.decisions/evidence/gateEvaluations/runs`, `public-output.ts`.
- **Disposition (recommended):** KEEP — clean model-aligned surfaces.
- **Flags:** none.

## Repair / Task-imports / Dashboard-static (support surfaces)
- **What:** `/api/repair` factory-wide prerequisite/repair report; `/api/tasks/:id/recorded-run` to import external commit lineage as Attempt evidence; static dashboard serving with CSP headers and SPA fallback.
- **Where:** `repair.ts:7-9`; `task-imports.ts:14-45`; `dashboard-static.ts:8-52`
- **Maturity:** repair live-core; task-imports live-peripheral; dashboard-static live-core
- **Quality:** solid — repair delegates to `buildApiRepairReport`; import is idempotent (`alreadyRecorded` → 200); static server sets strict CSP/Referrer/nosniff and guards path traversal via `serveStaticRoot`.
- **Operator-legibility risk:** none — repair is itself a legibility/operator-action surface.
- **Dependencies:** `lib/repair.ts`, `lib/record-imported-task-run.ts`, `@hono/node-server` static.
- **Disposition (recommended):** KEEP all three.
- **Flags:** none.
