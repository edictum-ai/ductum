# Workflow Model & DAG

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The workflow-model domain is the live core that turns a per-repo WorkflowProfile YAML into an @edictum/core WorkflowDefinition, materializes it into a sealed per-run snapshot, resolves it at runtime, and drives the spec/task DAG. The profile→render→materialize→resolve pipeline is solid and well-validated (empty verifyCommands hard-fail, typed snapshot errors, regex allowlists). Two real flags: (1) the codebase actively calls runtime.recordResult() in enforce.ts:267, directly contradicting the D28 "never call recordResult()" constraint in CLAUDE.md — either the constraint is stale or the code drifted; (2) workflow-renderer.ts ships three dead functions, and task-scope.ts still carries a live legacy "target" / "legacy-repos" compatibility branch tied to the retired Target vocabulary (P7/D169). The DAG evaluator and task-lineage parser are mature and heavily depended on.

## WorkflowProfile parse + render (workflow-renderer.ts)
- **What:** Parses `.edictum/workflow-profile.yaml` into a typed `RepoWorkflowProfile` and renders the workflow template into an @edictum/core YAML definition, injecting read-gates, verify-command allowlists, and protected-branch push patterns as regex conditions.
- **Where:** `packages/core/src/workflow-renderer.ts:29-146` (parse/render), regex builders `:191-214`; consumed by `workflow-definition-resolver.ts:67`.
- **Maturity:** live-core
- **Quality:** solid — strict validation (empty `required_files`/`verify.commands` throw `:45-50`), post-render placeholder leak check (`:124-126`), regex escaping for shell/branch patterns; but carries three dead helpers.
- **Operator-legibility risk:** partial — render failures surface as opaque "could not render" strings up the resolver chain; regex allowlist patterns are not operator-readable.
- **Dependencies:** `@edictum/core` `loadWorkflowString`; relies on the template file and the profile YAML; relied on by the resolver and the materialization path.
- **Disposition (recommended):** KEEP — fits the current model and is the source of profile→definition truth. Delete the three dead helpers separately.
- **Flags:** legacy/dead — `renderVerifyExitGates` (`:161`), `collectContextFiles` (`:181`), `buildAllowedVerifyPattern` (`:191`) are defined but never called anywhere in `packages/**/src`; dead since verify gates moved to the materialized command path.

## WorkflowProfile materialization + sealed snapshot (workflow-profile-runtime.ts)
- **What:** Resolves an Agent's `workflowProfileRef` into a `RunWorkflowProfileSnapshot`, then validates/seals the materialized snapshot (renderedWorkflow + setupCommands + verifyCommands), hard-failing dispatch when `verifyCommands` is empty.
- **Where:** `packages/core/src/workflow-profile-runtime.ts:50-78` (`requireMaterializedWorkflowProfile`, empty-verify hard-fail `:71-76`); materialized at dispatch via `dispatcher-runtime.ts:187` / `dispatcher-spawn.ts:53`.
- **Maturity:** live-core
- **Quality:** solid — every malformed field raises a typed `AgentRuntimeResolutionError('resource_malformed')`; this is one of the ~7-of-9 sealed-bundle fields noted in the prior audit.
- **Operator-legibility risk:** none — errors are descriptive and name the offending profile.
- **Dependencies:** `agent-runtime-resolution.ts`; consumed by dispatcher-runtime, resolver, watchers/base, api accept/factory-settings.
- **Disposition (recommended):** REUSE — sound foundation; part of the sealed job bundle that will sit behind a future job-bundle boundary.
- **Flags:** none

## WorkflowDefinition resolver (workflow-definition-resolver.ts)
- **What:** Resolves the active `WorkflowDefinition` for a run, preferring the sealed run snapshot, then project profile, then a fallback workflow optionally patched with a repository-specific guidance read-gate.
- **Where:** `packages/core/src/workflow-definition-resolver.ts:32-125`; `withUnderstandGuidanceGate` `:127-145`.
- **Maturity:** live-core
- **Quality:** adequate — clean precedence and per-profile-path caching; but `withUnderstandGuidanceGate` rewrites only the gate whose condition is the exact string `file_read("README.md")` (`:135`), a brittle string match that silently no-ops if the template wording changes.
- **Operator-legibility risk:** partial — falls back to a default workflow silently when project/spec/task lookups return null (`:40-43`), with no surfaced reason.
- **Dependencies:** run/task/spec/project/repository repos, renderer, profile-runtime; relied on by enforcement/runtime resolution.
- **Disposition (recommended):** KEEP — correct precedence matches DB-as-truth model; consider hardening the README string match.
- **Flags:** legacy — fragile exact-string gate match at `:135`.

## Recorded-success stage auto-advance (workflow-recorded-success.ts)
- **What:** After a tool result is recorded, loops forward through stages, advancing when exit gates pass, approvals are satisfied, and the next stage's entry gates pass; strictly forward-only.
- **Where:** `packages/core/src/workflow-recorded-success.ts:7-91`; invoked from `enforce.ts:271`.
- **Maturity:** live-core
- **Quality:** adequate — forward-only guard (`isForwardStage` `:86-91`) prevents accidental regression; refuses to advance a stage with no exit gates and no approval (`:49-51`).
- **Operator-legibility risk:** partial — advancement emits `workflow_stage_advanced` events but a blocked advance returns silently with no reason.
- **Dependencies:** `@edictum/core` `WorkflowRuntime.evaluateWorkflowGates/setStage/state`; relied on by `enforce.ts`.
- **Disposition (recommended):** KEEP — fills the gap that `recordResult` alone does not advance stages.
- **Flags:** legacy/constraint — this helper exists *because* `recordResult` does not auto-advance, yet `enforce.ts:267` calls `runtime.recordResult(...)` directly, contradicting the D28 rule in CLAUDE.md ("Never call recordResult()"). Either D28 is stale or the code drifted; operator should reconcile.

## Tool-arg path/command normalization + scope guard (workflow-tool-args.ts)
- **What:** Normalizes file-path tool args to run-relative paths (symlink-aware) and validates that Read/Write/Edit/Glob/Grep paths and Bash commands stay inside the run working directory.
- **Where:** `packages/core/src/workflow-tool-args.ts:21-141`; consumed by `enforce.ts` and enforce tests.
- **Maturity:** live-core
- **Quality:** solid — symlink-aware base resolution (macOS `/tmp`→`/private/tmp`), recursive arg walking, escape-aware out-of-base detection (`:91-98`).
- **Operator-legibility risk:** none — scope-violation reasons are explicit and name tool + keyPath + value.
- **Dependencies:** `path-resolution.ts`, `workflow-command-scope.ts`; relied on by enforce.
- **Disposition (recommended):** KEEP — a real local enforcement primitive (C2-aligned).
- **Flags:** none

## Spec/Task DAG evaluator (dag.ts)
- **What:** Topologically resolves task readiness from task dependencies, propagates failure, gates specs on hard spec-deps, drives spec status transitions on run completion, and detects cycles for validation.
- **Where:** `packages/core/src/dag.ts:16-295` (`DAGEvaluator`); `evaluateTaskDAG` `:26`, `validateDAG` `:109`, `onRunComplete` `:77`, cycle finder `:233`.
- **Maturity:** live-core
- **Quality:** adequate — Kahn-style cycle detection is correct; fixpoint loop is bounded by status convergence. Has a special-case branch for bakeoff blind-review tasks (`:175-179`) coupling generic DAG logic to a niche feature. Worker-death recovery is "retry the whole thing" (re-queue at understand), consistent with the prior audit's REDESIGN finding.
- **Operator-legibility risk:** high — task/spec status flips emit events but the *reason* a task is blocked vs ready vs failed requires reading dependency state; no surfaced explanation.
- **Dependencies:** task/spec/dependency/run repos, event emitter, `bakeoff.ts`; relied on broadly by dispatcher/post-completion.
- **Disposition (recommended):** REDESIGN — capability is essential and correct, but recovery semantics (whole-task retry, no evidence checkpoint) and bakeoff coupling warrant rework; aligns with the established worker-death-recovery finding.
- **Flags:** bug-risk — `onRunComplete` uses only `getLatestRun` (`:228-231`, last array element) to decide done/failed; ordering assumptions on `runRepo.list` could misclassify if runs are not append-ordered.

## Task scope resolution (task-scope.ts)
- **What:** Resolves a Task to a `{repository, component}` scope via three sources in priority order: explicit task repository/component ids, a legacy `Target`, or legacy `repos[]` name matching with a synthetic local repository fallback.
- **Where:** `packages/core/src/task-scope.ts:21-95`; `'target'` branch `:24-32`, `legacy-repos` + synthetic `:48-95`.
- **Maturity:** legacy-retired (partially) — the explicit `'task'` source is current; the `'target'` and `'legacy-repos'` branches are pre-P7/D169 compatibility paths.
- **Quality:** adequate — correct ownership validation (`:39-41`), multi-repo ambiguity guards; but synthesizes a fake `legacy:`-id repository (`:76-95`) to keep old tasks working.
- **Operator-legibility risk:** partial — a task silently resolving via `target`/`legacy-repos`/synthetic repo is invisible to the operator unless they read `source`.
- **Dependencies:** `repository-model.ts` (`repositoryFromTarget`/`componentFromTarget` adapters), repository/component/target/spec repos; relied on by `dispatcher-spawn.ts` and `api/run-ops/accept.ts`.
- **Disposition (recommended):** REUSE — keep the explicit `'task'` path; the `'target'`/`'legacy-repos'` branches should be carved out behind a one-time migration boundary and eventually removed once Target is gone.
- **Flags:** legacy — `TaskScopeSource = 'task' | 'target' | 'legacy-repos'` (`:6`) and the synthetic `legacy:`-prefixed repository keep retired Target/repos vocabulary alive in the live dispatch path.

## Task lineage parser (task-lineage.ts)
- **What:** Parses/classifies task names into impl/review/fix lineage roles and rounds, using `requiredRole` as the authoritative disambiguator over raw name prefixes.
- **Where:** `packages/core/src/task-lineage.ts:23-80`.
- **Maturity:** live-core
- **Quality:** solid — deliberately uses `requiredRole` to avoid misclassifying spec-imported tasks named `review-*`/`fix-*` (`:59-69`); well-documented intent.
- **Operator-legibility risk:** none — pure deterministic name parsing.
- **Dependencies:** none inbound; depended on by the entire post-completion router chain, dispatcher, CLI status, dashboard task-kind, api bakeoff/followup.
- **Disposition (recommended):** KEEP — small, correct, central to the review/fix lineage model.
- **Flags:** none

## Harness workflow hint (harness/workflow-hint.ts)
- **What:** Fetches a run's workflow state from the API and builds an advisory prompt block (stage order, current stage, allowed tools, required reads) injected into the agent prompt.
- **Where:** `packages/harness/src/workflow-hint.ts:12-44`; operator-token header `:46-55`.
- **Maturity:** live-peripheral
- **Quality:** adequate — fail-open (returns '' on any error `:18-22`), placeholder-token guard prevents leaking dummy tokens. By design this is advisory only (C2: not enforcement).
- **Operator-legibility risk:** none — hint is human-readable prompt text.
- **Dependencies:** API `/runs/:id/workflow` endpoint, `DUCTUM_OPERATOR_TOKEN`; consumed by the harness prompt builder.
- **Disposition (recommended):** KEEP — useful advisory surface; correctly not treated as enforcement.
- **Flags:** none — note it is advisory (C2), must not be mistaken for a gate.

## .edictum/workflow-profile.yaml (repo profile)
- **What:** Ductum's own dogfood WorkflowProfile: required reads (README/CLAUDE), setup (`pnpm install`, `native:deps`), verify (`pnpm build`, `pnpm test`), protected branch `main`, git/PR allowlist.
- **Where:** `/Users/acartagena/project/ductum/.edictum/workflow-profile.yaml`.
- **Maturity:** live-core (data, not code)
- **Quality:** solid — matches the parser schema; non-empty required_files and verify.commands satisfy the hard-fail validators.
- **Operator-legibility risk:** none — declarative and readable.
- **Dependencies:** consumed by `workflow-renderer.ts` parser.
- **Disposition (recommended):** KEEP — canonical onboarding artifact (the ductum-onboard skill emits this shape).
- **Flags:** none — a stale duplicate exists at `.claude/worktrees/floating-wondering-swing/.edictum/workflow-profile.yaml` (worktree artifact, not source of truth).
