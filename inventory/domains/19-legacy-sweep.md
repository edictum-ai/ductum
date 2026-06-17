# Legacy & Dead-Code Sweep (cross-cutting)

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The repo is mostly post-D166 clean: the CLI command surface was genuinely purged of run/target/resource/config/operator/queue commands per D169, and no `edictum-console` references remain. The dominant surviving legacy is the Target vocabulary — the `targets` API route, `SqliteTargetRepo`, `config-resources` (resource) route, and their CLI api-client methods all still ship and several are still wired, even though D169 retired these surfaces and the Repository/Component model bridges over Target data. Secondary debt: a half-retired OpenCode harness (code present, not in registry, lingering refs), a drifted file-size grandfather list (41 entries vs 32 actually-oversize files), a dead `resolve-latch` route, misleading `@deprecated` tags on load-bearing latch fields, an orphaned `@ductum/landing` SPA, and ~April-26 pre-redesign top-level docs.

## Target/Repository legacy bridge (API routes + core repo)

- **What:** The renamed-away "Target" vocabulary (D169/P7 → Repository/Component) still ships as a full live surface: `/api/targets` CRUD route, `SqliteTargetRepo`, `target.ts` core repo, and a `targets` DB table. The new Repository route reads Target rows through `listRepositoriesWithTargetBridge` / `repositoryFromTarget` / `componentFromTarget`, so Target is still a live data source, but the standalone `/api/targets` route and `targetCommand`-era API surface are exactly what D169 retired.
- **Where:** `packages/api/src/routes/targets.ts` (whole file, wired at `packages/api/src/app.ts:70`); `packages/core/src/repos/target.ts`; `packages/api/src/routes/repositories.ts:1,109-127` (bridge); `packages/api/src/lib/repositories.ts:45` (`repositoryLegacyRef`); `packages/core/src/db-migrations.ts:540`
- **Maturity:** legacy-retired (surface) / live-core (underlying data bridge)
- **Quality:** adequate — bridge works and is tested (`project-repositories.test.ts:78` "Target-backed tasks through the Repository bridge"), but it keeps two vocabularies alive at once.
- **Operator-legibility risk:** high — D169 says operators should never see Target; the route still answers and CLI still has `getTargets`/`createTarget`.
- **Dependencies:** Repository route depends on Target repo for bridged reads; `spec-intake.ts:181` and `run-ops/accept.ts:90` read `repos.targets`.
- **Disposition (recommended):** DECIDE — the standalone `/api/targets` route + CLI methods are dead-surface REMOVE candidates, but the Target repo/table is still a live bridge data source; decide whether to migrate bridged data into Repository/Component and then delete Target, vs. keep the bridge.
- **Flags:** legacy — direct contradiction of D169 ("`target` … removed rather than hidden"); the public `/api/targets` route is still registered.

## Resource (config-resources) retired surface

- **What:** The "resource" surface D169 retired still ships as `/api/resources/:kind` CRUD, `SqliteConfigResourceRepo`, and `config-resource.ts` core repo. The dashboard only uses it for `NotificationChannel`; the CLI api-client still exposes generic `getResources`/`createResource` with no calling command.
- **Where:** `packages/api/src/routes/config-resources.ts` (wired `app.ts:71`); `packages/core/src/repos/config-resource.ts`; `packages/api/src/index.ts:104`; `packages/dashboard/src/api/client.ts:663-669`; `packages/cli/src/api-client.ts:122-137`
- **Maturity:** legacy-retired (CLI/generic surface) / live-peripheral (notification-channel use)
- **Quality:** adequate — works, but the generic `resources` framing is the retired one; only one kind is actually consumed by UI.
- **Operator-legibility risk:** high — "Resource" is on the explicit do-not-show list (`packages/dashboard/src/lib/repair-areas.ts:5`).
- **Dependencies:** dashboard NotificationChannel settings depend on it; CLI methods depend on nothing.
- **Disposition (recommended):** DECIDE — keep as the notification-channel backing store but rename/narrow off the retired "resource" framing, or fold into Factory Settings; the unused CLI `getResources`/`createResource` are REMOVE.
- **Flags:** legacy — retired vocabulary still public; dead CLI client methods.

## Dead CLI api-client methods (targets/resources)

- **What:** `packages/cli/src/api-client.ts` still carries `getTargets`, `getTarget`, `createTarget`, `updateTarget`, `deleteTarget`, `getResources`, `createResource`, `getResource`, etc., but no file in `packages/cli/src/commands/` calls any of them (the `target`/`resource` commands were deleted per D169).
- **Where:** `packages/cli/src/api-client.ts:81-137`; verified no consumers under `packages/cli/src/commands/`
- **Maturity:** dead-unused
- **Quality:** adequate code, zero callers.
- **Operator-legibility risk:** none — internal, not surfaced.
- **Dependencies:** only the (also-legacy) `/api/targets` and `/api/resources` routes.
- **Disposition (recommended):** REMOVE — orphaned client methods for retired commands; deleting them also reduces the temptation to revive the surfaces.
- **Flags:** legacy/dead — kept the type imports (`Target`, `ConfigResource`) alive in `cli/src/types.ts` too.

## OpenCode harness (half-retired)

- **What:** A full OpenCode adapter (`opencode.ts` plus `opencode-activity/model/probe/rest/usage.ts` and the `plugin/` dir) ships in `packages/harness/src`, but it is NOT in the harness registry and NOT exported from `index.ts`. Lingering references remain in env validation, the migrations CHECK constraint, and dashboard stage colors. This matches the post-source-of-truth backlog item "cleanup incl OpenCode removal."
- **Where:** `packages/harness/src/opencode*.ts`, `packages/harness/src/plugin/`; NOT in `packages/harness/src/registry.ts` (only claude/codex-app-server/codex-sdk/copilot); refs at `packages/api/src/validate-env.ts:44-48`, `packages/core/src/db-migrations.ts:30,163`, `packages/dashboard/src/lib/stage-display.ts:53`
- **Maturity:** legacy-retired (not wired) with dead-unused adapter code
- **Quality:** adequate-but-orphaned — the adapter compiles and is grandfathered for size, but nothing constructs it.
- **Operator-legibility risk:** partial — `validate-env.ts` still warns about `OPENCODE_URL`/"ensure opencode serve is running" for a harness the registry can't load.
- **Dependencies:** referenced by validate-env, migrations ledger (immutable), dashboard color map.
- **Disposition (recommended):** REMOVE — delete the unwired adapter + plugin and the validate-env/dashboard refs; the migrations CHECK constraint must stay (historical ledger).
- **Flags:** legacy — `opencode.ts`/`opencode-*.ts` are still on the file-size grandfather list (debt for code that should be deleted, not split).

## Mock-agent-call adapter (shipped in src)

- **What:** `MockAgentCallHarnessAdapter` is a deterministic stub shipped in production `src`, swapped in for ALL harnesses when `DUCTUM_MOCK_AGENT_CALLS=1`, with a startup warning that it is "only for deterministic bootstrap self-tests."
- **Where:** `packages/harness/src/mock-agent-call-adapter.ts`; gated in `packages/harness/src/registry.ts:60-70` and `packages/api/src/index.ts:180-188`; loader at `packages/api/src/lib/harness-loader.ts:88`
- **Maturity:** experimental / test-fixture-in-src
- **Quality:** adequate — env-gated and warned, not silently reachable.
- **Operator-legibility risk:** partial — a single env var globally replaces real agents with mocks; the warning mitigates but it is a foot-gun in a production binary.
- **Dependencies:** bootstrap self-tests / deterministic demos rely on it.
- **Disposition (recommended):** DECIDE — keep as an intentional bootstrap fixture, or move behind a build flag / dev-only entrypoint so a production binary can't be flipped into all-mock mode via one env var.
- **Flags:** security/legibility — `DUCTUM_MOCK_AGENT_CALLS=1` disables real enforcement-bearing agent execution silently except for one log line.

## Deprecated latch fields & resolve-latch route

- **What:** `ciStatus`/`reviewStatus` on `Run` are tagged `@deprecated "latch system replaced by Edictum stages"`, but they are load-bearing: read by `external-review-gate.ts` (the C6 parallel CI/review gate), set by `dispatcher-spawn.ts`, and rendered across the dashboard. The companion `POST /api/runs/:id/resolve-latch` route, however, has NO dashboard or CLI consumer.
- **Where:** `packages/core/src/types.ts:212-215` (`@deprecated`); live readers `packages/core/src/external-review-gate.ts:94-104`, `packages/core/src/dispatcher-spawn.ts:107-108`, `packages/dashboard/.../HomepageAwaitingBanner.tsx:13-47`, `ApprovalCard.tsx:312-314`, `BakeoffComparePanel.tsx:172`; dead route `packages/api/src/routes/run-control.ts:151` (`@deprecated`)
- **Maturity:** live-core (fields) / dead-unused (route)
- **Quality:** fragile — the `@deprecated` tag is misleading: deleting these fields would break the C6 parallel-latch gate.
- **Operator-legibility risk:** partial — "deprecated" labels on fields the gate depends on can mislead a maintainer into removing them.
- **Dependencies:** external-review-gate / merge gate depend on the fields.
- **Disposition (recommended):** DECIDE — the `resolve-latch` route is a clean REMOVE (no consumers), but the `@deprecated` tags on the still-load-bearing fields should be corrected or removed rather than the fields deleted.
- **Flags:** legacy/bug-risk — stale `@deprecated` annotations on actively-used fields.

## File-size grandfather list drift

- **What:** `decisions/112-file-size-grandfather-list.md` lists 41 grandfathered oversize files, but `scripts/check-file-size.mjs` reports only 32 files actually still over 300 LOC — so ~9 entries were split below threshold but never removed, violating the list's own "Update Rule." Each remaining entry is acknowledged debt.
- **Where:** `decisions/112-file-size-grandfather-list.md` (41 table rows); `scripts/check-file-size.mjs` output: "32 grandfathered files over 300 LOC"
- **Maturity:** legacy-retired (the list as a debt ledger)
- **Quality:** fragile — the exception list has drifted from reality; stale entries silently permit re-growth of already-split files.
- **Operator-legibility risk:** partial — the list overstates outstanding debt and weakens the gate for ~9 paths.
- **Dependencies:** the file-size CI gate reads this decision as its allowlist.
- **Disposition (recommended):** REMOVE (the stale entries) — prune entries whose files are now ≤300 LOC; oversize OpenCode entries should be deleted-with-the-code rather than kept.
- **Flags:** legacy — gate allowlist out of sync with the tree; OpenCode/copilot adapters grandfathered for size despite being retirement candidates.

## Orphaned @ductum/landing package

- **What:** `@ductum/landing` is a standalone React/Vite marketing SPA (with a committed `dist/`) that no API route serves, no CLI references, and no CI/build script builds. It appears to be marketing surface that overlaps `edictum-hub`'s role rather than factory code.
- **Where:** `packages/landing/` (App.tsx, components/, fleet/, dist/); no references in `packages/api/src`, `packages/cli/src`, `.github/`, `scripts/`, root `package.json` beyond the workspace name.
- **Maturity:** dead-unused (within Ductum's runtime) / experimental marketing
- **Quality:** adequate as a standalone SPA, but disconnected from everything else in the repo.
- **Operator-legibility risk:** none — not part of the operator surface.
- **Dependencies:** none inbound; pulls its own React/Tailwind/framer-motion deps into the workspace.
- **Disposition (recommended):** DECIDE — keep as an intentional in-repo landing page, or move to `edictum-hub` and drop it from this workspace (it adds an unused dependency set + committed `dist/` build artifacts).
- **Flags:** legacy — committed `dist/` build output under version control; orphaned workspace member.

## Pre-redesign top-level docs & committed evidence

- **What:** Six root docs (`STATUS.md`, `VISION.md`, `OPEN-QUESTIONS.md`, `HARNESS.md`, `ARCHITECTURE.md`, `CONTEXT.md`) are all dated 2026-04-26, predating the D166 operational-model redesign; CLAUDE.md itself calls these "historical." Separately, `evidence/` has 36 tracked stage-specific review/screenshot artifacts (p0–p7) committed into the repo root.
- **Where:** `STATUS.md`, `VISION.md`, `OPEN-QUESTIONS.md`, `HARNESS.md`, `ARCHITECTURE.md`, `CONTEXT.md` (all Apr-26); `evidence/` (36 git-tracked files, not gitignored)
- **Maturity:** legacy-retired
- **Quality:** fragile — docs describe a pre-D166 model and can mislead; evidence files are point-in-time artifacts with no ongoing role.
- **Operator-legibility risk:** partial — stale architecture/status docs can mis-orient a reader vs. `specs/CURRENT.md`.
- **Dependencies:** CLAUDE.md points current source-of-truth at `specs/CURRENT.md` / post-p9-hardening, not these.
- **Disposition (recommended):** DECIDE — keep as dated historical record (clearly marked) or remove/relocate; the committed `evidence/` artifacts are a REMOVE-or-gitignore candidate.
- **Flags:** legacy — stale pre-redesign architecture docs; review/screenshot evidence committed to the repo root and not gitignored.

## Legacy / dead-but-not-deleted in this domain

- `packages/api/src/routes/targets.ts` — retired "Target" public route, still wired (`app.ts:70`); contradicts D169.
- `packages/api/src/routes/config-resources.ts` — retired "Resource" surface; only NotificationChannel actually consumed.
- `packages/cli/src/api-client.ts:81-137` — `getTargets`/`createTarget`/`getResources`/etc. with no calling command (dead).
- `packages/harness/src/opencode*.ts` + `packages/harness/src/plugin/` — OpenCode adapter not in registry, not exported; lingering refs in `validate-env.ts:44`, `stage-display.ts:53`.
- `packages/api/src/routes/run-control.ts:151` — `@deprecated` `POST /resolve-latch` route with zero dashboard/CLI consumers.
- `packages/core/src/types.ts:212-215` & `post-completion.ts:54` — stale `@deprecated` tags (latch fields are actually load-bearing; `maxReviewRounds` superseded by `maxFixIterations`).
- `decisions/112-file-size-grandfather-list.md` — ~9 stale entries (41 listed vs 32 still oversize).
- `packages/landing/` — orphaned marketing SPA + committed `dist/`, unreferenced by the factory.
- Root `STATUS.md`/`VISION.md`/`OPEN-QUESTIONS.md`/`HARNESS.md`/`ARCHITECTURE.md`/`CONTEXT.md` — pre-D166 historical docs.
- `evidence/` — 36 git-tracked p0–p7 review/screenshot artifacts in repo root (not gitignored).
