# Execution, Harness & Extensibility: The Sealed Job Contract, Scoped Secret Broker, Sandbox Ladder, and Extension SDK

> Ductum redo · pillar design · 2026-06-17

The execution layer keeps its solid moat (in-process authorize_tool / gate_check, D22/D24/D25 session binding, registry+loader, canonical events, REST enforcement transport) and reworks the parts the inventory flags WEAK/REDESIGN: the secret leak, the host-only sandbox, the live-object coupling, and the absence of a stable worker wire contract. The target is a single versioned, schema'd JobBundle that a local in-process worker and a remote worker run identically, produced by one builder and consumed behind one ExecutionBackend interface. The #1 fix is a ScopedSecretBroker that replaces the blanket `...process.env` spread in claude.ts:186 and codex-mcp-config.ts:29 with an allowlisted env materialized at dispatch from the encrypted FactorySecret store, mounted into the worker, and torn down at run end. Sandbox becomes a SandboxDriver interface with a host->container->remote ladder (host shipping now, container next, remote behind the same seam). Extensibility becomes first-class: harnesses, providers, sandbox drivers, and notification backends all register through a typed @ductum/extension-sdk surface with a discovery/registration model, so a third executor is an adapter, not a fork. The dead OpenCode family (7 files + plugin) is deleted as a staged change alongside the DB CHECK-constraint repair.

---

## Target shape

Five seams replace today's tangle of "dispatcher knows how to spawn each harness" + "harness inherits the whole host":

1. **JobBundle** — one versioned, schema'd, content-addressable unit of work. Supersedes today's `AttemptRuntimeSnapshot` (`attempt-types.ts:85`) as the wire contract by adding the 6 runtime-correctness primitives the inventory names (jobAttemptId/idempotency key, content-addressed `repoRef`, lease+fencing token, exactly-once evidence commit handle, `schemaVersion`, explicit cancellation) plus the two missing contract fields (scoped-secret mount handle + declarative allowed-tools).
2. **ExecutionBackend** — the seam between dispatcher and "where the agent runs": `LocalExecutionBackend` (today's in-process path) and a future `RemoteExecutionBackend`, both consuming the identical JobBundle. This is the structural unlock for local->SaaS as a deployment choice (REFERENCE-ARCHITECTURE "Remote Worker Transport" = MISSING).
3. **HarnessAdapter (kept, capability-typed)** — the existing `HarnessAdapter` interface (`dispatcher-support.ts:80`) stays; we add a static `capabilities` descriptor and a `prepareEnv` delegation so adapters stop building env themselves.
4. **SandboxDriver** — generalize `sandbox-runtime.ts` from a hardcoded `'host-worktree'` into a driver interface with `host` (now), `container` (next), `remote` (behind same seam).
5. **ScopedSecretBroker** — dispatch-time resolver that turns an agent's declared `secretAccessRefs` into a minimal env map, sourced from the encrypted `FactorySecretResolver` (`factory-secret-resolver.ts`), and nothing else.

All five register/discover through one **@ductum/extension-sdk** package.

## What changes vs today (mapped to inventory dispositions)

| Inventory item | Disposition | Target disposition in this pillar |
|---|---|---|
| Claude adapter (`claude.ts`) | KEEP | KEEP — but env-building moves out to the broker (fixes :186-188) |
| Codex app-server adapter | KEEP | KEEP — env-building moves out (fixes `codex-mcp-config.ts:29`) |
| Harness registry & loader (`registry.ts`) | KEEP | KEEP — becomes the reference registration for the extension model |
| Authorize-tool/REST boundary (`rest.ts`) | KEEP | KEEP — the C1/C3 transport is the moat, untouched |
| Canonical events / activity-limits | KEEP | KEEP — already the single bounded funnel; reused as the worker->control event contract |
| `codex-sdk` compat alias | DECIDE | COLLAPSE into `codex-app-server` id + drop unused `@openai/codex-sdk@0.118.0` dep; keep an alias map for config back-compat |
| Copilot adapter | REDESIGN | REWORK behind the new contract: fix double-registered `tool.execution_start` (`copilot-sdk.ts:278-292`/:355-365), route cost through ledger (no hard $0), split the 524-LOC file, gate behind explicit opt-in capability |
| OpenCode family (7 files + `plugin/`) | REMOVE | DELETE staged, with the DB CHECK-constraint repair (`db-migrations.ts:30,163`) and the defensive refs in `validate-env.ts:44-48` / `run-control.ts:51` |
| Mock agent adapter in src | REUSE/DECIDE | MOVE behind a `testing` capability flag in the extension model so it cannot load outside test/demo contexts; keep the deterministic-demo value |
| Sandbox runtime (`sandbox-runtime.ts`) | REDESIGN | GENERALIZE to `SandboxDriver` interface; keep the validation discipline (rejecting unimplemented claims is correct), widen the driver set |
| Secrets at dispatch (`claude.ts:186`) | REDESIGN (security) | REPLACE with ScopedSecretBroker — the #1 fix |
| Per-agent `secretAccessRefs` (display stub) | REDESIGN | WIRE to the broker so the displayed refs are the actual injected set |
| Factory secret crypto/resolver/refs/redaction/repo | KEEP/REUSE | KEEP — the resolver is the right primitive, now consumed at dispatch |
| 6-level dispatcher inheritance + 16-arg ctor | REDESIGN | RECOMPOSE to an options object + injected collaborators (the ExecutionBackend takes most of the spawn surface) |
| `activeSessions` Map (non-serializable live objects) | REUSE | RE-HOME behind `LocalExecutionBackend`; the binding data is right, the live-object boundary moves |
| Crash retry = redo from `understand` | REDESIGN | Out of this pillar's core but enabled by it: JobBundle's idempotency key + fencing token are the prerequisites the recovery pillar consumes |

## How this advances the four goals

- **Better shape:** one JobBundle builder + one ExecutionBackend seam collapses the "dispatcher knows every harness" coupling. The 6-level inheritance chain (which exists only to satisfy the 300-LOC rule per `dispatcher-cycle.ts:12` etc.) becomes composition: the spawn/session surface moves into `LocalExecutionBackend`, shrinking the Dispatcher to scheduling + matching.
- **Better UI:** the broker makes the sandbox `boundary` descriptor (`sandbox-runtime.ts:167`) finally *true* — `credentials: 'scoped'` with the named injected refs, so the dashboard Agent panel's `secretAccessRefs` (`AgentSettingsPanel.tsx:111`) stops lying. Run detail can show "this run saw: GITHUB_TOKEN (secret:ci-bot)" instead of an unfalsifiable claim.
- **Autonomous:** identical-bundle local/remote workers + content-addressed `repoRef` + lease/fencing are what let the factory survive a restart and eventually scale off one laptop without a rewrite.
- **Extensible:** harness/provider/sandbox/notification all become registrations against one typed SDK with discovery, so adding a fourth executor or a container backend is an adapter, not a core edit.

## Concrete components

### 1. JobBundle (the sealed worker contract) — `@ductum/core`
Extend the snapshot, do not replace it. New top-level fields on the bundle:
```
schemaVersion: number            // startup compat gate; REFERENCE "Sealed Job Bundle" = PARTIAL
jobAttemptId: string             // idempotency key; retries collapse to one effect
repoRef: { remote, pinnedSha }   // content-addressed, pinned (today repos resolve to a mutable path)
lease: { token: string, fencingToken: number, expiresAt }  // anti split-brain
allowedTools: string[]           // declarative allowlist, today implicit in MCP exposure
secretMount: { refs: SecretRef[] }  // handle, NOT plaintext — resolved by the worker via broker
cancellation: { token: string }  // explicit semantics, replaces ad-hoc kill reasons
```
Built by one `buildJobBundle()` (extending `buildAttemptSnapshot` at `attempt-snapshot.ts:25`), validated against `schemaVersion`. The bundle is what both backends serialize/consume — for `LocalExecutionBackend` it stays in-process; for `RemoteExecutionBackend` it is the wire payload. Plaintext secrets are NEVER in the bundle; only refs.

### 2. ScopedSecretBroker (the #1 security fix) — `@ductum/core`
A dispatch-time service: `materializeEnv(agent, bundle): Record<string,string>`. It:
- reads the agent's declared `secret:<id>` refs (already collected by `collectSecretRefs`, `factory-settings-catalog-helpers.ts:40`),
- resolves each via `FactorySecretResolver` (`factory-secret-resolver.ts:10`),
- returns ONLY those + an explicit minimal allowlist (PATH, HOME, the harness's own required vars from a per-harness `requiredHostEnv` capability descriptor),
- NEVER spreads `process.env`.

`SpawnOptions` (`dispatcher-support.ts:43`) gains a resolved `env: Record<string,string>` field; `claude.ts:186` and `codex-app-server-process.ts:25` consume `options.env` and delete the `...process.env` spread. ANTHROPIC_API_KEY itself becomes a named FactorySecret the broker injects when the harness's capability descriptor declares it needs it — so even the model credential is scoped, not ambient. Egress: the existing `public-redaction.ts` already covers output; the broker closes the input side.

*Scope Rule check:* the dogfood flow that breaks without the broker is "dispatch a Claude run on a repo whose project has a GITHUB_TOKEN secret but the operator's host also has an unrelated STRIPE_KEY exported" — today the agent sees STRIPE_KEY; with the broker it sees only GITHUB_TOKEN. That flow is the seam test.

### 3. SandboxDriver + the host->container->remote ladder — `@ductum/core` + extension SDK
Generalize `PreparedSandboxRuntime` into a `SandboxDriver` interface: `prepare(bundle): PreparedSandbox`, `boundary(): BoundaryDescriptor`, `teardown()`. Keep the validation discipline in `sandbox-runtime.ts` (rejecting unimplemented claims is correct and stays). Ship `host` now (the current worktree driver, refactored behind the interface, zero behavior change). `container` is the next driver (Docker, behind the same seam, declares `network`/`process`/`credentials` boundaries the host driver rejects). `remote` plugs the same interface for a future VM/E2B-style backend. The `resourceSpec: Record<string,unknown>` open map (`sandbox-runtime.ts:31`) is replaced by a typed `SandboxSpec` discriminated on driver, removing the vestigial generic surface.

Clean-room inspiration (concept only, never code): competitor's `SandboxBackend` Protocol with e2b/docker/cloudflare proves the seam shape; we adopt the *interface idea*, not their post-hoc model. Their containment-at-the-sandbox-boundary is *additive* to our tool-call boundary, never a replacement.

### 4. ExecutionBackend seam — `@ductum/core`
```
interface ExecutionBackend {
  capabilities(): BackendCapabilities
  execute(bundle: JobBundle, mcpServer, sandbox): Promise<RunningJob>  // RunningJob ~ today's HarnessSession + lease
  cancel(jobAttemptId, cancellationToken): Promise<void>
  reattach?(bundle): Promise<RunningJob | null>   // gives tryReattach a real home
}
```
`LocalExecutionBackend` owns the `activeSessions` Map (re-homed from the Dispatcher) and the harness adapters. This is where today's `dispatcher-spawn.ts` spawn surface moves, shrinking the inheritance chain. `RemoteExecutionBackend` is MISSING today and stays a stub interface in v1 — but defining the seam now is what makes the bundle a real contract rather than a snapshot.

### 5. @ductum/extension-sdk (registration + discovery) — new package
A thin typed package exporting the four contracts (`HarnessAdapter`, `ProviderDescriptor`, `SandboxDriver`, `NotificationBackend`) plus a `registerExtension()` / discovery model. Built-ins register through it (the existing `registry.ts` becomes the reference harness registration). Discovery model: built-ins are statically registered (no dynamic `require` of arbitrary code in v1 — security: a plugin runs in-process with full trust, so v1 ships a *closed* registry with a typed extension point, NOT a load-from-disk plugin loader). Each registration carries a `capabilities` descriptor the dispatcher matches against the bundle before assignment (REFERENCE "capability negotiation"). The extension SDK is also where the `llms.txt`-style authoring contract lives — a documented, stable surface an agent (or human) can target to write a new adapter.

*Scope Rule check on the SDK:* the dogfood flow that justifies the package is "add a container sandbox driver without editing dispatcher core" — if that requires touching `dispatcher-*.ts`, the seam failed.

## Strangler steps (each routes one real dogfood flow through a new seam)

**S0 — Delete OpenCode (lowest risk, immediate).** Remove `opencode*.ts` (7 files) + `plugin/`, repair the DB CHECK constraints (`db-migrations.ts:30,163`) to the real harness set, drop the defensive refs (`validate-env.ts:44-48`, `run-control.ts:51`). Dogfood flow: `ductum doctor` reports the honest harness list. Drop `@openai/codex-sdk` dep and collapse `codex-sdk` id to an alias.

**S1 — ScopedSecretBroker behind `SpawnOptions.env` (the #1 fix).** Add the broker; route `claude.ts` and `codex-app-server-process.ts` to consume `options.env`; delete both `...process.env` spreads. Dogfood flow: dispatch a real Claude run where the host has an unrelated exported secret and assert (via a test agent that dumps its env to evidence, redacted) it is absent. This seam ships value before any other refactor.

**S2 — SandboxDriver interface, host driver only.** Refactor `sandbox-runtime.ts` behind `SandboxDriver` with zero behavior change; replace `resourceSpec` map with typed `SandboxSpec`. Dogfood flow: existing host-worktree run passes unchanged; `boundary()` now reports `credentials: 'scoped'` truthfully.

**S3 — JobBundle = snapshot + 6 primitives.** Extend `buildAttemptSnapshot` into `buildJobBundle` with `schemaVersion`, `jobAttemptId`, `repoRef.pinnedSha`, `lease`, `allowedTools`, `cancellation`. Add the startup `schemaVersion` compat gate. Dogfood flow: a dispatched run carries a pinned SHA and an idempotency key visible in run detail; a forced double-dispatch of the same `jobAttemptId` collapses to one effect.

**S4 — ExecutionBackend seam + re-home `activeSessions`.** Introduce `LocalExecutionBackend`, move spawn + the session Map into it, recompose the Dispatcher ctor to an options object (kills the 16-arg positional ctor and flattens the inheritance chain). Dogfood flow: a full dispatch->complete->merge runs entirely through `LocalExecutionBackend`; the Dispatcher no longer imports any harness adapter directly.

**S5 — @ductum/extension-sdk + capability descriptors.** Extract the four contracts into the package; built-ins register through it; add `capabilities()` to each adapter and match against the bundle. Dogfood flow: register a container `SandboxDriver` (even a stub that declares `provider:container` and errors on prepare) WITHOUT editing dispatcher core — proves the seam.

**S6 — Container SandboxDriver (real).** First non-host driver. Dogfood flow: run one real task in a Docker sandbox through the identical JobBundle. This is the proof that local and "more-isolated" workers run the same contract.

Each step is independently shippable; S0/S1 deliver security value immediately and depend on nothing later.

## Key decisions (this pillar)

- **Closed typed extension registry vs a load-from-disk plugin loader for v1** — _Ship a CLOSED registry with a typed extension point (built-ins register through @ductum/extension-sdk); do NOT build a dynamic load-arbitrary-code-from-disk plugin loader in v1._. This is a security product (C1-C7). An in-process extension runs with full trust and sits on the authorize_tool path — a malicious or buggy harness plugin could bypass the very moat. The Scope Rule is satisfied by a closed registry: every dogfood flow (add Codex, add container driver) works without arbitrary code loading. A signed/sandboxed plugin loader is a later, separately-justified decision, not a v1 default. Inventory shows the current registry.ts is already KEEP/solid as a closed set.
- **Does the model credential (ANTHROPIC_API_KEY) become a scoped FactorySecret too, or stay ambient?** — _Make it a named FactorySecret the broker injects only when a harness's capability descriptor declares it needs it._. Leaving it ambient re-opens the exact leak we are closing — claude.ts:186 currently passes it because it spreads process.env. If the broker injects everything else but special-cases the API key as ambient, the boundary is still a half-truth and the sandbox descriptor still lies. Treating it as one more scoped secret is uniform and keeps the boundary descriptor honest. Cost: the operator must register it as a secret (a doctor/init-wizard step), which is a one-time onboarding cost worth the correctness.
- **Replace AttemptRuntimeSnapshot or extend it into JobBundle?** — _EXTEND. JobBundle = the snapshot (which already seals ~7/9 fields, REUSE/solid) plus the 6 runtime primitives + 2 missing contract fields._. The snapshot builder and its sealing discipline are rated REUSE/solid and already feed evidence + run detail. A rewrite would throw away working, tested sealing for no gain and violate the strangler mandate. The gap is additive (schemaVersion, idempotency key, pinned repoRef, lease/fencing, allowedTools, secretMount, cancellation), so we add fields and a builder, keeping the snapshot as the inner record.
- **Where does the live activeSessions Map and the spawn surface live after recomposition?** — _Move both into LocalExecutionBackend; the Dispatcher keeps only scheduling/matching/readiness._. The Map holds non-serializable live HarnessSession objects (the central coupling the inventory flags fragile/high-risk). Re-homing it behind the ExecutionBackend seam is what makes a future RemoteExecutionBackend possible and simultaneously flattens the 6-level inheritance chain (which exists only to satisfy the 300-LOC rule). The binding DATA (D22/D24/D25, sole-writer recordSpawnedSession) is correct and moves intact.
- **Container sandbox driver in this redo, or interface-only?** — _Ship the SandboxDriver INTERFACE + host driver now (S2/S5); ship the real container driver as the final proof step (S6), not a v1 blocker._. The Scope Rule says name the dogfood flow that breaks without the abstraction. The interface is justified now because the broker makes the boundary descriptor meaningful and S5's seam-proof needs a second driver to register. But a real Docker driver is significant work (image management, worktree mounting, network policy) and the laptop-dogfood flow runs fine on host today. Sequencing it last keeps every earlier step shippable while still proving the seam holds.

**Dependencies:** DEPENDS ON: the Data-Model/State pillar must own the JobBundle schemaVersion + startup compat gate and the lease/fencing-token storage (the store rejects stale fencing tokens — REFERENCE "Leasing with Fencing Tokens" = MISSING); the Evidence pillar must provide the exactly-once evidence-commit handle the bundle references (today's SqliteEvidenceRepo INSERT is non-idempotent). Reuses: FactorySecretResolver/crypto/refs/redaction (KEEP, already built — just consumed at dispatch now), canonical-events + rest.ts enforcement transport (KEEP, untouched), AttemptRuntimeSnapshot builder (extended). UNBLOCKS: the Recovery pillar's checkpoint/resume (needs the idempotency key + fencing token + pinned repoRef this bundle adds, and the real reattach() home the ExecutionBackend gives tryReattach); the SaaS/remote story (RemoteExecutionBackend behind the same seam); the Cost pillar (a per-harness capability descriptor can declare whether a harness self-reports cost, letting the ledger flag Codex $0 as unmeasured rather than free). The Notifications pillar shares the @ductum/extension-sdk registration model (NotificationBackend is one of the four contracts).

**Risks:** TOP RISKS. (1) Secret broker breaks live dispatch: if any harness silently relied on an ambient host var we drop, runs fail. De-risk: build a per-harness `requiredHostEnv` capability descriptor first, ship the broker in allow-then-warn mode (inject scoped set + log which previously-ambient vars an agent tried to read) for one dogfood cycle, then enforce. (2) Extension SDK over-abstraction: building four pluggable contracts before a second implementation exists for each violates the Scope Rule. De-risk: only extract a contract when S5/S6 names a concrete second impl (container driver, third harness); ship NotificationBackend/Provider contracts as types now but defer their loader until a real second backend lands. (3) Recomposing the dispatcher (S4) is the highest-blast-radius refactor and touches the D22/D24/D25-critical spawn path. De-risk: it is sequenced AFTER the security wins (S0/S1) so a rollback never re-opens the leak; pin the session-binding tests as the conformance gate; move code behind the seam with zero behavior change before adding RemoteExecutionBackend. (4) JobBundle schemaVersion compat gate could reject older in-flight runs on upgrade. De-risk: the gate must read-old/write-new deterministically (REFERENCE explicitly calls for "newer binary reads older state"); add a migration fixture per schemaVersion bump. (5) Deleting OpenCode while DB CHECK constraints still encode 'opencode' could brick existing factories. De-risk: the CHECK-constraint repair migration ships in the SAME staged change as the delete, with a migration test that an existing DB with legacy harness rows upgrades cleanly.
