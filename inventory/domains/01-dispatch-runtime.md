# Dispatch & Runtime

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The dispatch chain is functionally mature and central to the factory: it polls ready tasks, matches agents, spawns governed harness sessions, binds session->run authoritatively (D22/D24/D25 honored), and routes completion/crash/stall outcomes. Code is well-factored into small files (all <=300 LOC, none grandfathered) and the @edictum/core runtime split (D27) is clean. The two structural weaknesses match the prior audit: (1) the dispatcher couples to live, non-serializable HarnessSession objects via an in-process activeSessions Map plus a 6-level inheritance chain and a 16-arg positional constructor, and (2) spawn inherits the full host process.env into agents (secrets leak in claude.ts). Recovery is "retry the whole task from understand"; heartbeat-stalls never auto-retry. One concrete dead-code item: the OpenCode adapter (7 files) is present in harness/src but not registered, pending staged removal per the backlog.

## Poll/dispatch cycle
- **What:** The core loop: `start()` sets a poll interval; each `tick()` runs `cycleOnce()` (single-flight guarded), which checks stalled runs, runs periodic worktree cleanup, then dispatches up to the available concurrency slots from `taskRepo.getReady()` honoring retry backoff.
- **Where:** `packages/core/src/dispatcher-base.ts:104-119` (start/stop/poll), `dispatcher-cycle.ts:13-96` (cycleOnce/cycle/runManagedCycle), `dispatcher-base.ts:121-139` (status).
- **Maturity:** live-core
- **Quality:** solid — single-flight `inFlightCycle` guard prevents overlapping cycles; per-task try/catch isolates failures; `AgentRuntimeResolutionError` correctly marks the task failed rather than looping. `now()` is injectable for deterministic tests.
- **Operator-legibility risk:** partial — `status()` exposes a clear `reason` string for the disabled case, but mid-cycle skip reasons (busy eligible agent, worktree contention) are silent and only inferable from logs.
- **Dependencies:** `taskRepo.getReady()`, `DAGEvaluator`, agent matching, `resolvedConfig.maxConcurrentRuns`; drives `dispatch()`.
- **Disposition (recommended):** KEEP — the loop shape is sound and fits the current model.
- **Flags:** none

## Agent matching & health gating
- **What:** `matchAgent` resolves an assigned agent or picks by role + cost tier (cheapest for normal, priciest for complex), skipping agents busy in `activeSessions` or marked unhealthy. Health is an in-memory sliding-window failure counter that trips a cooldown after 3 recoverable failures in 10 min.
- **Where:** `dispatcher-cycle.ts:98-137` (matchAgent/hasBusyEligibleAgent), `dispatcher-agent-health.ts:1-81`, `dispatcher-base.ts:167-201` (recordAgentFailure/shouldSkip).
- **Maturity:** live-core
- **Quality:** adequate — recoverable-failure classification is a regex list (`dispatcher-agent-health.ts:7-21`) that can drift from real harness error strings; health state is process-memory only, lost on restart (acceptable for a cooldown).
- **Operator-legibility risk:** partial — `getAgentHealth()` surfaces structured state, but a task silently stalls in the queue when its only agent is in cooldown with the reason only in warn logs.
- **Dependencies:** `agentRepo`, `projectAgentRepo.getByRole`, `activeSessions`.
- **Disposition (recommended):** KEEP — fits the model; the regex list is the only soft spot.
- **Flags:** legacy-adjacent: recoverable-failure detection is string-pattern based, fragile to harness wording changes.

## Dispatch & session spawn (D22/D24/D25 binding)
- **What:** `dispatch()` resolves runtime agent/workflow/sandbox, creates the Run + AttemptSnapshot, prepares the worktree/sandbox, composes the system prompt, spawns the harness session, and binds it. `recordSpawnedSession` is the *sole* writer of `sessionMappingRepo.create`, keyed by run.id; agents never pass run_id.
- **Where:** `dispatcher-spawn.ts:46-164` (dispatch), `:170-202` (prepareSpawnRuntime), `:257-296` (recordSpawnedSession — D25 sole owner), `dispatcher-support.ts:162-209` (buildDispatcherSystemPrompt).
- **Maturity:** live-core
- **Quality:** solid — D22/D24/D25 constraints honored in code: session key is run.id, mapping created only here, control-token minted per session. Failure path closes the MCP server and marks the run stalled. AttemptSnapshot is built twice (pre- and post-worktree) to seal working dir.
- **Operator-legibility risk:** none — failures surface as run failReason + stalled state.
- **Dependencies:** harness adapter `spawn()`, `sessionMappingRepo`, `worktreeManager`, sandbox-runtime, agent-prompt-runtime; the spawned session feeds `handleSessionEnd`.
- **Disposition (recommended):** KEEP — binding is correct and authoritative.
- **Flags:** none in binding; see Secrets-into-spawn and activeSessions entries for the coupling/security issues that intersect here.

## In-process activeSessions map (dispatcher<->live-session coupling)
- **What:** `activeSessions: Map<RunId, ActiveDispatchSession>` holds the live, non-serializable `HarnessSession` (with `waitForCompletion()`), adapter, agent, and per-run MCP server. It is the single source of "what is running now" used by matching, contention checks, heartbeats, stall GC, and teardown.
- **Where:** `dispatcher-base.ts:53` (the Map), `dispatcher-types.ts:8-15` (ActiveDispatchSession shape), `dispatcher-spawn.ts:275-276` (populate), `dispatcher-session.ts:17-41,140-187` (consume), reconcile rebuilds it at `dispatcher-reconcile.ts:198-206`.
- **Maturity:** live-core
- **Quality:** fragile — this is the real coupling the prior audit flagged: live session objects cannot be serialized, so all running state evaporates on process exit and must be reconstructed via reattach. Everything that needs "is this run live" depends on this in-memory Map, not the DB.
- **Operator-legibility risk:** high — after a crash/restart, the truth of "what's running" lives only in memory until reconcile runs; an operator reading the DB cannot tell live from orphaned without it.
- **Dependencies:** `HarnessSession` lifecycle; reattach reconciler; heartbeat refresh.
- **Disposition (recommended):** REUSE — the binding data is right, but the live-object-in-memory boundary is what a future session-lifecycle redesign should sit behind; keep the code, expect re-homing.
- **Flags:** legacy/architecture: non-serializable session objects in process memory are the central coupling; matches the established "session lifecycle is REUSE/REDESIGN" finding.

## 6-level inheritance chain + 16-arg constructor
- **What:** The Dispatcher is assembled as `DispatcherBase -> DispatcherRuntime -> DispatcherCycle -> DispatcherSession -> DispatcherSpawn -> Dispatcher`, with a single base constructor taking ~16 positional params (5 optional) plus a config object.
- **Where:** `dispatcher-base.ts:46,65-102` (abstract base + ctor), chain declarations at `dispatcher-runtime.ts:24`, `dispatcher-cycle.ts:12`, `dispatcher-session.ts:16`, `dispatcher-spawn.ts:28`, `dispatcher.ts:30`; construction site `packages/api/src/index.ts:286-289` (positional repos/managers).
- **Maturity:** live-core
- **Quality:** fragile — the file-splitting (each layer <=300 LOC) keeps the size rule but encodes a deep `protected`-method inheritance instead of composition; the positional ctor at the call site (`dag, runRepo, taskRepo, agentRepo, projectAgentRepo, specRepo, projectRepo, stateMachine, watcherManager, sessionMappingRepo, harnessAdapters, eventEmitter, ...`) is easy to mis-order and hard to extend.
- **Operator-legibility risk:** none — internal only.
- **Dependencies:** every dispatch capability is a method on this chain; the API server is the only constructor caller.
- **Disposition (recommended):** REDESIGN — capability is needed but the shape (deep inheritance + positional 16-arg ctor) is the structural smell; a single options object / composition would be lower-risk. Not urgent.
- **Flags:** legacy-shape: the abstract-layer chain exists mainly to satisfy the 300-LOC file rule, not domain modeling.

## Session-end routing & completion fallback
- **What:** `handleSessionEnd` is the single funnel for every exit (completed/crashed/timeout/failed/paused-*). It de-dups via `handledSessionEnds`/`finishingRuns`, applies D114/D118 pause semantics, records cost, routes completed runs into the post-completion pipeline, and cleans up worktrees. A 1s `completionFallback` timer forces routing if `ductum.complete` teardown doesn't fire a session end.
- **Where:** `dispatcher-session.ts:43-138` (handleSessionEnd + scheduleCompletionFallback), `dispatcher-types.ts:27` (1000ms delay), `dispatcher-worktree-cleanup.ts` (failed-worktree cleanup), `dispatcher-harness-failure.ts` (failure evidence).
- **Maturity:** live-core
- **Quality:** solid — careful guarding against double-routing; pause exits produce operator-actionable failReason strings (e.g. "Operator: inspect with ductum status ... then ductum retry ..."). The fallback timer is a pragmatic safety net for harnesses that don't cleanly signal completion.
- **Operator-legibility risk:** partial — the pause messages are excellent, but the 1s fallback firing is only visible as a warn log.
- **Dependencies:** `PostCompletionRouter`, `stateMachine`, `runRepo`, cost scanner; consumes `activeSessions`.
- **Disposition (recommended):** KEEP — robust outcome handling that fits the model.
- **Flags:** none

## Worker-death recovery (stall/crash retry)
- **What:** `retryOrFailStalledTask` is the recovery policy. Crash/timeout exits re-queue the whole task to `ready` with backoff (max 3 retries) producing a *fresh* Run at stage `understand` with a fresh worktree. Heartbeat-stalls (P3 policy) do NOT auto-retry — the task is marked failed. Stale slots and orphans are GC'd separately.
- **Where:** `dispatcher-session.ts:209-258` (retryOrFailStalledTask, markDispatchStalled), `:140-187` (checkStalled/heartbeat refresh/gcStaleSlots), `dispatcher-stale-slot-gc.ts`.
- **Maturity:** live-core
- **Quality:** fragile — "retry = redo the entire task from understand" discards all prior evidence and worktree progress; there is no evidence checkpoint and no atomic gate_check+evidence write, so a crash mid-stage loses everything. Heartbeat-stall having no auto-retry is a deliberate but asymmetric policy.
- **Operator-legibility risk:** partial — retry/fail decisions are logged with reasons, but the operator must read logs to learn a heartbeat-stall will not retry.
- **Dependencies:** `taskRepo` retry counters, `dag.evaluateTaskDAG`, worktree cleanup.
- **Disposition (recommended):** REDESIGN — matches the established "retry the whole thing" finding; recovery granularity is the gap, not correctness of the current path.
- **Flags:** logic/robustness: no evidence checkpoint; crash loses worktree progress; heartbeat-stall and crash have divergent retry behavior.

## Startup orphan reconcile / reattach (D121)
- **What:** On boot, `reconcileOrphanedSessions` walks every active run and either reattaches to its live harness session (via `adapter.tryReattach` keyed on persisted harnessSessionId) or marks it stalled with a stable, greppable reason. Idempotent; records redacted reconcile evidence.
- **Where:** `dispatcher-reconcile.ts:82-184` (reconciler), `:29-32` (stable reason constants), `dispatcher.ts:36-59` (Dispatcher wiring), `dispatcher-support.ts:64-106` (ReattachContext/HarnessAdapter.tryReattach contract).
- **Maturity:** live-core
- **Quality:** solid — D27 preserved (each reattached run gets its own MCP server), output is redaction-aware (`redactPublicText`), stale mappings are dropped so a retry won't rebind a dead session id, and adapters without `tryReattach` degrade to "stalled" cleanly.
- **Operator-legibility risk:** none — stalled reason strings are stable and shown verbatim in `ductum status`.
- **Dependencies:** `harnessAdapters.tryReattach`, `sessionMappingRepo`, rebuilds `activeSessions`.
- **Disposition (recommended):** KEEP — mature, security-conscious recovery surface.
- **Flags:** none

## Runtime resource resolution (Agent -> Model/Harness/Sandbox/Workflow)
- **What:** Resolves an agent's `resourceRefs` (modelRef/harnessRef/sandboxRef/workflowProfileRef/systemPromptRef) against `ConfigResourceRepo` into concrete runtime values, validates specs, redacts sensitive sandbox spec keys, and seals everything into evidence + the Run snapshot.
- **Where:** `agent-runtime-resolution.ts:55-285` (resolution + ref scoping + sandbox redaction), `dispatcher-runtime.ts:25-213` (per-dispatch resolution, evidence recording, workflow materialization), `agent-prompt-runtime.ts:16-92` (path-traversal-guarded system-prompt loading).
- **Maturity:** live-core
- **Quality:** solid — thorough error taxonomy (`AgentRuntimeResolutionErrorCode`), project-vs-factory scoping with ambiguity/cross-project guards, sandbox-snapshot key redaction (`SENSITIVE_SNAPSHOT_KEY_PATTERNS`), and a strict relative-path/realpath jail on systemPromptRef. This is the live backing for Factory Settings (Models/Harnesses/Sandboxes/Workflows), not the retired user-facing "resource/seed" surface.
- **Operator-legibility risk:** none — resolution failures produce precise messages naming the agent, field, ref, and resource.
- **Dependencies:** `ConfigResourceRepo`, `specRepo`/`projectRepo` for project scope; feeds spawn + AttemptSnapshot.
- **Disposition (recommended):** KEEP — solid and current; the `resourceRefs`/`ConfigResource` vocabulary here is the internal store, not the retired surface.
- **Flags:** terminology watch: uses `resource`/`resourceRefs` internally — correct here, but easy to conflate with the retired user-facing resource/seed CLI surface during cleanup.

## Secrets inherited into spawned agents
- **What:** When building the Claude session options, the spawn path spreads the entire host `process.env` into the agent's environment, then layers the agent's own spawn env on top.
- **Where:** `packages/harness/src/claude.ts:186-190` (`env = { ...process.env, ...agent.spawnConfig.env, ... }`); reached from `dispatcher-spawn.ts:155` (`adapter.spawn(...)`).
- **Maturity:** live-core
- **Quality:** broken (security) — every dispatched agent inherits all host environment variables, including unrelated API keys/tokens. The encrypted `FactorySecret` system exists but is wired only to notifications, never into this dispatch env, so there is no scoping boundary.
- **Operator-legibility risk:** high — the operator cannot see, from any surface, which secrets a given agent run was exposed to.
- **Dependencies:** harness adapter spawn; intersects the dispatch->spawn path.
- **Disposition (recommended):** REDESIGN (security) — dispatched agents need a scoped, allowlisted env sourced from FactorySecret, not a blanket `process.env` inheritance. Matches the established security finding.
- **Flags:** security: full host env leak into agent processes; FactorySecret not on the dispatch path.

## Stale-slot GC & heartbeat refresh
- **What:** Each cycle refreshes heartbeats for live sessions (via `adapter.isAlive`), GCs DB-active runs that have no live slot and a stale heartbeat (>2x timeout), and protects active + budget-paused runs from worktree cleanup.
- **Where:** `dispatcher-session.ts:140-207` (checkStalled/refreshLiveSessionHeartbeats/gcStaleSlots/cleanupStaleWorktrees), `dispatcher-stale-slot-gc.ts:19-44`.
- **Maturity:** live-core
- **Quality:** adequate — sound divergence-healing between DB-active and in-memory-live state, with workflow-owned runs and finishing runs correctly excluded; the 2x-timeout heuristic is a magic constant in `dispatcher-stale-slot-gc.ts:43`.
- **Operator-legibility risk:** partial — auto-closed slots emit a `slot.auto_closed` event but the count is otherwise a warn log.
- **Dependencies:** `activeSessions`, `runRepo.getActive`, `worktreeManager`.
- **Disposition (recommended):** KEEP — necessary divergence reconciliation; only the bare constant is a minor smell.
- **Flags:** none

## Legacy / dead-but-not-deleted in this domain
- **OpenCode harness adapter (dead-unused):** `packages/harness/src/opencode.ts` plus 6 support files (`opencode-rest.ts`, `opencode-model.ts`, `opencode-activity.ts`, `opencode-usage.ts`, `opencode-probe.ts`, and tests) ship in src but are NOT registered in `packages/harness/src/registry.ts` (only claude-agent-sdk, codex-app-server, codex-sdk, copilot-sdk, mock are registered). `specs/current/post-p9-hardening/post-source-of-truth-backlog.md:196,212` lists "OpenCode removal as a real staged cleanup, not an immediate safe-delete." Disposition: REMOVE (staged). Still referenced defensively in `packages/api/src/validate-env.ts:44-48` and `routes/run-control.ts:51`.
- **Mock agent-call adapter shipped in src (live-peripheral, env-gated):** `packages/harness/src/mock-agent-call-adapter.ts` is wrapped into real adapters only when `DUCTUM_MOCK_AGENT_CALLS=1` (`registry.ts:57`, `api/src/index.ts:180-187`). Not dead, but a test-only adapter living in the shipped package. Disposition: DECIDE — keep for deterministic demos/tests vs. move out of the production harness path.
- **No grandfathered dispatcher files:** every file in this domain is <=300 LOC and none appear in `decisions/112-file-size-grandfather-list.md`; the file-splitting is the *cause* of the 6-level inheritance chain (see that entry).

