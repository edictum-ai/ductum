# CLAUDE.md — Ductum

## ACTIVE MISSION (2026-06-23)

**Restart stabilization after the Ductum redo.** This checkout is the renamed
`ductum-next` redo and is now the active `edictum-ai/ductum` repository.

Do not use the legacy `/Users/acartagena/project/ductum` checkout as active
source. The redo phase1/phase2 work is folded into `main`; old phase handoffs
are historical unless the user explicitly asks for reconstruction.

Current priority is stabilization before unattended dogfood: reviewer
completion integrity, ghost active runs, process cleanup, real cost
accounting, CI gate honesty, bakeoff state truth, Copilot permission shape,
sandbox proof, shell command worktree scope, and issue migration.

Bootstrap redesign is not the active mission. It remains paused by D161 until a
separate audit/resume decision changes that state.

The operational hardening bundle shipped to main as D136-D145, implementing
the D135 agent-first control plane contract; new CLI surfaces still honor that
contract.

Drive Ductum via the `ductum-cli` skill. No curl, no SQLite, no
hand-edited yaml.

**Recovery closed (2026-05-02) as Outcome A.** All seven P-stages
of `factory-readiness-recovery` merged to main. The factory runs
itself; dispatcher / post-completion pipeline / reviewer chain /
approval gate / merge orchestration all proven end-to-end. The exit-
demo wall-clock was not honestly verified this session because the
bootstrap prereq over-checks `ANTHROPIC_API_KEY` against
subscription-auth-only environments — which D130 is the fix for.
Closeout: `decisions/131-factory-readiness-recovery-closeout.md`.

## What this repo is

Ductum is an AI factory control plane powered by Edictum. It models product
work as declarative resources, assigns agents, enforces workflow stages via
embedded `@edictum/core`, and provides CLI/UI/notification surfaces for
visibility and approvals. Local-first, future SaaS.

This repo has working code. This file is a historical orientation doc; the
current source of truth is the redo design pack in `design/README.md`,
`design/01-shape.md` through `design/06-dx-onboarding.md`,
`design/parallel/unattended-factory-hardening/`, and decisions `172` through
`179`.

## Key documents (read in this order)

1. `AGENTS.md` — required rules for agents working in this repo
2. `design/README.md` — current redo design map
3. `design/parallel/unattended-factory-hardening/README.md`
4. decisions `172` through `179`
5. `README.md` and `docs/CLI_ONBOARDING.md` for current local usage

## Critical design constraints (from adversarial review)

These were hard-won through 3 rounds of Codex review. Do not violate them.

### C1: Enforcement is local, not remote

Ductum Core embeds `@edictum/core` (TypeScript SDK). Gate evaluation happens in-process. edictum-api is an OPTIONAL audit/storage sink, not the enforcement backend. This matches how Edictum actually works — all three SDKs evaluate locally.

### C2: Enforcement is structural, not advisory

Agents do not choose to call Ductum tools. The harness intercepts tool calls at the infrastructure level. SKILL.md / CLAUDE.md instructions to agents are NOT enforcement — they are advisory and agents ignore them (proven by WhatsApp evidence in CONTEXT.md).

### C3: authorize_tool is internal, gate_check is agent-visible

Two distinct enforcement paths:
- `authorize_tool(run_id, tool, args)` — harness-internal, every intercepted tool call, not in MCP surface
- `gate_check(run_id, target_stage)` — agent-visible MCP tool, stage advancement request

Do NOT conflate these.

### C4: Agents do not self-reset

Ductum Core owns all resets. Agents/watchers report failure and evidence. Ductum Core evaluates and triggers resets. `ductum.reset()` is NOT in the agent-visible MCP surface.

### C5: Session-to-run binding is authoritative

Ductum Core maintains `opencode_session_id → ductum_run_id` mapping. The run_id is NOT injected in prompt text. The plugin passes session identity; Ductum Core resolves.

### C6: CI and review are parallel latches

After push, CI and review run independently. Both must resolve before the merge gate. They are NOT sequential. Pre-push review is a gate BEFORE pushing (saves CI runs).

### C7: fixing ≠ implementing

`fixing` is a narrower remediation mode with specific findings to address. `implementing` is building from scratch. Different allowed actions, different evidence requirements, separately trackable for cost.

## Tech stack

- Ductum Core: TypeScript
- Enforcement: @edictum/core (TS SDK, embedded)
- Persistence: SQLite
- MCP Server: TypeScript
- CLI: TypeScript
- Dashboard: React + Vite
- Claude harness: Claude Agent SDK (TS)
- Non-Claude harness: OpenCode serve (HTTP API)
- Audit storage: edictum-api (Go, optional)

## Related repos

- `edictum-ai/edictum` — Python SDK (0.17.0, most mature)
- `edictum-ai/edictum-ts` — TypeScript SDK (0.3.1, @edictum/core)
- `edictum-ai/edictum-go` — Go SDK (0.3.0)
- `edictum-ai/edictum-api` — Go API server (audit/storage)
- `edictum-ai/edictum-harness` — manual predecessor to Ductum (specs, process docs)
- `edictum-ai/edictum-schemas` — shared schema definitions

## Current phase: Post-P9 hardening

The operational model redesign is complete. Ductum now needs the parked
hardening stages in `specs/current/post-p9-hardening/README.md`.

### Active next prompt

Use the next explicit stage prompt under `specs/current/post-p9-hardening/`
when it exists. Do not implement parked hardening items from the README alone.

### Historical implementation specs

The `specs/impl-*` directories are historical records and import fixtures.
Read them when investigating old implementation choices, but do not treat them
as the active roadmap.

### Implementation rules

- **pnpm workspace monorepo.** Root `pnpm-workspace.yaml`, workspace dependencies between packages.
- **Vitest for testing.** Every prompt has a verification checklist — run it before marking done.
- **No file over 300 LOC.** Split if needed (spec says this explicitly).
- **Honor the session-binding decisions.** Especially D22 (agents never pass
  run_id), D24 (session key is run.id), D25 (dispatcher sole owner of session
  mapping), D27 (WorkflowRuntime per-run).
- **Honor all 7 constraints (C1-C7).** These were hard-won through adversarial review.
- **Read the Required Reading section** of each prompt before implementing. Don't guess at @edictum/core APIs — read the actual source in edictum-ts.
- **Run the verification checklist** at the end of each prompt. Don't skip items.

### How file size is enforced

`scripts/check-file-size.mjs` scans `packages/**/*.{ts,tsx}` and fails when a
non-grandfathered source or test file exceeds 300 LOC. Current exceptions live
in `decisions/112-file-size-grandfather-list.md`; remove entries as splits land.

### Decisions to watch for

| Decision | Rule | Violation to avoid |
|----------|------|--------------------|
| D22 | MCP per-session binding | Never accept run_id from agent in MCP tools |
| D24 | Session key = run.id | Never use harness sessionId as @edictum/core session key |
| D25 | Dispatcher sole owner | Only dispatcher creates session_run_mapping entries |
| D26 | Watchers as child runs | Must create Run records, dedup by commit SHA |
| D27 | Runtime per-run | Never share WorkflowRuntime across runs |
| D28 | Real @edictum/core API | StorageBackend is 4 methods (get/set/delete/increment), NOT session-aware. Use setStage() forward, reset() backward. Never call recordResult(). |

### Supply chain security rules

These are mandatory for all AI assistants and human contributors. See `SECURITY.md` for rationale.

- Never use `^` or `~` in dependency version specifiers. Always pin exact versions.
- Always commit the lockfile (`pnpm-lock.yaml`). Never delete it or add it to `.gitignore`.
- Install scripts are disabled. If a new dependency requires a build step, it must be explicitly approved and added to `pnpm.onlyBuiltDependencies` in `package.json`.
- New package versions must be at least 1 day old before they can be installed (release age gating).
- When adding a dependency, verify it on npmjs.com before installing.
- Prefer well-maintained packages with verified publishers and provenance.
- Run `pnpm install` with the lockfile present — never bypass it.
- Do not add git-based or tarball URL dependencies unless explicitly approved.
- Do not run `npm update`, `npx npm-check-updates`, or any blind upgrade command. Review each update individually.
- Use deterministic installs: `pnpm install --frozen-lockfile` in CI and scripts.
- Do not store secrets in plain text in `.env` files committed to version control.

## Style rules

- Terminology: `rules` not `contracts`, `blocked` not `denied`, `pipeline` not `engine`
- Decisions are append-only with date, context, alternatives, who decided
- Specs use numbered sections, acceptance criteria, non-goals, dependencies
- Implementation prompts are self-contained — an agent can pick one up cold
