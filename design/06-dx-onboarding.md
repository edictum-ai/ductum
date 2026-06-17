# DX, Onboarding & Extension Authoring: zero-config local start, a shipped doctor/init wizard, an llms.txt authoring contract, and a real third-party extension seam

> Ductum redo · pillar design · 2026-06-17

Ductum's enforcement moat is solid but its onboarding floor is the single thing that made the paused bootstrap arc (D161) collapse: a fresh user hits broken pickers, dead settings fields, a credentials-shape mismatch, and a manual ductum.yaml paste. The target is a true zero-config local start (SQLite + in-process poll loop already in place; make auto-migrate + auto-seed the default and add a Postgres scale-up rung behind one clean StateStore/Queue boundary), a SHIPPED init wizard and ductum doctor that name the exact broken prerequisite and fix (folding the existing repair-readiness engine into an honest preflight), and a first-class llms.txt / llms-full.txt agent-authoring contract plus a tool-examples convention so agents can author valid WorkflowProfiles, specs, and extensions without reading the repo. The extension story moves the hard-coded BUILT_IN_HARNESSES array and the Telegram-only NotificationBackend into a uniform, capability-described, manifest-loaded ExtensionRegistry that third parties can ship a harness/provider/sandbox/stage/notifier against — deny-by-default, signed, sandboxed at load. The ductum-onboard skill (today a host-side Claude skill that hand-edits yaml) becomes a shipped `ductum onboard` command that the skill merely drives. Every seam is introduced in place via strangler steps, each routed through one real dogfood flow, keeping KEEP/REUSE code and reworking only the REDESIGN-rated surfaces. The honest framing stays intact: Ductum is a governed factory, not a low-code workflow clone — the DX closes the competitor gap without adopting their post-hoc, fail-open model.

---

# Pillar: DX, Onboarding & Extension Authoring

## 0. Scope Rule discipline (what dogfood flow breaks without each piece)

Before any abstraction below, I name the concrete flow that breaks without it. If a flow can't be named, the piece is cut.

| Proposed seam | Dogfood flow that breaks without it |
|---|---|
| Zero-config auto-migrate/seed default | Fresh `ductum start` on a clean machine fails to dispatch the bundled hello-readme task (D161 blockers #2, #5, #6). |
| `ductum doctor` (shipped) | Operator can't tell *why* dispatch is blocked without reading source; today only `ductum repair` exists and it's framed as recovery, not preflight. |
| `ductum init` wizard with validated pickers | D161 blocker: "adding another agent... no boxes to choose just text box, it breaks everything." |
| `ductum onboard` shipped command | Onboarding a second repo requires a host-side Claude skill + manual `ductum.yaml` paste; nothing ships in the binary. |
| llms.txt / llms-full.txt | An agent asked to author a WorkflowProfile or spec must read the repo; it guesses field names and ships invalid YAML (the D152 "yaml validation drift" class of bug). |
| ExtensionRegistry (manifest-loaded) | A third party cannot ship a new harness/provider/sandbox without editing `registry.ts` and recompiling Ductum. |
| StateStore/Queue boundary | The Postgres scale-up rung can't exist; `activeSessions` Map and direct SQLite calls block it (REFERENCE-ARCHITECTURE: Remote Worker Transport MISSING, root cause = non-serializable live objects). |

I am **not** proposing: a template marketplace/hub with ratings, a cloud registry, or a `.sctpl`-style cassette download network now. Those are competitor surface area with no current dogfood flow. (The evidence-cassette concept belongs to the Evidence pillar, not DX.)

---

## 1. Target shape

Five shipped surfaces, one new registry boundary, one authoring contract:

```
  ┌─────────────────────────────────────────────────────────────┐
  │ ductum init     → guided first-run wizard (validated pickers)│
  │ ductum doctor   → honest preflight: can the factory dispatch?│
  │ ductum onboard  → wire an existing repo into the factory     │
  └─────────────────────────────────────────────────────────────┘
        │ all three read/write the same authoritative state
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ StateStore (SqliteStateStore today → PgStateStore later)     │
  │ Queue      (InProcessQueue today  → PgQueue/Redis later)     │
  │ auto-migrate + auto-seed default ON for local, gated in prod │
  └─────────────────────────────────────────────────────────────┘
        ▲
  ┌─────────────────────────────────────────────────────────────┐
  │ ExtensionRegistry  (harness | provider | sandbox | stage |   │
  │                     notifier)  — manifest + capability descr.│
  │   built-ins register through it; third-party loaded by path  │
  └─────────────────────────────────────────────────────────────┘

  Authoring contract (served + on disk):
   /llms.txt        one-page index of primitives + commands
   /llms-full.txt   full WorkflowProfile/spec/extension schemas
   docs/tool-examples-convention.md  (MCP tool-def discipline)
```

This is **honest about what Ductum is**: the authoring contract describes the *governed factory* primitives (Spec → Task → Attempt, WorkflowProfile stages, gates, evidence kinds), not a generic step-DAG. The extension seam is deny-by-default and capability-negotiated, matching C1-C7 — the opposite of the competitor's bypassPermissions/execSync model.

---

## 2. What changes vs today (mapped to inventory dispositions)

### 2.1 Zero-config local start + scale-up ladder

**Today:** SQLite + in-process poll/dispatch cycle already exist (`dispatch-runtime` KEEP/solid; `data-model` migration ledger KEEP). But: there is no described **startup schema-compat negotiation** (REFERENCE-ARCHITECTURE: "Durable Externalized State Store with Schema Versioning" = PARTIAL — ledger grew 819→1169 LOC invisibly, "no described startup schema-compat gate"). Live ownership lives in a fragile in-memory `activeSessions` Map (`dispatch-runtime` REUSE/high-risk). D161 blocker #2 was a native-binding build failure that left the API unable to load — i.e. zero-config wasn't actually zero-config.

**Target / disposition mapping:**
- Introduce a thin **`StateStore`** interface (KEEP the SQLite repos behind it; this is the REUSE boundary the inventory keeps asking for — `ConfigResource`, `AttemptRuntimeSnapshot`, repos all rated REUSE "should sit behind a cleaner boundary"). It is NOT a rewrite: `SqliteStateStore` wraps the existing repos verbatim.
- Add a **startup schema-version gate**: on boot, read `schema_version`, refuse to run a binary older than the on-disk schema, auto-apply forward migrations for local. This closes the PARTIAL. Concept inspiration (clean-room) from the competitor's auto-add-missing-columns, but implemented as an explicit versioned migration gate, not silent column-adding — security product, we want determinism.
- Add a **`Queue`** interface with `InProcessQueue` as the only implementation now. The Postgres/Redis rung is a *named future rung*, not built today (Scope Rule: no remote dispatch flow exists yet). The boundary exists so `activeSessions` can be the thing we strangle later — it is the structural blocker the reference arch flags for remote dispatch.
- **Auto-seed default factory** on first `ductum start` (today `seed-db.mjs`/`seed.mjs` are separate scripts; fold the seed into start, gated by "DB empty"). This kills D161 blockers #5/#6 (bundled task not auto-dispatched).

### 2.2 `ductum doctor` — shipped honest preflight

**Today:** `repair-readiness` (`repair-bakeoff` KEEP/solid: "primary readiness surface") and the dispatch prerequisite gate already compute exactly the truth a doctor needs. But it's surfaced as `ductum repair` (recovery framing) and as `decisions/087/089` doctor-readiness notions that never became a first-class command. REFERENCE-ARCHITECTURE rates "Readiness / Doctor / Honest-Status" HAVE — so the engine exists; the **command surface is the gap**.

**Target / disposition:** Add `ductum doctor` as a thin CLI surface (REUSE the readiness engine; do not rewrite it). It must:
- Name the exact broken prerequisite and the exact fix string (reuse `attempt-actions.ts`/`next-action.ts` single-source-of-command-strings pattern — `cli-surface` KEEP, "prevents drift").
- Cover the D161 blocker classes explicitly: harness auth present? (credentials-shape check that would have caught blocker #7), native bindings built?, default factory seeded?, at least one agent valid?, secret broker configured? (ties to the secrets pillar).
- Exit non-zero in CI so it doubles as a smoke gate (`scripts/smoke-onboarding.mjs` already exists; have it call `ductum doctor --json`).

### 2.3 `ductum init` wizard — validated pickers, no freeform-text traps

**Today:** `packages/cli/src/init/` has a real step framework (`steps/agent-pickers.ts`, `auth-anthropic.ts`, `welcome.ts`, `browser-handoff.ts`) — `cli-surface` rates init/start KEEP/solid. The TUI is `@clack/prompts` (per MEMORY). The dashboard side is where D161 found the rot ("no boxes to choose just text box").

**Target / disposition:** KEEP the CLI init framework; the work is (a) ensure every choice is a **validated picker sourced from the model/agent/harness registry** (the registries already exist — `factory-settings` model registry KEEP/solid), never a freeform string that silently fails validation; (b) make the **dashboard agent-add / settings forms** consume the same validation contract (this is the dashboard-components / Factory Settings work — those panels are P6 KEEP/solid for *display*, but D161 says create/edit defaults are broken). The fix is to route dashboard CRUD through the same operator-contract types/mappers (`factory-settings` "Operator contract types/mappers/errors" KEEP/solid, "clean public boundary") that the CLI uses — CLI↔UI parity by shared contract, which the reference arch rates HAVE as de-facto but not conformance-checked. Add a **parity conformance test** so a field that works in CLI but not UI fails CI.

### 2.4 `ductum onboard` — ship the skill's logic as a command

**Today:** onboarding is a **host-side Claude skill** (`ductum-onboard/SKILL.md`) that detects stack, writes `.edictum/workflow-profile.yaml`, and tells the operator to hand-paste a `ductum.yaml` block and `nohup node scripts/serve.mjs`. Nothing ships in the binary. The skill even references the old `scripts/serve.mjs` path and manual restart — i.e. it's drifted from the supported `ductum start` path.

**Target / disposition:** Ship `ductum onboard <path>` that does what the skill does deterministically: detect stack (the skill's detection table becomes a small `stack-detect.ts`), pick `required_files`, write `.edictum/workflow-profile.yaml` from a built-in template, and **create the project/repository through the API** (not a hand-pasted yaml — `ductum.yaml` is demoted per the P3 YAML-removal arc; DB is truth). The skill is retained but rewritten to **drive the command** (it provides the LLM judgment — "which of these three test commands is the real CI one" — then calls `ductum onboard --setup '…' --verify '…'`). This keeps the agent-leverage while making the operation reproducible and testable. Templates move from the skill's host directory into the shipped package so they version with the binary.

### 2.5 llms.txt / llms-full.txt + tool-examples convention

**Today:** none exist (`find` for `llms*.txt` returns nothing). Agents author WorkflowProfiles/specs by reading the repo, which produced the D152 "yaml validation drift" and the placeholder-`agent:` blocker (#6).

**Target / disposition (new, additive — no inventory item to displace):**
- **`/llms.txt`** — a tight one-page index: the primitive model (Factory → Project → Repository/Component → Spec → Task → Attempt), the WorkflowProfile schema skeleton, the MCP agent-tool surface (the 12 tools, `mcp-surface` KEEP), the evidence kinds, and the C3/C4 rules an authoring agent must respect (never pass run_id, never self-reset). Served at the API root and committed on disk.
- **`/llms-full.txt`** — full schemas: every WorkflowProfile field with examples, spec/task intake schema, and the **extension manifest schema** (so an agent can author a new harness/sandbox manifest). Generated from the same source-of-truth types/zod the API validates against, so it can never drift from runtime (a generator script in `scripts/`, checked in CI — drift fails the build).
- **`docs/tool-examples-convention.md`** — adopt the measured discipline (1-5 worked examples per MCP tool; tool-search subsetting) as the contract MCP/extension authors follow. Concept inspiration only; we write our own, citing our own tool surface.

These three are the cheapest, highest-leverage DX wins and directly serve the autonomous/extensible goals: an agent (including Ductum dogfooding itself) can author a valid extension or profile without repo access.

### 2.6 ExtensionRegistry — the third-party extension seam

**Today:** `BUILT_IN_HARNESSES` is a hard-coded `readonly` array in `registry.ts`; adding a harness means editing core and recompiling. `NotificationBackend` (D055) is "a sound seam but abstracts exactly one backend" (`notifications` REUSE). Sandbox is host-worktree-only with no driver interface (`sandbox-cost` REDESIGN). There is no provider/stage plugin point. So "extensible" is currently false for all five extension kinds.

**Target / disposition:**
- Generalize the existing `BuiltInHarnessRegistration` shape into an **`ExtensionRegistry`** with five kinds: `harness`, `provider`, `sandbox`, `stage`, `notifier`. Built-ins register through it unchanged (Claude/Codex KEEP register exactly as today — this is a wrapper, not a rewrite of the adapters).
- Each extension ships a **manifest** (`ductum-extension.json`): id, kind, capability descriptor (which the dispatcher already matches against for harnesses — `factory-settings` agent-compatibility validation KEEP), schema version, and entrypoint.
- **Loading is deny-by-default and explicit**: a third-party extension is loaded only from an operator-allowlisted path/package, never auto-discovered from node_modules (supply-chain rule). At load, capability descriptors are validated; an extension that claims a capability it doesn't implement is rejected fail-closed.
- This is the seam that lets the inventory's REMOVE/DECIDE harness churn happen cleanly: OpenCode (REMOVE) and Copilot (DECIDE) become *unregistered manifests* rather than `if`-branches scattered through core (the `db-migrations.ts` CHECK constraint, `validate-env.ts`, `stage-display.ts` refs the inventory lists). The Mock adapter (DECIDE "move behind a build flag") becomes a dev-only extension not present in the production manifest set — solving that fork structurally.

---

## 3. How this advances the four goals

- **Better shape:** one StateStore/Queue boundary collapses the direct-SQLite + in-memory-Map coupling the reference arch flags as the structural blocker to everything distributed. The ExtensionRegistry collapses five scattered registration styles into one.
- **Better UI:** validated pickers + CLI↔UI parity conformance kills the D161 "freeform text box breaks everything" class. The brand/UI specifics (Inter/Archivo, #111318, run-state colors) are the dashboard pillar's job; this pillar guarantees the *data contract* the forms bind to is honest.
- **Autonomous:** llms.txt/full lets agents author specs/profiles/extensions unattended; `ductum doctor --json` lets an autonomous loop self-diagnose before dispatch; auto-migrate/seed removes the manual setup steps that required a human in D161.
- **Extensible:** the registry + manifest + authoring contract is the whole third-party story — ship a harness/provider/sandbox/stage/notifier without forking Ductum.

---

## 4. Strangler steps (in place, each routed through one real dogfood flow)

Ordered so each step ships value and is verifiable; none is a big-bang rewrite.

**S1 — `ductum doctor` (thinnest, highest trust).** Wrap the existing readiness engine in a command + `--json`. *Dogfood flow:* run `ductum doctor` on the real Ductum factory before a dispatch; it must name the host-env secret leak and any unseeded default as findings. Wire into `smoke-onboarding.mjs`. No core changes — pure surface.

**S2 — StateStore/Queue boundary (no behavior change).** Introduce the interfaces; `SqliteStateStore`/`InProcessQueue` wrap existing code 1:1. Add the startup schema-version gate. *Dogfood flow:* the full existing test suite + one real attempt run unchanged; the schema gate is exercised by booting an older binary against a newer DB in a test.

**S3 — llms.txt + llms-full.txt + generator.** Generate from the live zod/types; CI fails on drift. *Dogfood flow:* have a Codex agent author a brand-new WorkflowProfile for a sibling repo using ONLY llms-full.txt (no repo read) and dispatch one task against it — proves the contract is sufficient.

**S4 — `ductum onboard` command + move templates into package.** Rewrite the skill to drive it. *Dogfood flow:* onboard one sibling Edictum repo (e.g. `edictum-go`) end-to-end via the command, dispatch one task, merge it. This is the flow the inventory's `ductum-onboard` skill claims but never shipped as code.

**S5 — `ductum init` validated pickers + dashboard CRUD parity + conformance test.** *Dogfood flow:* the exact D161 failure — add a second agent (opus) through the dashboard with validated pickers, confirm it persists and dispatches. The CLI↔UI parity test must cover this field.

**S6 — ExtensionRegistry generalization.** Built-ins register through it; add manifest loading for one real third-party-shaped extension. *Dogfood flow:* re-register the Codex harness as a manifest (proving built-ins work through the seam) AND load one out-of-tree notifier (e.g. a local-file notifier) via allowlisted path — proving the third-party path is real. This also lets OpenCode REMOVE land cleanly (delete the manifest, not core branches).

Each step keeps KEEP/REUSE code intact, reworks only the REDESIGN-rated surfaces (sandbox driver, notification multi-backend, evidence write idempotency is owned by other pillars), and deletes REMOVE code (OpenCode family) only once S6 makes it a no-op.

---

## 5. Honest boundaries (what this pillar does NOT claim)

- llms.txt does not make agents *understand* the codebase — it makes them able to author *valid* artifacts. Validity ≠ correctness (consistent with the project's honest-boundary stance).
- `ductum doctor` reports preflight truth; it does not guarantee a run succeeds — only that prerequisites are met.
- The extension seam is deny-by-default; "extensible" never means "auto-loads untrusted code." A loaded extension's agent actions are still subject to authorize_tool — the moat is unchanged.
- We adopt competitor *concepts* (zero-config ladder, pluggable backends behind interfaces, llms.txt, tool-examples) clean-room; we do NOT adopt their post-hoc/bypassPermissions execution model.

## Key decisions (this pillar)

- **Ship onboarding as a CLI command vs keep it as a host-side Claude skill** — _Ship `ductum onboard` as a command; rewrite the skill to drive it (skill = LLM judgment over which CI command is real; command = deterministic write + API project creation)._. Today nothing ships in the binary — onboarding a repo requires the operator to run a host-side skill and hand-paste ductum.yaml + nohup the old serve.mjs path. That is untestable, drifts from the supported `ductum start`/DB-as-truth path (P3 YAML removal), and can't be a dogfood flow. A shipped command is reproducible, CI-testable, and works without Claude Code present, while the skill keeps the genuine value (deciding which detected test command is the real one).
- **Generate llms-full.txt from source-of-truth types, or hand-write it** — _Generate from the live zod/TS types the API already validates against, with a CI drift check that fails the build._. A hand-written authoring contract is exactly how D152 'yaml validation drift' happens — the doc describes fields the runtime rejects. Generating from the validators makes the contract incapable of drifting from enforcement, which is the whole point of giving it to autonomous agents.
- **Build the Postgres/Redis scale-up rung now or only the boundary** — _Build only the StateStore/Queue boundary + SQLite/in-process impls now; name Postgres/queue as a future rung but do not implement it._. Scope Rule: no remote-dispatch or multi-node dogfood flow exists today, and `activeSessions` holds non-serializable live HarnessSession objects, so a real PgQueue can't even work until that's strangled. The boundary is cheap and unblocks later work; the implementation has no current consumer and would be speculative.
- **How third-party extensions are discovered/loaded** — _Operator-allowlisted explicit path/package only, manifest-declared, capability-validated, deny-by-default — never auto-discovered from node_modules._. This is a security product; auto-loading code from the dependency tree is a supply-chain and authz hole. Explicit allowlist + capability validation at load keeps 'extensible' honest without weakening C1-C7. Built-ins register through the same seam so there is exactly one code path to audit.
- **Fold the doctor into repair or ship a distinct `ductum doctor`** — _Ship a distinct `ductum doctor` (preflight framing) that reuses the repair-readiness engine; keep `repair` as the remediation action._. The readiness engine already exists and is solid (KEEP). The gap is purely the framing/surface: operators need a 'can the factory dispatch and if not, exactly why + the fix' command before they have a problem, distinct from 'recover this broken project.' Same engine, two honest verbs; doctor also doubles as the CI smoke gate.
- **Where the evidence-cassette / proof-of-execution concept lives** — _Not in this pillar — flag it to the Evidence & Audit pillar; DX only references the authoring/template side._. The competitor's most distinctive asset (record-once/replay-offline-at-$0, sha256-keyed) maps onto Ductum's evidence story, not its onboarding story. Putting it here would smuggle a large new subsystem under DX with no onboarding dogfood flow. DX's template concern is bounded to WorkflowProfile templates shipped in-package.

**Dependencies:** DEPENDS ON: (1) Secrets/Sandbox pillar — `ductum doctor` must surface the host-env secret-leak finding and the scoped-secret-broker config status; the onboarding path should provision the scoped broker, not the current process.env blanket. (2) Data-model/StateStore work — the StateStore/Queue boundary overlaps the inventory's REUSE boundary requests for ConfigResource/AttemptRuntimeSnapshot/repos; coordinate so we introduce ONE boundary, not two. (3) Dashboard pillar — `ductum init` validated pickers and CRUD parity require the dashboard forms to bind to the shared operator-contract types; the brand/font/design-system reconciliation (Inter/Archivo, signal vs shadcn) is owned there. UNBLOCKS: (a) the paused bootstrap arc (D161) — a shipped doctor + validated init + auto-seed directly close the seven D161 blockers and the 'every surface is an issue' finding, making a re-publish honest. (b) The harness REMOVE/DECIDE forks (OpenCode REMOVE, Copilot/Mock DECIDE) become clean manifest add/remove once the ExtensionRegistry lands. (c) Autonomous self-dogfooding — llms.txt lets Ductum dispatch spec/profile-authoring work to its own agents. (d) Future remote/SaaS dispatch — the StateStore/Queue boundary is the prerequisite the reference arch names for the MISSING remote-transport layer.

**Risks:** RISK 1 — llms-full.txt drift becomes a lie agents trust. De-risk: generate it from the live validators with a CI check that diffs generated-vs-committed and fails the build; never hand-edit. RISK 2 — The StateStore/Queue boundary turns into a speculative abstraction with one impl (the exact thing the Scope Rule forbids). De-risk: ship it only as a 1:1 wrapper with zero behavior change, justified by the named schema-gate + future-rung flow; if the Postgres rung keeps not arriving, the boundary still pays for itself via the startup schema-version gate alone. RISK 3 — ExtensionRegistry becomes an auto-loading supply-chain hole. De-risk: deny-by-default, explicit allowlist, capability validation at load, no node_modules auto-discovery; built-ins go through the same path so there's one audited seam. RISK 4 — `ductum onboard` writing project state diverges from `ductum.yaml` expectations during the P3-YAML-removal transition. De-risk: onboard writes through the API (DB-as-truth) and prints nothing to paste; the skill stops referencing scripts/serve.mjs. RISK 5 — Repeating the D161 process failure: shipping a narrow 'works' demo that doesn't exercise the surfaces users actually hit. De-risk: each strangler step's dogfood flow is the real failing D161 scenario (add a second agent via dashboard, onboard a sibling repo, author a profile from llms.txt only), and `ductum doctor --json` is wired into the existing smoke-onboarding gate so the floor is CI-enforced, not demo-enforced. RISK 6 — Doctor/init/onboard each grow past the 300-LOC rule. De-risk: keep engines (readiness, stack-detect, registry) in core and the command files as thin surfaces, mirroring the existing init/steps split.
