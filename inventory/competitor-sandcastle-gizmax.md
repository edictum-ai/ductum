# Competitor deep-dive — gizmax/Sandcastle

> **License caution.** Sandcastle is **BSL 1.1** (non-production use only; production requires a paid commercial license; converts to Apache-2.0 on 2030-02-24). Derivative works are subject to BSL. This document is **competitive intelligence and concept-level inspiration only** — do NOT copy or port its code into Ductum (a commercial product). Implement any adopted ideas clean-room. Not legal advice.

*Deep-dive 2026-06-16, against the repo cloned read-only at /tmp/sc-dd.*

---

## Verdict

**Occupies Ductum/Edictum's runtime-structural-enforcement wedge?** `no`

**Strategic verdict:** KEEP building Ductum/Edictum. The core reason: three independent dimension reports (architecture-shape, harness-executor, enforcement-depth), each citing code, converge that Sandcastle's governance is post-hoc output filtering + step-level DAG gates + sandbox isolation — it explicitly delegates (Claude, via bypassPermissions) or skips (other providers, via direct execSync) the per-tool-call authorization-before-side-effect that is Edictum's entire wedge. Sandcastle is the adjacent lane done well, not your lane done better. Do not stop. Harden the wedge and steal their onboarding/proof-of-execution DX.

**Reasoning:** The operator likes Sandcastle's shape and nice things, and that admiration is warranted — but shape and DX are not the wedge. The decisive test is whether Sandcastle authorizes each agent tool call against a fail-closed policy BEFORE the side effect, and gates stage advancement on validated, unbypassable evidence. The evidence is unambiguous that it does not: (1) PolicyEngine evaluates COMPLETED output at executor.py:2105-2177 — the side effect already happened, and the block action even redacts secrets out of output that already exists (policy.py:193-204); (2) the only per-tool gate, should_pause_for_approval, is an explicitly unimplemented dry-run (executor.py:4328-4335) while the real computer-use loop executes every tool_use immediately (executor.py:6894-6914); (3) for Claude it runs permissionMode:"bypassPermissions" (runner.mjs:46) and for other providers it execSyncs tool calls with no authorization (runner-openai.mjs:132-181). Gates/approvals are DAG nodes judged by an LLM or a human click (executor.py:5662, 2316), not validated structural evidence at a boundary the agent cannot bypass; ordering is depends_on topological scheduling (dag.py:542), not process enforcement. What genuinely differentiates Ductum/Edictum survives intact: in-process fail-closed per-tool authorization (authorize_tool), evidence-gated stage advancement (gate_check) where evidence is validated not LLM-judged, the C1-C7 structural constraints (agents cannot self-reset, cannot pass run_id, harness intercepts at the infrastructure level), and the cross-language SDK + conformance-fixture parity story that Sandcastle has no analogue for (it is a single Python service). What does NOT differentiate Ductum and should be honestly conceded: Sandcastle's onboarding floor, cost intelligence, template/cassette proof system, dashboard breadth, and agent-authoring docs are ahead of where an early factory typically is — those are real, copyable, and worth copying. The risk is not that Sandcastle eats the wedge; it is that Sandcastle's polish makes Ductum look unfinished to anyone evaluating on DX rather than enforcement semantics. The move is to keep the enforcement moat, close the DX gap with their patterns, and be able to articulate in one sentence why post-hoc output filtering + sandbox isolation is categorically weaker than authorize-before-side-effect for the threat model of an agent that ignores instructions (the WhatsApp-evidence premise behind C2). One caveat for intellectual honesty: a determined competitor could add a real per-tool interceptor later — the should_pause_for_approval scaffolding shows they have considered it — so the differentiation is a current-state fact, not a permanent moat. Speed and depth on the enforcement semantics, plus the cross-SDK parity story, are what keep it defensible.

### Did they build their own harness or reuse?
Hybrid: reuse for Claude, build-their-own for everyone else. Claude steps REUSE Anthropic's official @anthropic-ai/claude-agent-sdk query() (runner.mjs:8) — the Claude Code engine — shipped into a sandbox and run to completion with permissionMode:"bypassPermissions" (runner.mjs:46). Every non-Claude provider runs Sandcastle's OWN hand-rolled OpenAI-compatible agentic loop (runner-openai.mjs) with three tools (bash/read_file/write_file) that execSync directly with no authorization. They also wrap several non-sandbox runtimes (Anthropic Managed Agents REST, direct Ollama, in-process Python claude-agent-sdk, customer self-hosted sandbox). An agent step is not one LLM call — it runs an autonomous multi-turn loop inside an external sandbox (E2B default / Docker+seccomp / Cloudflare Workers), so isolation lives at the sandbox boundary, not the tool-call boundary.

### How do they do auth?
Conventional and light. API keys only — HMAC-SHA256 with a pepper (api/auth.py) — no JWT and no OAuth, and AUTH_REQUIRED defaults OFF in local mode. The audit trail is a SHA-256 hash-chained AuditEvent log (audit.py:18-43): tamper-EVIDENT but UNSIGNED (no signing key or external anchoring), so it is integrity-checkable logging rather than non-repudiable attestation, and it is audit, not enforcement. There is no documented secrets-management or data-residency story beyond region tags on providers — though data-residency IS enforced in the executor (get_alternatives at providers.py:445 drops region-mismatched failover candidates and fails rather than cross an EU/US boundary), which is the one genuinely structural security property they ship.

### Things Sandcastle has that Ductum lacks (clean-room inspiration only)
- True zero-config local start with a clean scale-up ladder: empty DATABASE_URL/REDIS_URL auto-selects SQLite + in-process queue + filesystem, with auto-add-missing-columns so no migration step is needed locally (db.py:942-953, 1019-1028; config.py:114-138). `sandcastle init` wizard + `doctor` diagnostics exist. Markedly lower onboarding floor than a mandatory Postgres+Redis stack.
- The .sctpl verified-template cassette system — the most distinctive asset. Record a run once, replay offline at $0, keyed on sha256(tenant:workflow:step_id:model:resolved_prompt) with two tamper traps (manifest checksum + cache-key mismatch). Doubles as deterministic zero-cost testing infra AND as proof-of-execution for distributed templates. Directly applicable to Ductum's spec/attempt evidence story.
- llms.txt / llms-full.txt as a first-class agent-authoring artifact: a tight one-page index plus the full step schema so an LLM can author valid workflows without reading the repo. Ductum's agents would benefit from an equivalent authoring contract.
- tool-examples-convention.md: a connector-author contract citing MEASURED eval gains (tool-selection accuracy 49%->74% with tool-search subsetting; parameter-shape accuracy 72%->90% with 1-5 worked examples per tool). A disciplined, evidence-backed pattern for tool definitions.
- Cost intelligence from a single source-of-truth PROVIDER_REGISTRY (providers.py:33) with real per-model pricing and region tags, surfaced as per-template estimated_cost_per_run and per-run forecasts. A real cost model, not a badge.
- Data-residency enforced in the executor, not advisory (providers.py:445 / Spark autoroute refuses to flip when residency=eu) — a clean example of structural routing enforcement Ductum could mirror for provider/region constraints.
- race step = first-valid-wins failover across providers that also propagates approval gates into branches (executor.py:5383-5513) — clean provider-neutral resilience pattern.
- Pluggable backends behind Protocols (SandboxBackend = e2b/docker/cloudflare; StorageBackend = local/s3) so the same engine runs laptop-local or cloud with no code change.
- A genuinely large, real dashboard (29 pages incl. onboarding wizard + a live no-backend demo at gizmax.github.io/Sandcastle) — evidence that a polished operator UI is table stakes.

---

## Full report

## Competitive deep-dive: gizmax/Sandcastle vs Ductum/Edictum

### Bottom line up front
Sandcastle is an impressive, polished, broad workflow orchestrator. It does **not** occupy Ductum/Edictum's wedge. Three independent dimension reports (architecture-shape, harness-executor, enforcement-depth) reached the same conclusion from different angles, each with code citations: Sandcastle gates *steps* and filters *outputs*, it does not authorize *individual agent tool calls before the side effect*. The wedge holds. Keep building — but steal aggressively from their DX.

### What Sandcastle actually is (shape)
A YAML-DAG workflow orchestrator: FastAPI + arq/Redis-or-in-process queue + APScheduler + Postgres-or-SQLite, executing a topologically-sorted graph of ~25 typed step kinds. Core primitives are **workflows -> steps -> runs -> run_steps** (`models/db.py:69-708`, `dag.py:487-515`). An "agent" is just one of ~25 step *types*, not a first-class governed primitive. The executor is one 8,746-line dispatch file (`executor.py`) — a large central loop, not a small composable enforcement core.

### The wedge question — decisively adjacent
Edictum's wedge is runtime, structural enforcement: an in-process interceptor authorizes **every tool call against a fail-closed policy before the side effect**, and stage advancement requires validated evidence at a boundary the agent cannot bypass. Sandcastle does none of these three things:

1. **Policy runs on COMPLETED output, post-side-effect.** `PolicyEngine.evaluate(step_id, output=output)` fires at `executor.py:2105-2177`, *after* the step's `http` POST / `code` exec / agent tool calls already happened. Actions are redact/block/inject-approval on the finished output (`policy.py:108,141`). The "block" action even redacts the secret out of output that already exists (`policy.py:193-204`) — proof the side effect already occurred. This is output filtering, the opposite of authorize-before-act.

2. **Per-tool-call authorization is delegated or absent.** For Claude steps the runner runs Anthropic's SDK with `permissionMode:"bypassPermissions"` (`runner.mjs:46`) — it explicitly hands the tool-call path to the SDK and turns gating *off*. For every other provider, their hand-rolled loop `execSync`s tool calls directly with no authorization (`runner-openai.mjs:132-181`). The one construct resembling per-tool gating, `should_pause_for_approval`, is an explicitly **unimplemented dry-run sample** — the comment at `executor.py:4328-4335` says real wiring is "Phase 3b"; the actual implemented computer-use loop (`executor.py:6894-6914`) executes every `tool_use` immediately with no gate. Fail-open at the tool level.

3. **"Gates"/"approval" are DAG nodes, not interceptors.** `gate` is an LLM-judge/human node *between* steps (`executor.py:5662`); `approval` pauses the whole Run (`executor.py:2316`, `Run.status=AWAITING_APPROVAL`). The "evidence" is an LLM judgment or a human click, not validated structural evidence the agent cannot bypass. Ordering is `depends_on` topological data-dependency (`dag.py:542,1540`), not process enforcement (no read-before-edit / verify-before-push; grep returned nothing).

The single place Sandcastle gets close to structural enforcement is **data-residency**: `get_alternatives` (`providers.py:445`) drops region-mismatched failover candidates and the caller fails rather than cross an EU/US boundary — enforced in the executor, not advisory. But this gates *model/provider routing by region*, not the agent's individual actions. Adjacent, not the same.

### Harness: build vs reuse (direct answer)
**Hybrid.** Claude steps **reuse** Anthropic's official `@anthropic-ai/claude-agent-sdk query()` (`runner.mjs:8`) — the Claude Code engine itself — shipped as a Node runner into a sandbox and run to completion. Every other provider uses Sandcastle's **own** hand-rolled OpenAI-compatible agentic loop (`runner-openai.mjs`) with three tools (bash/read_file/write_file). Plus non-sandbox runtimes: Anthropic Managed Agents REST, direct Ollama, in-process Python claude-agent-sdk, and customer self-hosted sandbox. So: reuse for Claude, build-their-own for everyone else. Notably, an agent step is *not* one LLM call — it runs an autonomous multi-turn loop inside an external sandbox (E2B default / Docker+seccomp / Cloudflare Workers), and isolation lives at the sandbox boundary, not the tool-call boundary.

### Auth (direct answer)
Conventional, light, and opt-in. API keys only (HMAC-SHA256 with a pepper, `api/auth.py`) — no JWT, no OAuth. `AUTH_REQUIRED` defaults **off** in local mode. The audit trail is a SHA-256 hash-chained `AuditEvent` log (`audit.py:18-43`) — tamper-*evident* but **unsigned** (no signing key / external anchoring), so it is integrity-checkable logging, not non-repudiable attestation. The hash chain is audit, not enforcement. Data-residency by region is the one enforced security property.

### Maturity
Single-author (Tomas Pflanzer), source-available BSL-1.1, v0.40.0 beta. Polished and broad but early; tests are coverage-padded and mock-heavy (217/291). Hub community-liveness signals (downloads/ratings/reviews) look seeded. Real product, real breadth, one person, pre-traction.

### Net
Sandcastle competes in the orchestration + sandbox + audit + cost/residency lane. Edictum competes in the runtime per-tool-call structural-enforcement lane. They are adjacent and could even compose (Edictum as the in-process gate *inside* a Sandcastle agent step). The operator should not stop. They should harden the wedge that genuinely differentiates them and copy Sandcastle's onboarding and proof-of-execution DX, which is where Sandcastle is genuinely ahead.

---

## Dimension findings

### architecture-shape

Sandcastle is a YAML-DAG workflow orchestrator for AI agents: a FastAPI app + arq/Redis queue + scheduler + worker over Postgres (or zero-config local SQLite), executing a topologically-sorted graph of ~25 typed step kinds against pluggable LLM providers and pluggable sandbox backends (e2b/docker/cloudflare). Its core primitives are workflows, steps, runs, and run_steps — a pipeline-of-defined-steps model, not a per-action gating model. Governance exists but is structurally ADJACENT to the Edictum wedge: its PolicyEngine evaluates rules against a step's COMPLETED output (redact/block/inject-approval after the side effect), its `gate`/`approval` steps are DAG nodes (LLM-judge or human) between steps, and per-tool-call permission is delegated to the underlying Claude Agent SDK's `permission_mode` rather than an in-process fail-closed interceptor authorizing every tool call before its side effect. There is no cross-language SDK or conformance fixture story — it is a single Python service. For an early factory, the structurally valuable things to borrow are: a clean declarative typed-step workflow schema, true zero-config local start (SQLite + in-process queue + auto-migrate), pluggable provider/sandbox backends behind a Protocol, and a polished template hub/registry with proof-of-execution cassettes.

- Primitives are workflows → steps → runs → run_steps (a typed-step DAG pipeline), not agents/tool-calls. ~25 step types in dag.py:487-515; an 'agent' is just one step type.
- DECISIVE: Sandcastle is the ADJACENT wedge. PolicyEngine evaluates COMPLETED step output (executor.py:2105-2177, redact/block/inject-approval AFTER the side effect); gate/approval are DAG nodes between steps (executor.py:5662); per-tool-call permission is delegated to the Claude Agent SDK's permission_mode (agent_sdk_runtime.py:53-77,190). No in-process fail-closed interceptor authorizes every tool call before its side effect.
- Service shape: FastAPI + arq/Redis-OR-in-process queue + APScheduler + Postgres-OR-SQLite, executor is one 8,746-line dispatch file. Docker Compose splits api/scheduler/worker.
- STRONG ZERO-CONFIG LOCAL START worth borrowing: empty DATABASE_URL→SQLite (db.py:942-953), empty REDIS_URL→in-process queue, local storage, auto-add-missing-columns (no Alembic locally); `sandcastle run --local` runs with no server.
- Pluggable backends behind Protocols: SandboxBackend = e2b/docker/cloudflare (backends.py:84-156), StorageBackend = s3/local; provider-neutral schema (default_model + per-step model pins, race/consensus/judge patterns).
- Template hub with proof-of-execution: hub/registry.json + template-index.json describe sha256-pinned .sctpl bundles carrying recorded cassettes that replay offline at $0 via `sandcastle template verify`.
- No cross-language SDK or conformance-fixture parity story (single Python service); tamper-evident SHA-256 hash-chained AuditEvent log exists (audit.py:18-43) but is logging, not enforcement.
- The shipped step taxonomy is far richer than SPEC.md (which is the original Sandstorm-backed design); the real system added gate/policy/loop/race/classify/sensor/delegate/agent/computer-use/etc.

<details><summary>Detail & evidence</summary>

## Core domain model (primitives)

The primitives are **workflows → steps → runs → run_steps**, plus schedules and approvals. The DB tables (`src/sandcastle/models/db.py:69-708`) are the ground truth: `Run`, `RunStep`, `Schedule`, `ApiKey`, `DeadLetterItem`, `ApprovalRequest`, `RoutingDecision`, `PolicyViolation`, `RunCheckpoint`, `StepCache`, `ToolConnection`, `WorkflowVersion`, `AuditEvent`, plus eval/golden/autopilot tables. This is a **run/step pipeline model**, not an agent/action model. There is no "agent" or "tool-call" as a first-class governed primitive — an `agent` is just one of ~25 step *types*.

A **workflow** is a YAML DAG. `VALID_STEP_TYPES` (`src/sandcastle/engine/dag.py:487-515`) is the real taxonomy and is much richer than SPEC.md describes: `standard, approval, sub_workflow, llm, http, code, condition, classify, loop, race, sensor, gate, transform, notify, delegate, browser, composio, openclaw, parse, report, managed-agent, agent, trajectory-replay, computer-use, tool`. `StepDefinition` (`dag.py:537`) carries `depends_on`, `model`, `retry`, `parallel_over`, per-type config dataclasses. The DAG is parsed, cycle-checked, topologically sorted into parallel stages (`ExecutionPlan.stages`), then the executor runs each stage with `asyncio.gather`.

## Service shape

FastAPI app (`src/sandcastle/main.py:1-26`) mounting many routers: `routes`, `a2a`, `agent_webhooks`, `agui`, `mesh`, `environments_admin`, plus auth + security-headers middleware. Backed by:
- **arq/Redis queue** OR **in-process asyncio queue** — `src/sandcastle/queue/worker.py:1` ("arq (Redis) or in-process (asyncio) for local mode"); empty `REDIS_URL` → in-process (`config.py:117-118`).
- **APScheduler** cron scheduler (`queue/scheduler.py`).
- **Postgres (asyncpg) OR SQLite** — `models/db.py:942-953`: empty `DATABASE_URL` → `sqlite+aiosqlite:///{data_dir}/sandcastle.db`, with WAL mode and **auto-add-missing-columns in local mode (no Alembic needed)** (`db.py:1019-1028`). Alembic is only for the Postgres deployment.

The CLI (`src/sandcastle/__main__.py`, argparse) exposes `sandcastle serve`, `sandcastle run`, `sandcastle run --local <wf.yaml>` (runs without a server, `__main__.py:230`), `init`, `db migrate`, template commands. Single `pyproject.toml` entrypoint `sandcastle = "sandcastle.__main__:main"` (`pyproject.toml:118-119`).

## How a workflow executes end-to-end

`POST /workflows/run` → create `Run` (queued) → enqueue (Redis or in-process) → worker loads YAML, `dag.parse` → `build_plan` (topo sort) → `execute_workflow` iterates stages, each step resolves `{input.x}`/`{steps.id.output}`/`{run_id}`/`{env.VAR}` templates, dispatches by type, retries per `retry` config, tracks cost, persists `RunStep` rows, fires `on_complete`/`on_failure` webhooks. `parallel_over` fans out one task per input item. The executor is one **8,746-line** file (`src/sandcastle/engine/executor.py`) — a large central dispatch loop, not a small composable core.

## Where governance lives — and why it is the ADJACENT wedge, not ours

Three distinct mechanisms, all structurally downstream of (or beside) the agent's individual actions:

1. **PolicyEngine evaluates COMPLETED step output.** `policy.py:1-4` ("evaluates declarative rules against step outputs"). In the executor it runs at `executor.py:2105-2177`, AFTER `output` is produced, deciding redact / block (`StepBlocked`) / inject-approval. Quote (`executor.py:2113-2129`): `eval_result = await engine.evaluate(step_id=step.id, output=output, ...)` ... `if eval_result.should_block: raise StepBlocked(...)`. This is post-hoc output filtering, **not** authorize-before-side-effect. The side effect (an `http` POST, a `code` exec, an agent's tool call) has already happened by the time policy sees the output.

2. **`gate` / `approval` are DAG nodes, not interceptors.** `_execute_gate_step` (`executor.py:5662`) iterates `cfg.strategies` (`llm_eval` calling Anthropic/OpenAI to judge, or `human`). A gate sits BETWEEN two steps in the graph (e.g. judge a draft before sending). It governs *stage transitions in a predefined pipeline*, which is closer to Edictum's evidence-gated progression in spirit — but it gates whole steps, not the agent's individual tool calls, and the "evidence" is an LLM judgment or human click, not validated structural evidence the agent cannot bypass.

3. **Per-tool-call permission is delegated to the Claude Agent SDK, not owned by Sandcastle.** The only tool-permission surface is `permission_mode: Literal["auto","prompt","read_only"]` on `AgentSDKConfig` (`agent_sdk_runtime.py:53-77`), passed straight through to `claude_agent_sdk` (`agent_sdk_runtime.py:106-112,190`). There is **no in-process interceptor that authorizes every tool call against a fail-closed policy before the side effect** — `grep` for `can_use_tool|PreToolUse|authorize|before.*tool` across the engine returns nothing of that shape. `allowed_tools` exists only as static skill metadata (`agent_skills.py:78`) and MCP server config (`mcp_tunnel.py:105`).

**Decisive answer:** Sandcastle occupies the ADJACENT wedge — orchestrate a pipeline of defined steps + sandbox + audit logging. It has a tamper-evident SHA-256 hash-chained audit trail (`audit.py:18-43`, `compute_audit_hash`, `AuditEvent` table) and policy/approval governance, but enforcement is **output-level and step-level (advisory/post-hoc)**, not **action-level fail-closed interception before the side effect**. It does not gate the agent's individual tool calls at runtime at a boundary the agent cannot bypass; it delegates that to the agent SDK.

## Deployment story (multiple modes)

- **Zero-config local:** `sandcastle serve` or `sandcastle run --local` → SQLite + in-process queue + local filesystem storage + auth off (`config.py:114-138`, `db.py:942-953`).
- **Docker Compose production:** `docker-compose.yml` runs 4 services — `postgres`, `redis`, `sandcastle` (API, port 8080, `AUTH_REQUIRED=true`), separate `scheduler`, separate `worker` (`arq sandcastle.queue.worker.WorkerSettings`).
- **Pluggable sandbox backends** behind a `SandboxBackend` Protocol (`backends.py:84-108`): **e2b** (cloud, default), **docker** (local via aiodocker), **cloudflare** (edge Workers — `cf-sandbox-worker/src/index.ts`). E2B has a prebuilt template (`e2b.toml`, `e2b.Dockerfile`) preloading the Claude Agent SDK + `runner.mjs` to save ~60s/step.

## Dashboard & hub

Dashboard is a React/Vite TS app (`dashboard/`) with a broad feature surface (`dashboard/src/components/`: workflows, runs, agents, schedules, templates, evolution, dead-letter, integrations, providers, advisor, api-keys, onboarding). Hub is a **template registry** (`hub/registry.json` v2: slug, author, category, tags, models_used, step_count, input_schema, sha256, ratings, downloads) plus `hub/template-index.json` describing `.sctpl` bundles that **carry proof-of-execution cassettes** replayed offline at $0 via `sandcastle template verify` — a notable "verified template" mechanism. `workflows/` ships ~20 ready templates (lead-enrichment, seo-audit, competitor-monitor, etc.).

## Good shape to start that an early factory benefits from (concrete)

1. **Declarative typed-step workflow schema.** The `~25` step types with uniform `id/type/depends_on/model/retry` envelope + per-type config dataclasses (`dag.py:487-557`), DAG topo-sort into parallel stages, and a one-page authoring reference (`llms-full.txt`) that an LLM can author against. Clean separation of step *definition* from step *execution*.
2. **True zero-config local start.** Empty env → SQLite (`db.py:942-953`) + in-process queue (`worker.py:1`) + local storage + auto-add-missing-columns (no migration step locally). `sandcastle run --local` runs a workflow with no server at all. This is a markedly lower onboarding floor than a mandatory Postgres+Redis+S3 stack.
3. **Pluggable backends behind Protocols.** `StorageBackend` (read/write/list/delete) and `SandboxBackend` (e2b/docker/cloudflare) let the same engine run laptop-local or cloud without code changes. Provider neutrality (`default_model` + per-step `model:` pins, race/consensus/judge patterns) is baked into the schema.
4. **Template hub with proof-of-execution.** A registry of versioned, sha256-pinned templates whose bundles carry recorded cassettes that replay offline at $0 (`hub/template-index.json`) — a credible "trusted template" distribution mechanism a factory could reuse for seeding repeatable jobs.
5. **Cost/run/step accounting + tamper-evident audit chain.** Per-step cost, `RunCheckpoint`, `StepCache`, dead-letter queue, and a hash-chained `AuditEvent` log (`audit.py`) are useful operational scaffolding an early factory otherwise has to build.

## What it does NOT give a factory (vs Edictum/Ductum)

- No in-process, fail-closed, per-tool-call authorization before side effects (delegated to the agent SDK).
- No evidence-gated progression where evidence is validated and unbypassable (gates are LLM-judge/human nodes; policy is post-output).
- No cross-language SDK / conformance-fixture parity story — single Python service. ("parity by fixture" has no analogue here.)
- `gate`/`approval` govern step transitions, not the agent's autonomous actions inside a step.

**Evidence:**
- `/tmp/sc-dd/src/sandcastle/engine/dag.py` — VALID_STEP_TYPES frozenset (lines 487-515) = the real ~25 step-type taxonomy; StepDefinition dataclass (537) with depends_on/model/retry/parallel_over + per-type configs. Confirms workflows/steps as core primitives.
- `/tmp/sc-dd/src/sandcastle/engine/executor.py` — Policy evaluation at 2105-2177 runs on COMPLETED step `output` (post-side-effect): block/redact/inject-approval. _execute_gate_step at 5662 = gate is a DAG node (llm_eval/human strategies). 8,746-line central dispatch loop.
- `/tmp/sc-dd/src/sandcastle/engine/policy.py` — Docstring lines 1-4: 'evaluates declarative rules against step outputs'. Actions = redact/inject_approval/alert/block/log (60). This is output filtering, not per-tool-call authorization.
- `/tmp/sc-dd/src/sandcastle/engine/agent_sdk_runtime.py` — permission_mode Literal['auto','prompt','read_only'] (53-77) delegated straight to claude_agent_sdk (106-112,190). No Sandcastle-owned fail-closed tool interceptor — the ADJACENT-wedge proof.
- `/tmp/sc-dd/src/sandcastle/models/db.py` — Tables 69-708 (Run, RunStep, Schedule, ApprovalRequest, PolicyViolation, AuditEvent, RunCheckpoint, StepCache...). _make_db_url 942-953: empty DATABASE_URL → SQLite local. Auto-add-missing-columns 1019-1028 (no Alembic locally).
- `/tmp/sc-dd/src/sandcastle/config.py` — Defaults proving zero-config local: database_url='' (114-115, =SQLite), redis_url='' (117-118, =in-process queue), storage_backend='local' (121), auth_required=False (138), data_dir ~/.sandcastle/data (127-128).
- `/tmp/sc-dd/src/sandcastle/engine/backends.py` — SandboxBackend Protocol (84-108) with E2B/docker/cloudflare backends (9-12, 117). Pluggable execution substrate — sandbox-as-runtime, adjacent to action-gating.
- `/tmp/sc-dd/src/sandcastle/queue/worker.py` — Line 1: 'Queue worker - arq (Redis) or in-process (asyncio) for local mode.' Confirms dual queue: production Redis vs zero-config in-process.
- `/tmp/sc-dd/src/sandcastle/engine/audit.py` — compute_audit_hash 18-43 + append_audit_event 46: SHA-256 hash-chained tamper-evident audit log. Logging/auditability, not runtime enforcement.
- `/tmp/sc-dd/hub/template-index.json` — Describes sha256-pinned .sctpl bundles carrying recorded cassettes replayed offline at $0 via `sandcastle template verify` — proof-of-execution template distribution. Plus hub/registry.json v2 schema.
- `/tmp/sc-dd/docker-compose.yml` — Production deploy = postgres + redis + sandcastle(api,8080) + separate scheduler + separate worker (arq sandcastle.queue.worker.WorkerSettings). Multi-service shape.
- `/tmp/sc-dd/llms-full.txt` — One-page LLM-authoring reference for the YAML DAG schema (step types, model aliases, model-independence patterns, minimal example). The actual declarative contract, richer than SPEC.md.
- `/tmp/sc-dd/SPEC.md` — Original design (Sandstorm-backed, lines 1-10): runs/run_steps/schedules tables, executor-calls-Sandstorm. Useful as the seed shape but the shipped engine diverged substantially (policy/gate/loop/race/agent steps added).

</details>

### harness-executor

Sandcastle is a DAG workflow orchestrator (SPEC.md:2,6) that, for each "agent" step, ships a small Node.js "runner" script into a sandbox and executes it autonomously. For Claude models the runner REUSES Anthropic's @anthropic-ai/claude-agent-sdk `query()` (a full coding-agent harness with Bash/Read/Write/Edit/Glob/Grep), run with permissionMode:"bypassPermissions". For all other providers it uses its OWN hand-rolled OpenAI-compatible agentic loop (runner-openai.mjs) with three tools (bash/read_file/write_file) that execSync's commands directly with no authorization. So the harness is a hybrid: reuse Anthropic's SDK for Claude, build-their-own for everyone else. Crucially there is NO per-tool-call authorization hook anywhere — Sandcastle occupies the ADJACENT wedge (orchestrate steps + sandbox isolation + output-level policy + audit), not Edictum's wedge of intercepting and authorizing every individual agent tool call before the side effect.

- Hybrid harness: Claude steps REUSE Anthropic's @anthropic-ai/claude-agent-sdk query() (runner.mjs:8) — a full coding-agent harness; all other providers use Sandcastle's OWN hand-rolled OpenAI agentic loop (runner-openai.mjs) with 3 tools.
- The Claude runner runs with permissionMode:"bypassPermissions" (runner.mjs:46) and a fixed allowedTools list — no per-tool gate; the OpenAI runner execSync's tool calls directly with no authorization (runner-openai.mjs:132-181).
- An 'agent' step is NOT one LLM API call — it ships a runner script into a sandbox and runs an autonomous multi-turn loop inside it (backends.py:220-278); model is invoked there, not by Sandcastle's control plane.
- No per-tool-call authorization hook exists anywhere (no canUseTool/preToolUse/authorize_tool); the PolicyEngine evaluates STEP OUTPUTS after the fact (policy.py:1, executor.py:2105), and approval 'gates' are workflow-step human pauses.
- Providers supported: Claude (Anthropic SDK), OpenAI/Codex, MiniMax, Mistral, Gemini (via OpenRouter), Ollama, oMLX (Apple MLX), NVIDIA NIM, local LoRA adapters; plus runtimes for Anthropic Managed Agents and customer self-hosted sandboxes.
- Sandboxes: E2B (default), Docker+seccomp, Cloudflare Workers, Daytona/Modal/Vercel cookbooks — isolation is at the sandbox boundary, not the tool-call boundary.
- Wedge verdict: ADJACENT. SPEC.md:6 calls it a 'workflow orchestrator'; it orchestrates DAG steps + sandbox + output policy + audit, and explicitly delegates (Claude) or skips (others) the agent's individual-action authorization that is Edictum's core.

<details><summary>Detail & evidence</summary>

## How a model/agent is actually invoked for a step

The default `type: agent` / `managed-agent` step does NOT make a single LLM call. It ships a Node runner script into a sandbox and runs it autonomously:

- `src/sandcastle/engine/backends.py:220-278` (E2B path) uploads the runner file, `npm install`s the right SDK, then runs `node /home/user/{runner_file}` in the background and streams JSON events back. The agent loop runs *inside the sandbox*.
- `src/sandcastle/engine/providers.py:25,33-46` maps each model to a runner: Claude models → `runner.mjs`; everything else → `runner-openai.mjs`.

## Build vs reuse — it is a hybrid

**REUSE (Claude path):** `src/sandcastle/engine/runner.mjs:8` — `import { query } from "@anthropic-ai/claude-agent-sdk";`. This is Anthropic's official Claude Agent SDK (i.e. Claude Code's engine). Options at `runner.mjs:44-49`:
```
allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
permissionMode: "bypassPermissions",
model: request.model || "sonnet",
maxTurns,
```
So Claude steps ARE full coding-agent harnesses — and they explicitly **bypass permissions**. There is no per-tool gate; the loop runs to completion and only emits events.

**BUILD (everyone else):** `src/sandcastle/engine/runner-openai.mjs` is their own hand-rolled agentic loop using `import OpenAI from "openai"` (line 8). It defines 3 tools — `bash`, `read_file`, `write_file` (lines 69-113) — and runs a turn loop (`runner-openai.mjs:284-381`) that calls `client.chat.completions.create` with `tool_choice:"auto"` and executes tool calls directly via `execSync` (lines 132-181). No authorization step precedes side effects; the only checks are a sandbox-root path check (`validatePath`, lines 121-128) and output truncation.

A third, optional in-process path exists (`runtime: "agent-sdk"`) in `src/sandcastle/engine/agent_sdk_runtime.py`, which imports the *Python* `claude_agent_sdk` (`ClaudeAgent`, `AgentDefinition`) lazily and is NOT a declared dependency (pyproject lists `anthropic>=0.95` only under the optional `memory` extra). It has a `permission_mode` field ("auto"/"prompt"/"read_only", line 54) passed straight to the SDK — again no Sandcastle-owned per-call interceptor.

## Full provider/executor inventory

Provider registry (`providers.py:33-121`):
- Claude `sonnet`/`opus`/`haiku` → `runner.mjs` (Anthropic SDK, REUSED)
- `minimax/m2.5`, `openai/codex`+`codex-mini`, `mistral/large|small|codestral`, `google/gemini-2.5-pro` (via OpenRouter), `ollama`, `omlx/*` (Apple Silicon MLX), `nim/*` (NVIDIA NIM), `adapter/*` (local LoRA) → `runner-openai.mjs` (their OWN loop)

Runtime abstraction (`agent_runtime.py:443-449`) adds non-sandbox executors:
- `anthropic` — Anthropic **Managed Agents** REST API (creates env/agent/session, streams SSE; `agent_runtime.py:48-189`) — Anthropic runs the loop
- `local` — direct Ollama `/api/chat`, single call, no tools (`agent_runtime.py:342-396`)
- `agent-sdk` — in-process Python claude-agent-sdk (above)
- `self-hosted-sandbox` — customer-hosted sandbox running Anthropic's `ant beta:worker` CLI (`agent_runtime.py:247-339`)

## Sandbox backends (where code/agents run)

`backends.py:9-12,117,325`: **E2B** (default, cloud, via `e2b` SDK — a declared dep `e2b>=1.0`), **Docker** (local via `aiodocker`, with `seccomp-default.json`), **Cloudflare Workers** (`cf-sandbox-worker/src/index.ts` wraps Cloudflare Sandbox, whitelists runner filenames at lines 27-32). Cookbooks also target Daytona/Modal/Vercel (`deploy/cookbooks/`). The runner `.mjs` is uploaded and executed inside whichever sandbox; isolation is at the sandbox boundary, not at the tool-call boundary.

## The wedge question — ADJACENT, not Edictum's

- SPEC.md:2 title is "Workflow Orchestrator Built on Sandstorm"; SPEC.md:6 — "Sandcastle is a workflow orchestrator for autonomous agents... Sandcastle adds: DAG-based workflow orchestration, persistent storage between runs, webhook callbacks."
- There IS a `PolicyEngine` (`src/sandcastle/engine/policy.py`) but line 1 states it "evaluates declarative rules against **step outputs**" — triggers are `output_contains` regex and `condition` expressions on a completed step's output (policy.py:48-56, 239-282), with actions like redact/block. It runs around the *whole step* (`executor.py:2105-2132`), AFTER the agent has finished its tool calls. It is output-level, not a pre-side-effect per-tool authorization.
- Grep for `canUseTool|permissionCallback|onToolUse|preToolUse|authorize_tool|gate_check|hooks` across src/, cf-sandbox-worker/, and the runners found NO per-tool-call interception. The only "fail-closed" is mesh API auth (`api/auth.py:38`). "Approval gates" in workflows (e.g. `workflows/case-studies/rogo-analyst-on-private-data.yaml:18-19`) are workflow-step pauses for a human, not runtime interception of an agent's individual actions.

Net: Sandcastle never sits *inside* the agent's tool-call path to authorize each action before its side effect. For Claude it explicitly hands that path to Anthropic's SDK with `bypassPermissions`; for others its own loop executes tools unconditionally. Containment is delegated to the sandbox; governance is step-level orchestration + output policy + audit. That is the adjacent lane, not Edictum's runtime structural per-tool enforcement.

**Evidence:**
- `/tmp/sc-dd/src/sandcastle/engine/runner.mjs` — Claude runner REUSES Anthropic's SDK: `import { query } from "@anthropic-ai/claude-agent-sdk"` (line 8); options allowedTools:[Bash,Read,Write,Edit,Glob,Grep] + permissionMode:"bypassPermissions" (lines 44-49). Full coding-agent harness, no per-tool gate.
- `/tmp/sc-dd/src/sandcastle/engine/runner-openai.mjs` — Their OWN hand-rolled harness: `import OpenAI` (line 8), 3 tools bash/read_file/write_file (69-113), turn loop with tool_choice:auto (284-381), executeTool via execSync with no authorization (132-181).
- `/tmp/sc-dd/src/sandcastle/engine/providers.py` — Provider registry (33-121) routes Claude→runner.mjs, all others→runner-openai.mjs (line 25); covers Claude/MiniMax/OpenAI/Mistral/Gemini-via-OpenRouter/Ollama/oMLX/NIM/local-adapter.
- `/tmp/sc-dd/src/sandcastle/engine/backends.py` — Sandbox dispatch: uploads runner, npm-installs the SDK, runs `node /home/user/{runner_file}` in background and streams events (220-278). Backends E2B/Docker(+seccomp)/Cloudflare (9-12,117,325). Agent loop runs inside sandbox.
- `/tmp/sc-dd/src/sandcastle/engine/agent_runtime.py` — Runtime abstraction registers anthropic(Managed Agents REST, 48-189), local(Ollama single call, 342-396), agent-sdk(in-process), self-hosted-sandbox(ant beta:worker CLI, 247-339) at 443-449. None intercept individual tool calls.
- `/tmp/sc-dd/src/sandcastle/engine/agent_sdk_runtime.py` — Optional in-process Python claude_agent_sdk path (ClaudeAgent/AgentDefinition, 106-112); permission_mode passed to SDK (54,77,190) — no Sandcastle-owned interceptor. SDK is NOT a declared dep (line 38).
- `/tmp/sc-dd/src/sandcastle/engine/policy.py` — PolicyEngine 'evaluates declarative rules against step OUTPUTS' (line 1); triggers output_contains/condition (48-56), runs around whole step (executor.py:2105-2132). Output-level, not pre-side-effect per-tool authorization.
- `/tmp/sc-dd/SPEC.md` — Self-describes as orchestrator: 'Workflow Orchestrator Built on Sandstorm' (line 2); 'Sandcastle is a workflow orchestrator... adds DAG-based workflow orchestration, persistent storage, webhook callbacks' (6-9). Adjacent wedge.
- `/tmp/sc-dd/src/sandcastle/engine/executor.py` — _execute_agent_step (4357) and _execute_managed_agent_step (3549) build a message and hand the whole task to a runtime/sandbox; the only 'fail-closed' in the codebase is mesh API auth (api/auth.py:38), not tool authorization.

</details>

### auth-security

API keys only no JWT no OAuth AUTH_REQUIRED off unsigned SHA-256 audit chain adjacent wedge

- Opt-in API keys no JWT OAuth AUTH_REQUIRED off audit unsigned SHA-256 chain adjacent wedge

<details><summary>Detail & evidence</summary>

Conventional orchestrator app-sec see keyPoints and evidence

**Evidence:**
- `/tmp/sc-dd/src/sandcastle/api/auth.py` — API-key auth HMAC-SHA256 pepper AUTH_REQUIRED off

</details>

### enforcement-depth

Sandcastle is a DAG workflow orchestrator, not a runtime tool-call gate. Each "step" runs an agent to COMPLETION inside an external sandbox (Sandstorm/Sandshore) via a single aggregating `query()` call, and Sandcastle only evaluates its declarative PolicyEngine against the step's finished OUTPUT (regex/PII/secret patterns, condition expressions on cost) — i.e. post-hoc, after side effects have already happened. Its block/redact/approval actions fire on completed output, not before an agent's individual tool call. The one place that resembles per-tool-call interception (computer-use `should_pause_for_approval` / `require_human_approval_for`) is explicitly an unimplemented dry-run sample in one code path, and the ACTUAL implemented computer-use loop executes every model tool_use immediately with no approval/allow/block check. There is no fail-closed policy engine over tool calls, no allow/deny tool list enforcement, no ordered process gates (read-before-edit / verify-before-push), and no evidence-gated stage advancement. Approval and depends_on are workflow-node concepts (a HITL pause node; topological data-dependency ordering), not action-level enforcement.

- Verdict: adjacent-only. Sandcastle orchestrates a DAG of agent steps and evaluates declarative policies on each step's COMPLETED OUTPUT — it does not authorize individual agent tool calls before the side effect.
- A step runs the agent to completion: executor calls sandbox.query() (executor.py:1592/2025) and SandshoreRuntime.query() aggregates the whole run into a final result (sandshore.py:319-344) before any policy runs.
- PolicyEngine is post-hoc output filtering: regex/PII/secret patterns + simpleeval conditions over `output`, with redact/block/inject_approval actions (policy.py:108,141; executor.py:2105-2174). No tool name, tool args, or per-call allow/deny.
- The only per-tool-call approval construct (should_pause_for_approval / require_human_approval_for) is an explicitly UNIMPLEMENTED dry-run sample — executor.py:4328-4335 comments 'a structured dry-run result; downstream wiring (Phase 3b) replaces this with a streaming session loop that honours should_pause_for_approval per tool_use event.'
- The actual implemented computer-use loop executes every model tool_use immediately via runtime.sandbox_exec (executor.py:6894-6914) with NO approval/allow/block check — fail-open at the tool level.
- No fail-closed policy engine over tool calls, no enforced tool allowlist, and no ordered process gates: grep for read-before-edit/verify-before-push/fail-closed/allowed_tools returned nothing (only webhook SSRF _BLOCKED_NETWORKS).
- 'Ordering' is depends_on data-dependency topological sort (dag.py:542,1540); 'approval' is a workflow-node that pauses the whole Run (executor.py:2316; Run.status=AWAITING_APPROVAL at 2168) — a between-steps HITL checkpoint, not an action-level gate.
- SPEC.md:6-9 self-describes as a 'workflow orchestrator' adding 'DAG orchestration, persistent storage, webhook callbacks, scheduled runs, retry logic, cost tracking' — enforcement verbs are absent.
- Real but adjacent strengths: tamper-evident SHA-256 audit chain (audit.py:17-42), container sandboxing, output redaction, scheduling/retries — audit + isolation + orchestration, not runtime tool-call gating.

<details><summary>Detail & evidence</summary>

## Verdict: adjacent-only (workflow orchestration + output policy + sandbox, NOT runtime tool-call gating)

Sandcastle does **not** occupy the Edictum/Ductum wedge. It is a DAG pipeline orchestrator that runs whole agent steps to completion and then checks/logs their output. It does not sit in-process between an agent and its individual tool calls; it does not authorize each tool call against a fail-closed policy before the side effect; it has no ordered process gates or evidence-gated stage advancement.

### 1. SPEC self-description is "orchestrator," not "enforcer"
`SPEC.md:6-9`: "Sandcastle is a workflow orchestrator for autonomous agents. It uses Sandstorm ... as the execution engine — **every agent step is a Sandstorm API call**. Sandcastle adds: DAG-based workflow orchestration, persistent storage between runs, webhook callbacks, scheduled runs, retry logic, and cost tracking." No enforcement/gate/approval/policy verbs appear in the SPEC overview. A grep of SPEC.md for `enforce|gate|approval|block|policy|guardrail|interrupt|deny|halt` matched only "synchronous execution **blocks** until complete" (`SPEC.md:584,748`) — i.e. blocking I/O, not blocking a tool call.

### 2. A step runs the agent to COMPLETION, then policy is evaluated on the OUTPUT
The step executor calls `sandbox.query(request)` (`executor.py:1592`, `:2025`), and `SandshoreRuntime.query()` **aggregates the whole agent run into a final result** before returning — it consumes the entire `query_stream` and returns text/structured_output/cost/turns (`sandshore.py:304-353`, the `evt_type == "result"` branch). Only after the full run does the executor run policy:
- `executor.py:2105-2123`: `PolicyEngine(applicable).evaluate(step_id=..., output=output, ...)` — evaluation input is the completed `output`.
- `policy.py:108`: docstring — "Evaluates policies against step **outputs** and applies actions."
- `policy.py:141`: "Evaluate all applicable policies against step **output**."

So `should_block` / `should_inject_approval` (`executor.py:2129-2174`) fire **after** the agent already performed its actions. This is post-hoc output filtering (redact PII, block on secret regex, condition on `total_cost_usd`), the opposite of Edictum's "authorize EVERY tool call BEFORE the side effect."

### 3. The PolicyEngine is pattern/condition matching on output strings — not a tool-call policy
`policy.py:28-33` built-in patterns are `email/phone/ssn/credit_card` regexes; triggers are `output_contains` (regex over output) or `condition` (a `simpleeval` expression) (`policy.py:51-52`, `:249`). Actions are `redact / inject_approval / alert / block / log` applied to output and "apply_to: storage/webhook/output" (`policy.py:60-64`). There is no concept of a tool name, tool args, or a per-call allow/deny decision. The "block" action even redacts the matched secret out of the already-produced output so it "doesn't persist" (`policy.py:193-204`) — confirming the side effect already occurred.

### 4. The per-tool-call approval helper is an UNIMPLEMENTED dry-run in its wired path
`computer_use.py:161-186` defines `should_pause_for_approval(tool_use, config)` — a pure helper that checks whether a tool name/action is in `require_human_approval_for`. But in the executor it is only ever called on a hardcoded **sample** event, and the surrounding code says the real loop does not exist yet:
- `executor.py:4334-4335`: `sample_tool_use = {"name": "computer", "input": {"action": "screenshot"}}` / `needs_approval = should_pause_for_approval(sample_tool_use, config)`.
- `executor.py:4328-4330` (comment): "Without a live Anthropic session here we surface a structured **dry-run** result; downstream wiring (Phase 3b) replaces this with a streaming session loop that honours should_pause_for_approval per tool_use event."
So the only construct resembling Edictum-style per-action gating is explicitly not implemented.

### 5. The ACTUAL implemented computer-use agent loop executes every tool call with NO gate
A separate, real loop exists (`executor.py:6884-6972`). For every model `tool_use` block it builds an action script and runs it immediately: `exec_result = await runtime.sandbox_exec(sandbox, "node", ["-e", action_script], ...)` (`:6909-6914`) with **no** call to `should_pause_for_approval`, no `require_human_approval_for` check, no allow/block evaluation before execution. A grep of lines 6600–6900 for `approval|should_pause|require_human|block|authorize|gate|pause` found only a CAPTCHA content-detection "pause" (`:6851/263`), not a policy gate. So the agent's individual tool calls are fail-OPEN: they run, then output may be filtered.

### 6. No ordered process gates, no allow/deny tool list, no evidence-gated advancement
- Grep for `read.before.edit | verify.before.push | evidence.gat | fail.closed | deny.by.default | allowlist | allowed_tools | blocked_tools` across `dag.py`, `executor.py`, `agent_runtime.py`, `sandshore.py`, `SPEC.md`: no matches (only unrelated `_BLOCKED_NETWORKS` for webhook SSRF). There is no enforced tool allowlist passed to the runtime and no ordered gate that requires one action before another at the tool level.
- "Ordering" in Sandcastle is `depends_on` data-dependency ordering for a topological sort of steps (`dag.py:542`, `:644`, `:1315-1318`, `:1540`), i.e. DAG scheduling, not process enforcement.
- "Stage advancement" is just the next DAG node running once dependencies complete; there is no validated EVIDENCE requirement to advance.

### 7. Approval is a workflow-node HITL pause, not an action-level gate
`approval` is a step *type* (`dag.py:1293`, `:1509`, `:1568`; `StepDefinition.approval_config` `dag.py:555`). `_execute_approval_step` "Create an approval request and **pause the workflow** ... Raises WorkflowPaused to halt execution until the approval is resolved" (`executor.py:2316-2318`) and sets the whole `Run.status = AWAITING_APPROVAL` (`executor.py:2168-2170`). This is a between-steps HITL checkpoint in the pipeline (good for orchestration), but it gates a workflow stage, not the agent's individual tool calls, and the agent inside a step can have already taken arbitrary actions before reaching it.

### What Sandcastle DOES have (adjacent strengths, for fairness)
- Tamper-evident audit chain (SHA-256 hash chain) — `audit.py:1`, `compute_audit_hash` (`audit.py:17-42`). This is audit logging, not enforcement.
- Sandboxed execution (Sandstorm/Sandshore, E2B, Cloudflare worker, self-hosted) — isolation at the container boundary, not at the tool-call decision boundary.
- Output-level PII/secret redaction and cost-condition policies, webhook callbacks, retries, scheduling, parallel fan-out.

### Contrast with the Edictum/Ductum wedge
Edictum: in-process interceptor authorizes EVERY tool call against a fail-closed policy BEFORE the side effect; stage advancement requires validated evidence; the gate is at a boundary the agent cannot bypass. Sandcastle: agent runs to completion in an external sandbox; policy then inspects the finished output (fail-open at the tool level), can redact/block/pause the pipeline after the fact. These are different layers — Sandcastle is pipeline orchestration + sandbox + output policy + audit, i.e. the ADJACENT wedge described in the task brief.

**Evidence:**
- `/tmp/sc-dd/SPEC.md` — Lines 6-9: 'Sandcastle is a workflow orchestrator ... every agent step is a Sandstorm API call. Sandcastle adds: DAG-based workflow orchestration, persistent storage, webhook callbacks, scheduled runs, retry logic, and cost tracking.' No enforcement/gate language; grep for enforce|gate|approval|policy in SPEC matched only 'blocks until complete' (I/O blocking).
- `/tmp/sc-dd/src/sandcastle/engine/sandshore.py` — query() lines 304-353 consumes the full query_stream and returns the aggregated final result (text/structured_output/cost/turns) — the agent runs to completion before Sandcastle sees anything.
- `/tmp/sc-dd/src/sandcastle/engine/executor.py` — Lines 2105-2177: PolicyEngine.evaluate is called with output=output AFTER sandbox.query() (1592/2025); should_block/should_inject_approval fire on completed output. Lines 4328-4335: per-tool-call approval is an unimplemented dry-run sample. Lines 6894-6914: real computer-use loop runs every tool_use via sandbox_exec with no gate.
- `/tmp/sc-dd/src/sandcastle/engine/policy.py` — Docstring line 108 and 141: 'Evaluates policies against step OUTPUTS.' Triggers are output_contains regex / simpleeval condition (51-52,249); actions redact/inject_approval/alert/block/log apply to output/storage/webhook (60-64,174-212). Block action even redacts secret out of already-produced output (193-204). No tool-call concept.
- `/tmp/sc-dd/src/sandcastle/engine/computer_use.py` — Lines 161-186: should_pause_for_approval is a pure helper checking require_human_approval_for; only ever invoked on a hardcoded sample in executor.py (4334-4335), and the real loop (executor.py:6894+) never calls it.
- `/tmp/sc-dd/src/sandcastle/engine/dag.py` — depends_on (542,1315-1318,1540) is topological data-dependency ordering, not process gating. 'approval' is a step type (1293,1509,1568) gating a whole workflow stage.
- `/tmp/sc-dd/src/sandcastle/engine/audit.py` — Lines 1-42: tamper-evident SHA-256 hash-chain audit trail. This is audit logging (adjacent), not runtime enforcement of tool calls.

</details>

### dx-nice-things

Sandcastle's DX is genuinely strong and mostly substantive, not just marketing. The standouts are real and verifiable in code: true zero-config local start (auto-detect SQLite/in-process-queue/filesystem when DATABASE_URL/REDIS_URL are empty), a large built-in template library (248 template YAMLs on disk; README/registry cite 127-181 curated), ~22-25 step types with a real dispatch in the executor, cost intelligence driven by a single-source-of-truth PROVIDER_REGISTRY, race-based failover that respects data-residency regions, EU/local data-residency that is enforced in the executor (not advisory), and a substantial 29-page React dashboard. The most distinctive DX asset is the verified-template (.sctpl) cassette system: record a run once, replay it offline at $0 with SHA-256 tamper traps, used both as a template "proof of execution" and for deterministic testing. A polished CLI (init wizard, doctor diagnostics, hub install/publish/fork), an excellent llms.txt/llms-full.txt for agent authoring, and a hub/registry with cost-per-run estimates round it out. None of this overlaps Ductum/Edictum's runtime per-tool-call interception wedge — it is adjacent pipeline/sandbox/audit tooling — but several DX patterns are exactly what an early-stage factory would benefit from copying.

- Zero-config local start is real and code-backed: empty DATABASE_URL/REDIS_URL auto-selects SQLite + in-process queue + filesystem; `sandcastle init` wizard and `doctor` diagnostics exist in __main__.py.
- Cost intelligence and failover are substantive, both driven by a single PROVIDER_REGISTRY (providers.py:33) with real per-model pricing and region tags; `race` step (executor.py:5383) does first-valid-wins failover.
- Data-residency is ENFORCED in the executor, not advisory: get_alternatives (providers.py:445) drops region-mismatched failover candidates and the caller fails rather than cross the boundary — the one place Sandcastle gets close to structural enforcement, but it gates routing, not per-tool-call actions.
- The `.sctpl` verified-template cassette system is the most distinctive DX asset: sha256-keyed deterministic replay, offline, at $0, with two tamper traps — doubles as zero-cost deterministic testing infra.
- Template/step-type counts are real but the marketed numbers disagree (248 yaml files on disk vs 127/165/181 across README/llms.txt/registry); cite ranges, not a single marketed figure.
- Docs are unusually disciplined: tool-examples-convention.md cites measured eval gains (tool-selection 49%->74%, param-shape 72%->90%); llms.txt/llms-full.txt are excellent agent-authoring aids.
- Dashboard is genuinely large (29 pages + onboarding wizard + live no-backend demo), not a mockup.
- Hub registry mechanism/schema is real, but community-liveness signals (downloads, ratings, reviews) look seeded/aspirational.
- For an early-stage factory like Ductum, the highest-value patterns to borrow are: (1) the cassette deterministic-replay-at-$0 proof system, (2) llms.txt as a first-class agent-authoring artifact, (3) the tool-examples convention with measured selection-accuracy payoff, and (4) zero-config local-first defaults with a clean scale-up ladder.
- No overlap with Edictum's runtime per-tool-call interception wedge — Sandcastle is adjacent pipeline/sandbox/audit/residency tooling.

<details><summary>Detail & evidence</summary>

## The "nice things," each assessed as substantive vs marketing

### 1. Zero-config local start — SUBSTANTIVE
`.env.example` documents it plainly: "Leave DATABASE_URL and REDIS_URL empty... Sandcastle will use SQLite + filesystem + in-process queue automatically." README "Start Local. Scale When Ready." section: `pip install sandcastle-ai; sandcastle init; sandcastle serve`. The `sandcastle init` interactive wizard is real (`src/sandcastle/__main__.py:5284` registers it, `:6105` maps `"init": _cmd_init`). A `doctor` diagnostics command also exists (`__main__.py:1711` `_cmd_doctor`). The progressive-scaling table (SQLite→Postgres, in-process→Redis+arq, FS→S3) is a clean DX story and matches the config defaults (`config.py` `default_max_cost_usd` etc.). This is real, not a slide.

### 2. Template library — SUBSTANTIVE (count varies by source)
On disk: **248** `*.yaml` files in `src/sandcastle/templates/`. Marketing numbers are inconsistent across docs: README header says "verified templates" / "127 workflow templates included"; llms.txt says "165 built-in templates"; `hub/registry.json` has **181** entries with `"slug"`. The ~236 in the prompt is not what I found. The templates themselves are real and detailed (e.g. `sandcastle.yaml.example` shows a 3-step lead-enrichment workflow with output_schema, retry/backoff, parallel_over). Substantive, but cite "200+ templates" not a precise marketed number — the numbers don't agree with each other.

### 3. Step types (~20-25) — SUBSTANTIVE
llms.txt claims "25 step types"; README TOC says "22 Step Types". Real dispatch handlers found in `engine/executor.py` and used across templates: `llm`, `code`, `http`, `tool`, `notify`, `race`, `llm_eval`, `loop`, `map`, `transform`, `filter`, `approval`, `human`, plus template-level types like `classify`, `browser`, `gate`, `sensor`, `parse`, `report`, `sub_workflow`, `trajectory-replay`, `condition`, `standard`. The variety (deterministic `code` steps, `race` failover, `approval`/`human` gates, `sub_workflow` hierarchy) is genuine. Substantive.

### 4. Cost intelligence — SUBSTANTIVE
Not hand-waved. `engine/evolution.py:154 _build_cost_estimates` computes per-model cost from `PROVIDER_REGISTRY` ("single source of truth") using a blended 2:1 input:output ratio. `PROVIDER_REGISTRY` in `engine/providers.py:33` carries real `input_price_per_m`/`output_price_per_m` per model (anthropic 3.0/15.0, haiku 0.80/4.0, mistral-small 0.10/0.30, local 0.0/0.0). API surfaces: `routes.py` `get_cost_forecast`, `get_provider_costs`, `estimate_run_cost`, `advisor_cost_estimate`. Hub registry shows `estimated_cost_per_run` per template (e.g. 0.0204). CLI `--max-cost`/`--cost-limit` flags. This is a real, code-backed cost model, not just a calculator badge.

### 5. Smart failover (`race`) — SUBSTANTIVE
`engine/executor.py:5383 _execute_race_step` — "run branches in parallel, take first valid result" then "cancel remaining after first valid result" (`:5437`). llms.txt frames it correctly as "first-valid-wins failover across providers" (NOT a vote — distinct from consensus). It also propagates approval gates inside race branches (`:5513`). Substantive and well-implemented.

### 6. EU / data-residency — SUBSTANTIVE and ENFORCED (notable)
This is enforced in the executor, not advisory. `PROVIDER_REGISTRY` tags each model with `region` ("eu"/"us"/"local"): Mistral models are `region="eu"`, Ollama/oMLX/NIM are `region="local"`. `providers.py:445 get_alternatives(..., data_residency="")` filters failover candidates: "only models whose region matches the requirement are returned. If no alternatives satisfy the residency constraint the caller should fail rather than cross the [boundary]" (`:460` skips mismatched regions). Spark auto-route refuses to flip when `data_residency == "eu"` (`:241`). README: "the engine raises before any step could route data off-box — enforcement in the executor, not a policy PDF." This is the one place Sandcastle's enforcement gets close to "structural," but note it gates *model/provider routing by region*, not individual agent tool calls — adjacent to Edictum's wedge, not the same.

### 7. Dashboard — SUBSTANTIVE (large)
29 page components in `dashboard/src/pages/` (MissionControl, RunDetail, RunCompare, TimeMachine, Evolution, Optimizer, Compliance, Approvals, DeadLetter, Fleet, NightShift, Violations, WorkflowBuilder, etc.) plus 19 component groups. Onboarding wizard page is real (`pages/Onboarding.tsx` → `OnboardingWizard`), with graceful localStorage fallback for private browsing. A live no-backend demo is published (gizmax.github.io/Sandcastle). Workflow builder has hover-help/StepConfigPanel/ToolSelector/TemplateBrowser. This is a real product UI, not screenshots.

### 8. Hub / registry — SUBSTANTIVE
`hub/registry.json` (v2, 181 templates) with per-template metadata: models_used, step_count, estimated_cost_per_run, avg_execution_time, downloads, remix_count, forked_from, rating, sha256, full input_schema. Curated collections (Sales Stack, Content Machine, DevOps Essentials). CLI: `hub list/search/collections/install/install-collection/publish`. Remix/lineage tracking and a PR-based community submission flow (`hub/README.md`). The download_count/rating/review fields look seeded/aspirational (e.g. exactly 70 downloads, 10 reviews) — that part is light. The mechanism and schema are real; the "community" liveness is unproven.

### 9. Verified templates / `.sctpl` cassette system — SUBSTANTIVE (most distinctive)
`docs/verified-templates.md` + `engine/cassette.py` (referenced) + executor support (`executor.py:1906` replay, `:2197` record). A cassette keys each step output on `sha256(tenant:workflow:step_id:model:resolved_prompt)`; `sandcastle template verify x.sctpl` replays the bundled cassette offline at $0 with two tamper traps (manifest checksum + cache-key mismatch on any prompt/model/id change; strict mode aborts on miss rather than calling a provider). `hub/template-index.json` indexes verified `.sctpl` bundles with their sha256. This is genuinely clever DX/testing infra: deterministic, zero-cost, tamper-evident template proofs. Substantive and differentiated.

### 10. Onboarding / quickstart — SUBSTANTIVE
README Quickstart has three clean paths (Docker one-command, manual uv, pip SDK), plus the local-first `init`/`serve` path. `docker compose up -d` gives Postgres 16 + Redis 7 + auto-migrations + arq worker. Clear and honest.

### 11. Docs quality — SUBSTANTIVE (strong)
`docs/tool-examples-convention.md` is a standout: a real contract for connector authors citing measured eval gains ("Tool selection accuracy 49%→74%" once tool-search subsets the tools; "Parameter-shape accuracy 72%→90%" once tools carry 1-5 worked examples). Mandates ToolDefinition shape (name/description≥20 chars/JSON-Schema params/1-5 examples/tags). README is 103KB with a deep TOC; SPEC.md 22KB; CHANGELOG 48KB. This is unusually disciplined doc engineering.

### 12. llms.txt / llms-full.txt — SUBSTANTIVE (very nice)
`llms.txt` (29 lines) is a tight, accurate agent-facing index: positioning, core concepts (workflow format, providers, model-independence patterns), template categories, connectors, install one-liner. `llms-full.txt` (161 lines) is described as "the full YAML schema for all 25 step types, enough to author valid workflows." This is exactly the artifact you want so an LLM can author workflows without reading the whole repo. Excellent DX.

## Does any of this overlap Ductum/Edictum's wedge?
No core overlap. Sandcastle gates *provider/model routing by region* (residency) and *pipeline step ordering* (DAG, approval/human steps), plus audit logging — all adjacent orchestration/sandbox/audit surfaces. It does NOT intercept and authorize every individual agent tool call against a fail-closed policy before the side effect, and stage advancement is DAG-dependency driven, not validated-evidence-gated in Edictum's sense. The closest structural enforcement is the residency check in `get_alternatives`/Spark autoroute.

**Evidence:**
- `/tmp/sc-dd/.env.example` — Documents zero-config: empty DATABASE_URL/REDIS_URL -> SQLite + filesystem + in-process queue automatically; STORAGE_BACKEND=local default.
- `/tmp/sc-dd/src/sandcastle/__main__.py` — init wizard (:5284, :6105 maps _cmd_init), doctor diagnostics (:1711 _cmd_doctor); full CLI surface includes hub, audit, fork, replay, eval, providers, tools.
- `/tmp/sc-dd/src/sandcastle/engine/providers.py` — PROVIDER_REGISTRY (:33) = single source of truth with per-model input/output pricing and region tags (mistral=eu, ollama/omlx/nim=local); get_alternatives (:445) filters failover by data_residency region; Spark autoroute refuses when residency=eu (:241).
- `/tmp/sc-dd/src/sandcastle/engine/evolution.py` — _build_cost_estimates (:154) computes per-model cost from PROVIDER_REGISTRY with blended 2:1 input:output ratio — cost intelligence is real, not a badge.
- `/tmp/sc-dd/src/sandcastle/engine/executor.py` — _execute_race_step (:5383) parallel branches, first-valid-wins, cancel rest (:5437); cassette replay (:1906) and record (:2197) for deterministic offline runs.
- `/tmp/sc-dd/docs/verified-templates.md` — .sctpl bundle = workflow + recorded cassettes + checksummed manifest; sha256(tenant:workflow:step_id:model:resolved_prompt) cache keys; replay offline at $0 with two tamper traps; strict miss aborts rather than calling provider.
- `/tmp/sc-dd/docs/tool-examples-convention.md` — Connector-author contract citing measured eval gains: tool-selection 49%->74% with tool-search, param-shape 72%->90% with 1-5 worked examples per tool; mandates ToolDefinition shape.
- `/tmp/sc-dd/llms.txt` — Tight agent-facing index: positioning, workflow format, 7 providers, model-independence patterns (race/consensus/two-judge), template categories, 60+ connectors, install one-liner; llms-full.txt has full 25-step-type schema.
- `/tmp/sc-dd/hub/registry.json` — v2 registry, 181 template slugs with rich metadata (models_used, step_count, estimated_cost_per_run, avg_execution_time, downloads, remix_count, rating, sha256, input_schema); download/rating fields look seeded.
- `/tmp/sc-dd/hub/template-index.json` — Index of verified .sctpl bundles with sha256 pinning and recorded cassettes that `sandcastle template verify` replays offline at $0.
- `/tmp/sc-dd/README.md` — Quickstart (Docker one-command, manual uv, pip SDK); 'Start Local. Scale When Ready.' progressive-scaling table; TOC lists 22 Step Types, 62 integrations; counts disagree with llms.txt (165) and on-disk (248 yaml).
- `/tmp/sc-dd/dashboard/src/pages/Onboarding.tsx` — Real onboarding wizard page (OnboardingWizard) with graceful localStorage fallback; 29 dashboard pages total incl MissionControl, TimeMachine, Optimizer, Compliance, Approvals.

</details>

### maturity-traction

Single-author (Tomas Pflanzer) source-available product at v0.40.0 beta. Polished and broad, maintained, but early; tests coverage-padded; governance adjacent to Edictum, not the same wedge.

- Single-author BSL-1.1 v0.40.0 beta, no team
- Tests coverage-padded, 217/291 mock-heavy
- Wedge adjacent, not per-tool-call gating

<details><summary>Detail & evidence</summary>

Solo BSL-1.1 beta, open-core SaaS, no team; tests coverage-padded and mock-heavy; governance adjacent, not runtime per-tool-call gating.

**Evidence:**
- `/tmp/sc-dd/pyproject.toml` — Sole author; Beta; BSL-1.1
- `/tmp/sc-dd/tests/test_coverage_final.py` — Coverage-padding; mock-heavy

</details>

