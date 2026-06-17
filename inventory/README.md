# Ductum — Feature Inventory & Disposition Map

*Inventory date: 2026-06-16. Source: 19 domain readers, 190 catalogued features.*

**How to read this.** This is a map, not a plan. Every feature carries a *disposition* — KEEP, REUSE, REDESIGN, REMOVE, or DECIDE — but each one is a **recommendation from the domain reader, not a settled decision**. The operator owns every call. Use the Executive summary for the shape of the codebase, the Master table to scan all 190 rows, the Legacy section to see what is dead or retired-but-undeleted, and the Decisions-needed list at the end for the forks that genuinely need an operator ruling.

---

## Disposition legend

| Disposition | Meaning |
|---|---|
| **KEEP** | Live, correct, fits the current operator model. Leave as-is; maintain normally. |
| **REUSE** | The capability/data is right but should sit behind a cleaner boundary later. Don't rewrite now; don't promote as final shape either. |
| **REDESIGN** | The capability is needed but the current structure, confinement, or semantics are wrong. Rework deliberately. |
| **REMOVE** | Dead or retired-but-undeleted. Delete (after any noted one-time migration). |
| **DECIDE** | A genuine fork the reader could not resolve from code alone. Operator must choose direction. |

---

## Executive summary

**190 features catalogued across 19 domains.**

**By disposition:**

| Disposition | Count | Share |
|---|---|---|
| KEEP | 122 | 64% |
| REUSE | 31 | 16% |
| REDESIGN | 17 | 9% |
| REMOVE | 10 | 5% |
| DECIDE | 10 | 5% |

**By maturity:**

| Maturity | Count |
|---|---|
| live-core | 140 |
| live-peripheral | 31 |
| legacy-retired | 10 |
| dead-unused | 5 |
| experimental | 4 |

**By operator risk:** none 108, partial 67, high 15.

**Top REMOVE / dead candidates (10 REMOVE rows + 15 legacy-retired/dead-unused maturities):**
- **OpenCode harness family** — `opencode.ts` + 5 support modules + `plugin/index.ts`, not in registry, ~9 tests for unreachable code; backlog already schedules removal.
- **Target vocabulary** — `routes/targets.ts`, `SqliteTargetRepo`, `repos/target.ts`, migrations 022/024; retired by D169 but still shipped and partly wired as a bridge.
- **Dead dashboard components** — `TreeNavigator.tsx` (352 LOC, 0 importers, still holds a D112 grandfather slot) and `RelativeTime.tsx` (0 importers).
- **`tool-output-guards.ts`** — exported from core index, zero production consumers.
- **Dead CLI api-client methods** — `getTargets/createTarget/getResources/...` with no calling command.
- **Legacy dashboard routes** `/specs` (SpecList) and `/agents` (AgentList) — self-labeled "Legacy", off-nav.
- **`resolve-latch` route** — `@deprecated`, zero consumers.
- **File-size grandfather list drift** — ~9 stale entries (41 listed vs 32 actually oversize).

**Highest operator-risk surfaces (15 rated `high`):** the single dominant theme is the **host-env secret leak** — it appears as four separate high-risk rows (`dispatch-runtime` secrets inheritance, `enforcement-gates` host-env leak, `secrets` per-agent secretAccessRefs, `sandbox-cost` secrets-at-dispatch), all pointing at `claude.ts:186-188` and `codex-mcp-config.ts:25-34` spreading the entire host `process.env` into spawned agents while the encrypted FactorySecret system is wired only to notifications. Other high-risk rows: `activeSessions` in-memory coupling, crash-retry-from-scratch, the cost-scanner reading the operator's whole home tree, silent $0 Codex cost recording, the DAG evaluator's `getLatestRun` ordering assumption, `task-scope` three-tier resolution, the untested double-wired Copilot adapter, the OpenCode dead family, and the two retired Target/Resource public surfaces.

**Biggest REDESIGN themes (17 rows):**
1. **Secret scoping at dispatch** (4 rows) — replace blanket `process.env` inheritance with an allowlisted, FactorySecret-sourced env.
2. **Sandbox & cost confinement** (4 rows: sandbox runtime, cost scanner, cost recording, secrets-at-dispatch) — everything is laptop-bound; host/worktree is the only driver, cost reads home-dir logs, Codex can silently record $0.
3. **Recovery granularity** (2 rows: dispatch worker-death + recovery crash/stall) — retry rebuilds the whole task from `understand` with a fresh worktree, no checkpoint, crash-vs-heartbeat asymmetry.
4. **Structural smells** — the 6-level DispatcherBase inheritance + 16-arg ctor, non-idempotent evidence INSERT, DAG bakeoff coupling, dashboard dual color vocabularies, MCP HTTP route auth tied to loopback, Factory catalog write dual-surface, untested Copilot adapter.

---

## Master disposition table

*All 190 features, grouped by domain.*

### dispatch-runtime — Dispatch & Runtime
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| dispatch-runtime | Poll/dispatch cycle | live-core | solid | partial | KEEP | Loop shape sound, fits the model. |
| dispatch-runtime | Agent matching & health gating | live-core | adequate | partial | KEEP | Fits model; regex failure-classification is the soft spot. |
| dispatch-runtime | Dispatch & session spawn (D22/D24/D25 binding) | live-core | solid | none | KEEP | Session→run binding is authoritative. |
| dispatch-runtime | In-process activeSessions map | live-core | fragile | high | REUSE | Right data; live-object-in-memory is what a redesign must sit behind. |
| dispatch-runtime | 6-level inheritance + 16-arg ctor | live-core | fragile | none | REDESIGN | Deep inheritance exists to satisfy 300-LOC rule; use options-object/composition. |
| dispatch-runtime | Session-end routing & completion fallback | live-core | solid | partial | KEEP | Robust outcome handling. |
| dispatch-runtime | Worker-death recovery (stall/crash retry) | live-core | fragile | partial | REDESIGN | Retry-from-`understand` loses progress; granularity is the gap. |
| dispatch-runtime | Startup orphan reconcile / reattach (D121) | live-core | solid | none | KEEP | Mature, security-conscious recovery. |
| dispatch-runtime | Runtime resource resolution | live-core | solid | none | KEEP | Solid; internal `resource` store, not retired user surface. |
| dispatch-runtime | Secrets inherited into spawned agents | live-core | broken | high | REDESIGN | Need allowlisted env from FactorySecret, not blanket process.env. |
| dispatch-runtime | Stale-slot GC & heartbeat refresh | live-core | adequate | partial | KEEP | Necessary divergence reconciliation; only the magic constant smells. |

### enforcement-gates — Enforcement & Gates
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| enforcement-gates | EnforcementManager (authorize_tool + per-run runtime) | live-core | adequate | partial | KEEP | Correct C1/C3 core; 632-LOC grandfathered, `done`-guard load-bearing. |
| enforcement-gates | gate_check + ductum.workflow (read-only) | live-core | solid | none | KEEP | Correct post-redesign shape; honors C3/C4. |
| enforcement-gates | SqliteStorageBackend (4-method, D28) | live-core | solid | none | KEEP | Faithful to D28; the only adapter Edictum needs. |
| enforcement-gates | Workflow command-scope guard | live-core | adequate | partial | KEEP | Real boundary; treat as best-effort, not airtight. |
| enforcement-gates | Shell-read detection | live-peripheral | adequate | none | KEEP | Fail-closed posture correct; a miss costs evidence, not safety. |
| enforcement-gates | External-review gate (deriveShipState) | live-core | solid | none | KEEP | Clean verify-before-ship / C6 expression. |
| enforcement-gates | Execution-integrity policy | live-peripheral | adequate | partial | REUSE | Sound policy, but carries bakeoff coupling + raw-enum surface. |
| enforcement-gates | tool-output-guards | dead-unused | adequate | none | REMOVE | Zero production consumers; MCP zod already covers the use. |
| enforcement-gates | Host env inheritance leak | live-core | fragile | high | REDESIGN | Full host env reaches agents; FactorySecret bypassed on dispatch. |

### evidence-audit — Evidence & Audit
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| evidence-audit | Typed evidence kinds + runtime validation | live-core | solid | none | KEEP | Closed kind union with runtime guards. |
| evidence-audit | Evidence persistence (SqliteEvidenceRepo) | live-core | fragile | partial | REDESIGN | Non-transactional, non-idempotent INSERT; retry duplicates or throws. |
| evidence-audit | Public output redaction | live-core | solid | partial | KEEP | Central, well-tested; right shape for the audit boundary. |
| evidence-audit | Literal-secret rejection (D171) | live-core | solid | none | KEEP | Prevention complements redaction. |
| evidence-audit | Execution-integrity evidence parsing | live-core | adequate | partial | KEEP | Central; prose heuristics are a known bounded tradeoff. |
| evidence-audit | Reconcile audit trail | live-core | adequate | partial | REUSE | Lineage sound but sits on the evidence write path needing hardening. |
| evidence-audit | CLI/dashboard transcript surfaces | live-core | solid | none | KEEP | Purpose-built operator-legible audit views. |
| evidence-audit | MCP evidence/link tools | live-core | solid | none | KEEP | Correct session-binding discipline (D22/C5). |
| evidence-audit | Marketing "fleet" evidence fixture | live-peripheral | adequate | none | KEEP | Legit marketing asset; must stay fenced from real audit. |

### recovery-interruption — Recovery & Interruption
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| recovery-interruption | Orphan session reconcile (restart reattach) | live-peripheral | fragile | partial | REUSE | Stall path right; reattach is aspirational, no adapter implements it. |
| recovery-interruption | RunStateMachine (terminal-state owner) | live-core | solid | none | KEEP | Clean, correct, C4-compliant. |
| recovery-interruption | Crash/stall retry policy | live-core | fragile | high | REDESIGN | Retry-as-fresh-run loses cost/progress; needs checkpoint/resume. |
| recovery-interruption | Heartbeat stall + stale-slot GC | live-core | adequate | partial | KEEP | Guarded against false positives; minor redundancy. |
| recovery-interruption | WatcherManager (CI/review latch) | live-core | solid | none | KEEP | Correct C6 — CI and review as independent latches. |
| recovery-interruption | Failed-lineage cleanup | live-core | solid | partial | KEEP | Correct, guarded cascade-close. |
| recovery-interruption | API-side DB reconcile pass | live-peripheral | adequate | partial | REUSE | Sound, but audit which branches are live vs pre-D166 cruft. |

### post-completion — Post-Completion Pipeline
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| post-completion | Review/fix/verify lineage router | live-core | solid | partial | KEEP | Proven orchestration spine; targetId still threaded (D169). |
| post-completion | Reviewer verdict parser | live-core | solid | none | KEEP | Hardened across D060/D116/D123; well-tested. |
| post-completion | Worktree verification | live-core | adequate | partial | REDESIGN | Capability right but laptop-bound and verify env leaks secrets. |
| post-completion | Review/fix/rebase prompt builders | live-core | solid | none | KEEP | Bounded, guardrailed, parser-locked. |
| post-completion | Best-of-N blind-review routing | live-peripheral | adequate | high | REUSE | Sound bakeoff foundation; should sit behind a clearer outcome surface. |
| post-completion | Auto-commit of dirty worktrees | live-core | solid | none | KEEP | Targeted fix for real Codex-harness behavior. |
| post-completion | Git artifact sync | live-core | solid | none | KEEP | Small, correct, load-bearing for merge/approval. |
| post-completion | Worktree snapshot evidence | live-core | solid | none | REUSE | Keep behind the sealed-bundle boundary. |
| post-completion | WorktreeManager | live-core | adequate | partial | REUSE | Solid local impl; sit behind future container/remote sandbox. |
| post-completion | maxFixIterations resolution | live-core | adequate | none | REUSE | Keep; remove `maxReviewRounds` fallback once callers migrated. |

### workflow-model — Workflow Model & DAG
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| workflow-model | WorkflowProfile parse + render | live-core | solid | partial | KEEP | Source of truth for profile→definition; delete 3 dead helpers. |
| workflow-model | WorkflowProfile materialization + snapshot | live-core | solid | none | REUSE | Part of the sealed job bundle. |
| workflow-model | WorkflowDefinition resolver | live-core | adequate | partial | KEEP | Precedence right; harden the exact README string match. |
| workflow-model | Recorded-success stage auto-advance | live-core | adequate | partial | KEEP | Fills the gap recordResult alone leaves; reconcile D28 conflict. |
| workflow-model | Tool-arg path/command normalization | live-core | solid | none | KEEP | Real local enforcement primitive (C2). |
| workflow-model | Spec/Task DAG evaluator | live-core | adequate | high | REDESIGN | Essential, but recovery semantics + bakeoff coupling + ordering assumption. |
| workflow-model | Task scope resolution | legacy-retired | adequate | partial | REUSE | Keep `task` path; carve `target`/`legacy-repos` behind a migration boundary. |
| workflow-model | Task lineage parser | live-core | solid | none | KEEP | Small, correct, central to review/fix lineage. |
| workflow-model | Harness workflow hint | live-peripheral | adequate | none | KEEP | Advisory-only (C2), correctly not enforcement. |
| workflow-model | .edictum/workflow-profile.yaml | live-core | solid | none | KEEP | Canonical onboarding artifact. |

### factory-settings — Factory Settings & Catalogs
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| factory-settings | Model registry (single source, D163) | live-core | solid | none | KEEP | Clean single-source; excludes github-copilot. |
| factory-settings | Model pricing (compute + OpenRouter) | live-core | solid | partial | KEEP | Correct; stale grandfather note to remove. |
| factory-settings | Factory Settings catalog builder | live-core | solid | none | KEEP | Canonical read model. |
| factory-settings | Agent-compatibility validation | live-core | adequate | none | KEEP | Genuinely on the dispatch path; typed errors. |
| factory-settings | Factory runtime/budget PATCH handlers | live-core | solid | partial | KEEP | Clean validate-before-mutate write path. |
| factory-settings | Factory catalog routes (read-only) | live-peripheral | adequate | partial | REDESIGN | P1 stub split from real CRUD; the two should converge. |
| factory-settings | Config resource CRUD route | live-core | solid | partial | REUSE | Sound write foundation; should sit behind Factory Settings boundary. |
| factory-settings | Initial factory seed | live-core | adequate | none | REUSE | Correct bootstrap; prune Copilot branch. |
| factory-settings | Operator contract types/mappers/errors | live-core | solid | none | KEEP | Clean public boundary; only Target bridge is legacy. |

### secrets — Secrets
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| secrets | Factory secret crypto (AES-256-GCM) | live-core | solid | none | KEEP | Correct, minimal, well-guarded crypto. |
| secrets | Factory secret resolver | live-peripheral | adequate | partial | REUSE | Right primitive; needs dispatch-time env-injection boundary. |
| secrets | Secret ref grammar (secret:<id>) | live-core | solid | none | KEEP | Small, correct, central. |
| secrets | Literal-secret detection on input | live-core | adequate | partial | KEEP | Good defensive gate; treat as best-effort. |
| secrets | Public-output redaction | live-core | solid | none | KEEP | Central to keeping plaintext out of API responses. |
| secrets | Secret storage repo + DB schema | live-core | solid | none | KEEP | Clean metadata-vs-ciphertext separation. |
| secrets | Factory secrets HTTP routes | live-core | solid | none | KEEP | Correct write-only REST surface. |
| secrets | Dashboard SecretsPanel | live-core | solid | none | KEEP | Careful write-only UI. |
| secrets | Per-agent secretAccessRefs (never injected) | experimental | fragile | high | REDESIGN | Display-only stub disconnected from dispatch; full env leaked instead. |

### sandbox-cost — Sandbox & Cost
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| sandbox-cost | Sandbox runtime (host-worktree driver) | live-core | solid | partial | REDESIGN | Correct for laptop; can't express container/remote isolation. |
| sandbox-cost | Local-log cost scanner | live-core | adequate | high | REDESIGN | Reads operator's whole home tree; silent-null feeds cost-shows-0. |
| sandbox-cost | Model pricing resolution | live-core | solid | partial | KEEP | Fits the model; ignores untrusted harness-reported costs. |
| sandbox-cost | Cost budget gate (D114) | live-core | solid | partial | KEEP | Pre-write refusal prevents overshoot; per-spec recompute is a scaling watch. |
| sandbox-cost | Budget extend/deny controls (D114) | live-peripheral | solid | none | KEEP | Clean recovery fitting the model. |
| sandbox-cost | Max-turns gate + controls (D118) | live-peripheral | solid | none | KEEP | Claude-specific but correctly scoped. |
| sandbox-cost | Cost recording at session end | live-core | fragile | high | REDESIGN | Silent $0 for Codex on scanner miss; needs unmeasured marker. |
| sandbox-cost | Secrets at dispatch (env inheritance) | live-core | broken | high | REDESIGN | Blanket process.env; sandbox descriptor falsely claims credentials:none. |

### repair-bakeoff — Repair & Bakeoff
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| repair-bakeoff | Repair readiness report engine | live-core | solid | none | KEEP | Primary readiness surface, on current vocabulary. |
| repair-bakeoff | Repair execution / attempt-recovery | live-core | solid | none | KEEP | Current, well-covered recovery legibility. |
| repair-bakeoff | Dispatch prerequisite gate | live-core | solid | none | KEEP | Correct reuse of the readiness model at the gate. |
| repair-bakeoff | Repair CLI + dashboard surface | live-core | adequate | none | KEEP | Operator-facing presentation of a solid model. |
| repair-bakeoff | Bakeoff creation (Best-of-N) | live-core | adequate | partial | REUSE | Sound flow; hardcoded model IDs should move behind policy. |
| repair-bakeoff | Bakeoff blind-review winner router | live-core | solid | partial | KEEP | What makes bakeoff live; guarded and tested. |
| repair-bakeoff | Bakeoff verdict parsing & outcome | live-core | solid | none | KEEP | Security-relevant blind-review parser, well-guarded. |
| repair-bakeoff | Bakeoff compare / scoring read model | live-core | adequate | partial | KEEP | Primary legibility surface; dedupe verdict guard later. |

### data-model — Data Model & Migrations
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| data-model | Migration ledger (db-migrations.ts) | live-core | solid | partial | KEEP | Append-only audit ledger; grown 819→1169 LOC invisibly. |
| data-model | Core record types | live-core | solid | partial | KEEP | Accurate model; deprecations honestly flagged. |
| data-model | Repository/Component model + materializer | live-core | solid | none | KEEP | Live post-D169 scope vocabulary. |
| data-model | Repository/Component repos | live-core | solid | none | KEEP | Intended primary scope persistence. |
| data-model | Task scope resolution | live-core | adequate | high | REUSE | Keep resolver; should sit behind one sealed scope. |
| data-model | Targets table + Target repo/types | legacy-retired | adequate | partial | REMOVE | Superseded by Repository/Component (D169); delete after backfill. |
| data-model | ConfigResource table + repo | live-core | solid | partial | REUSE | Sound storage; retired `resource` naming behind typed DTO boundary. |
| data-model | AttemptRuntimeSnapshot + builder | live-core | solid | none | REUSE | Seals ~7/9 bundle fields; doesn't yet seal secrets/host. |
| data-model | OperatorAttempt snapshot facade | live-core | solid | none | KEEP | Correct, well-bounded legacy-compat shim. |
| data-model | DB init + inspection | live-core | solid | none | KEEP | Minimal correct migration runner. |
| data-model | File-size grandfather gate | live-peripheral | fragile | partial | DECIDE | Path-only exemption silently erodes the 300-LOC rule. |

### cli-surface — CLI Surface
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| cli-surface | init / start (serve) bootstrap | live-core | solid | none | KEEP | Canonical entry point; verify Copilot/seed init steps. |
| cli-surface | project / spec / task admin | live-core | solid | none | KEEP | Direct expression of the primitive model. |
| cli-surface | repository command group | live-core | solid | none | KEEP | P7 Repository rename landing surface. |
| cli-surface | attempt start (dispatch + live progress) | live-core | adequate | none | REUSE | Shape fine; blocking SSE rides the live-session lifecycle. |
| cli-surface | approval / lifecycle ops | live-core | solid | none | KEEP | Clean approval-boundary wedge; stale grandfather entry. |
| cli-surface | status (overview + detail) | live-core | solid | none | KEEP | Central legibility surface; per-task fan-out quadratic at scale. |
| cli-surface | watch (live event stream) | live-core | solid | none | KEEP | Makes blocked/approval activity visible. |
| cli-surface | logs / transcript | live-core | solid | partial | KEEP | Bounded, operator-legible. |
| cli-surface | repair | live-core | solid | none | KEEP | D169-sanctioned recovery entry point. |
| cli-surface | spec intake / import | live-core | solid | none | KEEP | Markdown import current; YAML correctly demoted. |
| cli-surface | spec bakeoff (best-of-N) | live-peripheral | adequate | partial | REUSE | Sound; expect name-based scope resolution to wrap raw-id flags. |
| cli-surface | factory settings (read-only) | live-peripheral | adequate | none | KEEP | Thin accurate window onto Factory Settings. |
| cli-surface | attempt-actions / next-action helpers | live-core | solid | none | KEEP | Single source for command strings; prevents drift. |

### api-surface — API / HTTP Surface
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| api-surface | Runs router (runs.ts + run-control.ts) | live-core | solid | none | KEEP | Core execution surface; 527 LOC grandfathered. |
| api-surface | Run-control internal endpoints | live-core | adequate | partial | REUSE | Keep authorize-tool; relocate unauthenticated plugin-probe. |
| api-surface | Projects router | live-core | adequate | none | KEEP | Top-level entity; legacy `project.repos` mirror. |
| api-surface | Repositories / Components router | live-core | adequate | none | KEEP | Correct surface; remove Target bridge post-migration. |
| api-surface | Targets router (legacy) | legacy-retired | adequate | partial | REMOVE | Retired by D169, still registered, dead CLI client. |
| api-surface | Config-resources router | live-peripheral | adequate | partial | REUSE | Data live; should sit behind Factory Settings, not standalone. |
| api-surface | Factory + Factory Settings routers | live-core | solid | none | KEEP | Implements the D166 Factory Settings model. |
| api-surface | Factory secrets router | live-peripheral | solid | none | KEEP | Sound encrypted secret-store API. |
| api-surface | Specs/Spec-intake/Tasks/Task-sync | live-core | solid | none | KEEP | Central to the operator model; Target lingers in import paths. |
| api-surface | Agents + Bakeoffs routers | live-core | solid | none | KEEP | Agents core; bakeoffs well-built but peripheral. |
| api-surface | Events (SSE) router | live-core | solid | none | KEEP | Normalized, enveloped, redacted event surface. |
| api-surface | Telegram router | live-peripheral | solid | none | KEEP | The one wired notification backend. |
| api-surface | Welcome-handoff router | live-peripheral | solid | none | KEEP | Onboarding-critical, well-guarded. |
| api-surface | Search router | live-peripheral | solid | none | KEEP | Safe parameterized SQL, bounded. |
| api-surface | MCP transport router | live-core | adequate | none | KEEP | Honors D22/C5; hardcoded localhost self-call won't survive remote. |
| api-surface | Decisions/Evidence/Attempts surfaces | live-core | solid | none | KEEP | Clean model-aligned read/append. |
| api-surface | Repair/Task-imports/Dashboard-static | live-core | solid | none | KEEP | Healthy support surfaces; strict CSP + traversal guard. |

### mcp-surface — MCP Surface
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| mcp-surface | Agent-visible MCP tool registry (12 tools) | live-core | solid | none | KEEP | Correct shape; C3 boundary test-pinned. |
| mcp-surface | C3/C4 boundary (internal excluded) | live-core | solid | none | KEEP | authorize_tool/reset absence test-enforced. |
| mcp-surface | C5 session-to-run binding | live-core | solid | none | KEEP | Authoritative, well-covered; rejects agent run_id. |
| mcp-surface | DuctumApiClient transport | live-core | adequate | partial | KEEP | Sound; silent best-effort activity post is a legibility wrinkle. |
| mcp-surface | complete() dual teardown | live-core | adequate | partial | REUSE | Fine here, but symptom of session-lifecycle fragility. |
| mcp-surface | ductum.complete input guard (50-char) | live-core | solid | none | KEEP | Small correct evidence guard. |
| mcp-surface | gate_check / workflow queries | live-core | solid | partial | KEEP | Correct read-only C3 expression; workflow payload untyped. |
| mcp-surface | next_task routing filter | live-core | adequate | none | KEEP | Narrow, safe routing input. |
| mcp-surface | stdio entrypoint + env config | live-peripheral | adequate | none | REUSE | Generic/correct; primary consumer (OpenCode) is removal candidate. |
| mcp-surface | HTTP MCP route auth posture (loopback) | live-core | adequate | partial | REDESIGN | No token gate; auth shouldn't depend on bind address. |

### harness-adapters — Harness Adapters
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| harness-adapters | Claude Agent SDK adapter | live-core | solid | none | KEEP | Reference adapter, well-tested; spreads full host env (security). |
| harness-adapters | Codex app-server adapter | live-core | solid | partial | KEEP | Enforced Codex path; same env-leak as Claude. |
| harness-adapters | Codex SDK compat alias | live-peripheral | adequate | partial | DECIDE | Keep alias OR collapse + drop unused @openai/codex-sdk dep. |
| harness-adapters | Copilot SDK adapter | experimental | fragile | high | REDESIGN | Untested, double-wires events, $0 cost, blocked by DB CHECK. |
| harness-adapters | OpenCode adapter family | legacy-retired | adequate | high | REMOVE | Fully dead, superseded; backlog schedules removal. |
| harness-adapters | Mock agent-call adapter | live-peripheral | adequate | partial | REUSE | Legit demo tool; keep behind a clear boundary, not one env var. |
| harness-adapters | Harness registry & loader | live-core | solid | none | KEEP | Clean tested boundary. |
| harness-adapters | Authorize-tool / REST boundary | live-core | solid | none | KEEP | Correct C1/C3 transport; minor helper duplication. |
| harness-adapters | Canonical events + activity limits | live-core | solid | none | KEEP | Shared bounded contract for all adapters. |

### dashboard-ia — Dashboard IA
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| dashboard-ia | Routing shell & route table | live-core | solid | none | KEEP | Correct routing for Project→Spec→Task→Attempt. |
| dashboard-ia | App shell / Layout | live-core | solid | partial | KEEP | Solid; drop Legacy specs/agents crumb arms once routes go. |
| dashboard-ia | Primary navigation (Sidebar) | live-core | solid | partial | KEEP | Canonical nav; special-cases retired /specs and /agents. |
| dashboard-ia | TreeNavigator (dead left-rail) | dead-unused | adequate | none | REMOVE | Zero imports; contradicts shipped nav, routes to retired /agents. |
| dashboard-ia | Home dashboard (ProjectList page) | live-core | adequate | partial | REUSE | Keep page; reconcile misleading filename + localStorage migration. |
| dashboard-ia | Projects index | live-core | solid | none | KEEP | Correct project index. |
| dashboard-ia | Detail hierarchy | live-core | adequate | none | KEEP | Core drilldown; SpecDelete redirects to legacy /specs (bug). |
| dashboard-ia | Operator action pages | live-core | solid | none | KEEP | Direct expression of the operator/HITL wedge. |
| dashboard-ia | Factory Settings page | live-core | solid | none | KEEP | Aligns with DB-as-truth, YAML demoted. |
| dashboard-ia | Legacy SpecList & AgentList | legacy-retired | adequate | partial | REMOVE | Self-labeled "Legacy", off-nav; repoint 2 inbound links first. |
| dashboard-ia | Welcome / first-run handoff | live-peripheral | adequate | none | REUSE | Keep onboarding; repoint /specs link. |
| dashboard-ia | RunRedirect (deep-link resolver) | live-peripheral | solid | none | KEEP | Deliberate CLI-compat shim. |
| dashboard-ia | Command palette | live-core | solid | none | KEEP | Strongest cross-IA jump, already aligned. |

### dashboard-components — Dashboard Components & Design System
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| dashboard-components | Signal token + primitive system | live-core | solid | none | KEEP | Primary design system; agentColor hardcodes ids; non-brand font. |
| dashboard-components | shadcn / Radix ui/ layer | live-core | adequate | none | REUSE | Keep primitives; reconcile with Signal in later UI pass. |
| dashboard-components | Legacy Tailwind-class color maps | live-peripheral | fragile | none | REDESIGN | Throwaway maps duplicate Signal; both render at once. |
| dashboard-components | Fonts (Geist + JetBrains Mono) | live-core | adequate | none | DECIDE | Diverges from brand book (Inter+Archivo+JetBrains); swap is cheap. |
| dashboard-components | Homepage / Today dashboard | live-core | solid | none | KEEP | Core operator surface; 2 files grandfathered. |
| dashboard-components | Approval/repair/run-detail surfaces | live-core | solid | none | KEEP | Realizes the wedge; asserts retired vocab absent. |
| dashboard-components | Settings panels | live-core | solid | partial | KEEP | P6 typed panels, within size budget. |
| dashboard-components | Bakeoff comparison UI | live-peripheral | adequate | partial | DECIDE | Real+tested; confirm bakeoff is still an intended workflow. |
| dashboard-components | Command palette + nav chrome | live-peripheral | adequate | none | KEEP | Keep palette/sidebar/TaskDAG. |
| dashboard-components | Dead utility: RelativeTime | dead-unused | adequate | none | REMOVE | Zero importers; superseded by direct timeAgo usage. |

### notifications — Notifications
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| notifications | Telegram approval delivery | live-core | solid | none | KEEP | Works end-to-end, fits approvals wedge. |
| notifications | Telegram webhook + setup | live-core | solid | none | KEEP | Timing-safe secret, token kept server-side. |
| notifications | TelegramRuntime resolution | live-peripheral | adequate | partial | REUSE | Keep resolver; legacy env branch behind a resource-only boundary. |
| notifications | NotificationChannel config + secret resolution | live-core | solid | none | KEEP | The one place FactorySecret is wired correctly — pattern for dispatch. |
| notifications | NotificationBackend abstraction (D055) | experimental | adequate | none | REUSE | Sound seam, but abstracts exactly one backend; not delivered multi-channel. |
| notifications | NotificationChannel CRUD surface | live-peripheral | adequate | partial | REUSE | UI fine; move off generic resource route to Factory Settings. |
| notifications | Stale/orphaned approval recovery | live-peripheral | adequate | partial | KEEP | Small tested safety valve; de-dup recoverable-reasons constant. |
| notifications | Approval auto-rebase on stale branch | live-peripheral | adequate | partial | KEEP | Useful ergonomics; Telegram approve doesn't use the rebase variant. |

### legacy-sweep — Legacy & Dead-Code Sweep (cross-cutting)
| Domain | Feature | Maturity | Quality | Op-risk | Disp. | Rationale |
|---|---|---|---|---|---|---|
| legacy-sweep | Target/Repository legacy bridge | legacy-retired | adequate | high | DECIDE | /api/targets dead-surface REMOVE; the repo/table is still a live bridge — migrate then delete? |
| legacy-sweep | Resource (config-resources) retired surface | legacy-retired | adequate | high | DECIDE | Keep as channel store renamed, or fold into Factory Settings; dead CLI methods REMOVE. |
| legacy-sweep | Dead CLI api-client methods | dead-unused | adequate | none | REMOVE | Zero callers post-D169. |
| legacy-sweep | OpenCode harness (half-retired) | legacy-retired | adequate | partial | REMOVE | Unwired adapter + plugin + refs; keep migration CHECK as ledger. |
| legacy-sweep | Mock-agent-call adapter | experimental | adequate | partial | DECIDE | Keep as bootstrap fixture, or move behind a build flag. |
| legacy-sweep | Deprecated latch fields & resolve-latch | live-core | fragile | partial | DECIDE | resolve-latch is clean REMOVE; the @deprecated tags on load-bearing fields should be corrected, not deleted. |
| legacy-sweep | File-size grandfather list drift | legacy-retired | fragile | partial | REMOVE | Prune ~9 stale entries; delete OpenCode entries with the code. |
| legacy-sweep | Orphaned @ductum/landing package | dead-unused | adequate | none | DECIDE | Keep as in-repo landing, or move to edictum-hub + drop. |
| legacy-sweep | Pre-redesign top-level docs & evidence | legacy-retired | fragile | partial | DECIDE | Keep as marked-historical, or remove/relocate; gitignore evidence/. |

---

## Legacy & removal candidates

Aggregates every `legacyItems` entry plus every row with maturity `legacy-retired`/`dead-unused` or disposition `REMOVE`.

### Target / Repository legacy (the operator's headline legacy)
- `packages/api/src/routes/targets.ts` — full Target CRUD retired by D169, still registered (`app.ts:70`); no live CLI caller. **REMOVE.**
- `packages/core/src/repos/target.ts` (`SqliteTargetRepo`) — still constructed (`api/src/index.ts:103`, `deps.ts:236`), used only as the fallback tier in `task-scope.ts`. **REMOVE after one-time `target_id` backfill.**
- `packages/core/src/resource-types.ts:8-44` — Target/TargetSpec/TargetSource/TargetBranch types. **REMOVE with Target.**
- `packages/core/src/types.ts:12,152` — `TargetId` brand + still-**required** `Task.targetId`, keeping the dead concept load-bearing. **REMOVE/invert primacy.**
- `packages/core/src/db-migrations.ts:538-579` — migrations 022 (targets table) / 024 (tasks.target_id), recreated on every fresh DB. **Keep as ledger; stop relying.**
- `packages/core/src/repository-model.ts:51-86` — `repositoryFromTarget`/`componentFromTarget`/`repositorySpecFromTarget` bridges. **REMOVE with Target.**
- `packages/core/src/task-scope.ts:6,24-31,48-95` — `target`/`legacy-repos` tiers + synthetic `legacy:` rows. **REUSE `task` path, carve the rest behind a migration boundary.**
- `packages/api/src/routes/repositories.ts:106-133` — `listRepositoriesWithTargetBridge` migration sediment. **REMOVE with targets.ts.**
- `packages/api/src/routes/tasks.ts:44-53`, `spec-intake.ts:168-185` — lingering `targetId`/`resolveTargets`/`targetRef` in live import paths.
- `packages/core/src/operator-contract-mappers.ts:36-38` + `operator-contract-types.ts:187,196,218` — `operatorRepositoryFromTarget` shim + `targetRef` fields in the public intake contract.
- post-completion routers — `targetId` threaded into every task-creation site despite D169.

### Resource / ConfigResource retired vocabulary
- `packages/api/src/routes/config-resources.ts` — retired `resource`/`resources` noun as a normal `/api/resources/:kind` surface; underlying config is **live** (only NotificationChannel kind consumed by UI). **REUSE behind Factory Settings, rename off `resource`.**
- `config_resources` table / `ConfigResource` (`repos/config-resource.ts`) — retired naming, live settings store.
- `packages/cli/src/api-client.ts:81-137` — `getTargets/createTarget/getResources/...` with no calling command. **REMOVE (dead).**
- `packages/cli/src/tests/spec-resource-apply-helpers.ts` — test helper retaining `resource` vocabulary; cosmetic rename.

### OpenCode harness (half-retired, dead)
- `packages/harness/src/opencode.ts` + `opencode-rest/activity/model/usage/probe.ts` + `plugin/index.ts` — not in registry/factory-seed/index.ts, no live consumer. **REMOVE.**
- `packages/harness/src/tests/opencode*.test.ts`, `plugin.test.ts` — 9+ tests for unreachable code.
- Lingering refs: `api/src/validate-env.ts:44-48`, `routes/run-control.ts:51`, `db-migrations.ts:30,163` (CHECK still encodes `opencode`), `dashboard/lib/stage-display.ts:53` (HARNESS_CLASSES.opencode color).
- `@openai/codex-sdk@0.118.0` (`package.json:30`) — pinned, **zero src imports**. Dead dependency.
- Stale dist artifacts: `harness/dist/codex-auth.d.ts`, `codex-state.d.ts`, `vercel-ai*.d.ts`; `core/dist/legacy-migration-secrets.d.ts` (no src).

### Dead components / dead exports
- `packages/core/src/tool-output-guards.ts` — exported from core index, zero production consumers. **REMOVE.**
- `packages/dashboard/src/components/TreeNavigator.tsx` — 352 LOC, zero importers, still holds a D112 grandfather slot, routes to retired /agents. **REMOVE.**
- `packages/dashboard/src/components/RelativeTime.tsx` — zero importers. **REMOVE.**
- `packages/dashboard/src/pages/SpecList.tsx` (`/specs`) + `AgentList.tsx` (`/agents`) — self-labeled "Legacy", off-nav; superseded by SpecDetail / Factory Settings. **REMOVE after repointing `Welcome.tsx:144` and `SpecDetail.tsx:361`.**
- `packages/api/src/routes/run-control.ts:151` — `@deprecated` POST `/resolve-latch`, zero consumers. **REMOVE.**

### Drift / stale records (not code-dead, but legacy debt)
- `decisions/112-file-size-grandfather-list.md` — ~9 stale entries (41 listed vs 32 actually oversize); `db-migrations.ts` 819→1169, `run.ts` 456→501, `enforce.ts` 632, `post-completion.ts` 483→637, `cost-scanner.ts` 525, stale CLI/pricing entries. Gate exempts by path only. **REMOVE stale entries / cap at recorded LOC.**
- `packages/core/src/types.ts:212-215` — `Run.ciStatus/reviewStatus` carry **misleading** `@deprecated` tags but are load-bearing for the C6 external-review gate. **Correct tags, do not delete.**
- `post-completion.ts:54-58` — `maxReviewRounds` genuinely superseded by `maxFixIterations`.

### Bootstrap-redesign / demo carve-outs (paused, do not delete blind)
- `evidence-kinds.ts:39-62,131-146` + migration 035 — `exit_demo.run` kind tied to the PAUSED bootstrap-redesign (D161). Remove only on a deliberate abandon decision.
- `packages/landing/` — orphaned `@ductum/landing` Vite SPA + committed `dist/`, unreferenced by api/cli/CI; overlaps edictum-hub. **DECIDE.** Its `fleet/evidence.ts` is fabricated demo evidence (confusion risk — never cite as real audit).
- Root `STATUS.md/VISION.md/OPEN-QUESTIONS.md/HARNESS.md/ARCHITECTURE.md/CONTEXT.md` (all 2026-04-26, pre-D166) + `evidence/` (36 git-tracked p0-p7 artifacts). **DECIDE: mark historical or remove/gitignore.**

### Aspirational / single-implementation
- `tryReattach` reattach path (`dispatcher-reconcile.ts:134-159`) — optional on the adapter interface, no shipped adapter implements it; startup logs overstate the capability.
- `NotificationBackend` (D055) — interface sound but only Telegram exists; webhook/local/Slack/email never built.
- `DUCTUM_TELEGRAM_CONFIG` env path (`source:'legacy'`) — live in parallel to resource-backed channels.

---

## Per-domain health

- **dispatch-runtime** — Mature and central; two structural weaknesses (in-memory live-session coupling, host-env secret leak) plus dead OpenCode adapter. See `domains/01-dispatch-runtime.md`.
- **enforcement-gates** — The most adversarially-hardened part; C1/C3/D27/D28 hold; one dead export, one upstream env-leak undermining the boundary. See `domains/02-enforcement-gates.md`.
- **evidence-audit** — Healthy (typed, redacted, secret-rejecting); single material defect is the non-idempotent evidence INSERT. See `domains/03-evidence-audit.md`.
- **recovery-interruption** — State machine and lineage solid; crash-retry throws away progress and the advertised reattach path is dead scaffolding. See `domains/04-recovery-interruption.md`.
- **post-completion** — Most mature orchestration spine; liabilities are the verify-env secret leak and residual Target vocabulary. See `domains/05-post-completion.md`.
- **workflow-model** — Solid profile→render→materialize→resolve pipeline; one D28-vs-code conflict (`recordResult`), three dead helpers, live Target compat branch. See `domains/06-workflow-model.md`.
- **factory-settings** — Mature read surface on a single model registry; split catalog write model and an unsupported Copilot path. See `domains/07-factory-settings.md`.
- **secrets** — Well-built encrypted store, but wired only to notifications — security theater for the actual dispatch path. See `domains/08-secrets.md`.
- **sandbox-cost** — Cost half mature; sandbox half intentionally laptop-bound; cost can silently read $0 for Codex. See `domains/09-sandbox-cost.md`.
- **repair-bakeoff** — Both halves healthy live-core; only hardcoded reviewer model IDs concern. See `domains/10-repair-bakeoff.md`.
- **data-model** — Clean repo layer + append-only ledger; main debt is the retired-but-live `targets` table and path-only size-gate drift. See `domains/11-data-model.md`.
- **cli-surface** — Healthy and tightly aligned to D166/D169; weaknesses are live-session-coupled progress stream and Copilot/seed init remnants. See `domains/12-cli-surface.md`.
- **api-surface** — Consistent thin-controller Hono app; legacy concentrated in targets.ts, config-resources, and two deprecated endpoints. See `domains/13-api-surface.md`.
- **mcp-surface** — Small, focused, C3/C4/C5 intact; gaps are silent activity posting and loopback-only auth. See `domains/14-mcp-surface.md`.
- **harness-adapters** — Claude/Codex are production workhorses; OpenCode family fully dead, Copilot untested, shared env leak in two adapters. See `domains/15-harness-adapters.md`.
- **dashboard-ia** — Routing shell solid; real legacy debt in dead TreeNavigator, two "Legacy" routes, confusing page names. See `domains/16-dashboard-ia.md`.
- **dashboard-components** — Working library with broad tests; headline issue is design-system duplication (signal/ vs ui/) and a dead component. See `domains/17-dashboard-components.md`.
- **notifications** — Effectively one working capability (Telegram); D055 multi-channel vision unrealized, config on retired resource surface. See `domains/18-notifications.md`.
- **legacy-sweep** — Repo mostly post-D166 clean; dominant survivor is Target vocabulary, plus half-retired OpenCode and drifted size-gate list. See `domains/19-legacy-sweep.md`.

---

## Decisions needed from you

**Secret confinement at dispatch (the single biggest cross-cutting fork).** Four high-risk REDESIGN rows all point at the same leak: `claude.ts:186-188` and `codex-mcp-config.ts:25-34` spread the full host `process.env` (incl. `ANTHROPIC_API_KEY`) into every spawned agent, while the encrypted FactorySecret system is wired only to notifications. **Do we make scoped/allowlisted FactorySecret-sourced env the dispatch contract now, and treat the current behavior as a security defect to fix before further dogfood?**

**The Target/Resource retirement.** D169 retired these surfaces, but `targets.ts`, `SqliteTargetRepo`, and `config-resources` still ship and several are wired as live bridges.
- Target: **migrate the bridge data and delete the route/repo/table, or keep the bridge indefinitely?**
- Resource: **rename the config-resources surface and fold it into Factory Settings, or leave the retired `resource` noun public?**

**OpenCode removal.** Fully dead adapter family + plugin + 9 tests + the `@openai/codex-sdk` dead dependency. **Schedule the staged removal now (backlog already lists it), keeping only the historical migration CHECK constraints?**

**Recovery granularity.** Crash retry rebuilds the whole task from `understand` with a fresh worktree, no checkpoint; heartbeat-stalls never auto-retry; the reattach path is dead scaffolding. **Invest in checkpoint/resume + a real reattach adapter, or accept retry-from-scratch and delete the aspirational reattach code?**

**Sandbox confinement direction.** `host`/`worktree` is the only driver; cost scanning reads the operator's entire `~/.codex` and `~/.claude` trees; Codex can silently record $0. **Is container/remote isolation on the near roadmap (justifying the sandbox + cost-scanner REDESIGN), or do we stay laptop-bound and just add an explicit `unmeasured` cost marker?**

**Copilot as a third executor.** `copilot-sdk.ts` is 524 LOC, untested, double-registers an event handler, always reports $0 cost, and is blocked by a DB CHECK constraint. **Invest to make it production-grade, or shelve/remove it until there's demand?**

**Codex SDK alias** (`codex-sdk.ts`) — **keep the 42-LOC pass-through for config back-compat, or collapse into `codex-app-server` and drop the unused `@openai/codex-sdk` dependency?**

**Mock agent adapter** — a test-only adapter ships in production `src`, flippable to all-mock via one env var (`DUCTUM_MOCK_AGENT_CALLS=1`). **Keep as an intentional bootstrap fixture, or move it behind a build flag so a production binary can't be flipped?**

**File-size grandfather gate** — the exemption is path-only, so `db-migrations.ts` (819→1169), `post-completion.ts` (483→637), and others grew past their recorded LOC with no CI friction, and ~9 entries are stale. **Cap grandfathered files at their recorded LOC and prune stale rows, or accept unbounded growth of exempted files?**

**Deprecated-but-load-bearing latch fields** — `Run.ciStatus/reviewStatus` carry `@deprecated` tags but are required by the C6 external-review gate. **Confirm we correct the misleading tags (not delete the fields), and separately delete the truly-dead `resolve-latch` route?**

**Dashboard design system + fonts** — `signal/` (60 importers) and shadcn `ui/` (36 importers) are two co-equal styling vocabularies, and shipped fonts (Geist) diverge from the brand book (Inter + Archivo Expanded). **Reconcile to one system and adopt the brand fonts in a dedicated UI pass — and is that pass scheduled?**

**Bakeoff (Best-of-N)** — genuinely live and tested across CLI/API/dashboard, but peripheral to the process-enforcement wedge and couples into the generic DAG/integrity policy. **Is bakeoff a committed product workflow (justifying the coupling), or experimental and a candidate to isolate behind a clean boundary?**

**Orphaned `@ductum/landing` + pre-redesign docs/evidence** — an unreferenced marketing SPA with committed `dist/`, plus six 2026-04-26 root docs and 36 git-tracked `evidence/` artifacts. **Keep as marked-historical in-repo, or relocate to edictum-hub / remove / gitignore?**
