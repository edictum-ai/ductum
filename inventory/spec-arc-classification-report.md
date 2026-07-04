# Spec & Arc Classification Report

**Generated:** 2026-07-04
**Scope:** spec/decision/design tree inside the current Ductum run worktree
(`ductum/P1-GENERATE-SPEC-MAP-ARTIFACTS-9tp21l/ductum`).
**Author:** P1-GENERATE-SPEC-MAP-ARTIFACTS run on Ductum spec
`P1-GENERATE-SPEC-MAP-ARTIFACTS-9tp21l`.
**Process anchors:** D059 (design-to-spec-pipeline), D060 (decision drift),
D131 (factory-readiness-recovery closeout), D161 (bootstrap-redesign pause),
D166 (operational-model-redesign closeout), D172-D179
(phase2 / unattended stabilization era).

This report answers the operator's 2026-07-04 question: which specs/arcs
belong to which era or milestone, and whether each is **done**, **active**,
**paused**, **abandoned**, **superseded**, **unscheduled**, or
**unclassified**. Anything that cannot be tied to a decision, PR, Ductum spec
state, or explicit README statement is placed in the
[Unclassified Bucket](#unclassified-bucket) — it is not silently guessed.

## Method

- **Era anchors** are decisions, not vibes:
  - Pre-recovery era: closed by **D131** (factory-readiness-recovery Outcome
    A, 2026-05-02).
  - Bootstrap-redesign era: paused by **D161** (2026-05-05) pending audit.
  - Operational-model-redesign era: closed by **D166** (2026-06-09, P9 PASS).
  - Phase 2 / unattended stabilization era: opened by
    **D172-D179** (2026-06-18 through 2026-06-22) and the parallel design
    plan at `design/parallel/unattended-factory-hardening/`.
- **Live evidence** was gathered read-only inside the run worktree and from
  the configured GitHub App and Ductum read surfaces:
  - `gh issue view 243` and `gh issue view 244` against
    `edictum-ai/ductum` (both OPEN).
  - `gh pr view` on PRs #251, #255, #256, #257, #258, #259, #260.
  - `ductum spec list ductum` against the dogfood factory.
- **File counts** come from the worktree, e.g. `find specs -type f`.
- **Stale README state is named explicitly** rather than trusted — see
  the "Stale README call-outs" section near the end of this report.

The report does not read or quote any file outside this run worktree. The
prior attempt was cancelled for that reason; this attempt derives everything
from the worktree plus the read-only GitHub/Ductum surfaces above.

## Era Map (summary)

| Era | Anchor | One-line shape | Overall status |
|---|---|---|---|
| Pre-recovery / resource-model | D053-D060, D061-D107 | Factory/Project/Spec/Task/Run + resource refs + doctor + reconciler | Mostly shipped; superseded as the *active* roadmap by D166 |
| Factory-readiness recovery | D109 → D131 | 7 P-stages closing the audit gaps | **Done** (Outcome A) |
| Bootstrap redesign | D147-D160 → D161 | `ductum init` TUI, multi-provider auth, npm publish, fresh-machine demo | **Paused** (D161) |
| Operational model redesign | D162-D166 | Factory/Project/Repo/Component/Spec/Task/Attempt contract cutover | **Done** (P9 PASS) |
| Post-P9 hardening | D166 → `post-p9-hardening/` | P0 done; P1-P4 parked; child arcs (Best-of-N, Factory Settings source-of-truth, Stalled-attempt recovery) | **Parked** with one child arc done |
| Phase 2 / unattended stabilization | D172-D179, `design/parallel/unattended-factory-hardening/` | Podman driver, quarantine, structured review contract, unattended approval policy, agent network boundary | **Active**; partial merges, burn-in unfinished |
| #244 dogfood dashboard remediation | Issue #244 open; wave 1 + runner follow-ups merged via PR #251, #255, #256, #257, #258; security/auth/diff via PR #259; repair/operator UX via PR #260 | Dashboard/DX lanes for dogfood readiness | **Active**; PRs merged but issue still open; #243 PR-merge gate spec done at runtime but issue still open |

## Detailed Arc Classification

### specs/current — first-level arcs

40 first-level arcs sit under `specs/current/` (verified via
`find specs/current -maxdepth 1 -type d`). Each is classified below with
its era, anchor, and status. Arcs without a decision/PR/spec anchor are
called out in the [Unclassified Bucket](#unclassified-bucket) instead of
being guessed.

#### 1. Resource-model era (D053-D107)

These arcs are the resource/doctor/reconciler/execution-integrity work that
landed before recovery. They still have value as compatibility/debug paths
and are not "removed", but their forward roadmap is frozen under
D166 (legacy surfaces stay as compatibility paths, not the normal public
model). They are individually marked **shipped / superseded-as-roadmap**.

| Arc | Decision trace | Status |
|---|---|---|
| `factory-resource-model/` | D053, D058, D059, D060, D061, D062, D063, D064, D066; P1-P4 README all marked `[x]` | done-as-implemented; superseded as the *public* roadmap by D166 |
| `factory-resource-model-setup.md`, `factory-resource-model-targets.md`, `edictum-targets.yaml`, `factory-resource-model/ductum-target.yaml`, `factory-resource-model/resources.yaml`, `factory-resource-model/target-fanout-dogfood.yaml` | Same as above | done-as-implemented (dogfood manifests) |
| `factory-agent-resource-model/` | D065 (agent-composition refs); has P1 file | done-as-implemented; superseded as public roadmap by D166 |
| `agent-runtime-resolution/` | D067; README mentions verified locally | done-as-implemented |
| `agent-settings-resource-refs/` | D085; README status: "verified locally" | done-as-implemented |
| `agent-cli-resource-refs/` | D097; P1 file | done-as-implemented |
| `agent-system-prompt-runtime/` | D088 | done-as-implemented |
| `agent-system-prompt-doctor-readiness/` | D089 | done-as-implemented |
| `harness-resource-runtime/` | D080 | done-as-implemented |
| `harness-durability-protocol-hardening/` | D164 (related); README mentions audit-and-slices, P0-P6 files | active-or-parked — see P-flag in the README; without a closed-stage decision this arc stays unclassified below |
| `notification-channel-runtime/` | D079 | done-as-implemented |
| `workflow-profile-runtime/` | D082, D083, D084; README "verified locally for the implementation slice" | done-as-implemented |
| `config-resource-settings-panels/` | D086; README "implemented and verified" | done-as-implemented |
| `sandbox-runtime-preflight/` | D077, D078 | done-as-implemented |
| `sandbox-runtime-driver/` | D081 | done-as-implemented (host/worktree driver) |
| `sandbox-settings-runtime-alignment/` | D102 | done-as-implemented |
| `dispatcher-startup-readiness/` | D090 | done-as-implemented |
| `complete-noop-visibility/` | D092 | done-as-implemented |
| `public-url-deploy-readiness/` | D091 | done-as-implemented |
| `public-url-dns-resolution/` | D093 | done-as-implemented |
| `deploy-restart-guidance/` | D096 | done-as-implemented |
| `telegram-deploy-readiness-truthfulness/` | D095 | done-as-implemented |
| `telegram-chat-discovery-errors/` | D094 | done-as-implemented |
| `audited-state-reconciliation/` | D104, D105 | done-as-implemented |
| `state-convergence-reconcile/` | D106 | done-as-implemented |
| `through-ductum-execution-integrity/` | D107 | done-as-implemented |
| `execution-integrity-operator-readiness/` | D108 | done-as-implemented |
| `operator-run-outcome-closure/` | D103 | done-as-implemented |
| `unified-resource-apply/` | D098 | done-as-implemented |
| `project-resource-apply/` | D099 | done-as-implemented |
| `spec-resource-apply/` | D100, D101 | done-as-implemented |
| `resource-backed-doctor-readiness/` | no top-level decision number located; README states "implemented and verified; external Claude reviewer unavailable" | done-as-implemented; forward roadmap superseded by D166 |
| `behavior-contract-slop-review/` | D066 | done-as-implemented |
| `contract-consistency-hardening/` | D162, D163; P0-P5 files present | active-or-parked — see P-flag in the README; without a closed-stage decision this arc stays unclassified below |
| `qratum-dogfood-capture/` | No anchor decision located | unclassified — no era anchor |

#### 2. Factory-readiness-recovery era (D109 → D131)

| Arc | Decision trace | Status |
|---|---|---|
| `factory-readiness-recovery/` | D109 (open), D110-D113 (per-stage), D114-D118 (gates), D119-D130 (related), D131 (close) | **done** (Outcome A) per D131; README stage table is *stale* — see "Stale README call-outs" |

#### 3. Bootstrap-redesign era (D147-D160 → D161)

| Arc | Decision trace | Status |
|---|---|---|
| `bootstrap-redesign/` | D147-D160 (per-stage), D161 (pause) | **paused** (D161). P0-P4 marked `[x] Shipped`; P5 marked `[ ] Harness implemented; operator demo pending` |

#### 4. Operational-model-redesign era (D162 → D166)

| Arc | Decision trace | Status |
|---|---|---|
| `operational-model-redesign/` | D162-D166; P1-P9 stage files; D166 close | **done** (P9 PASS, 2026-06-09) |
| `post-p9-hardening/` (parent) | D166 | P0 done/pass; P1-P4 **parked** |
| `post-p9-hardening/best-of-n/` | no anchor decision; README "P0 accepted. P1-P8 implemented in working tree" | partially done / parked until dogfood; no merge evidence in this run → call out as **active, partial** |
| `post-p9-hardening/factory-settings-source-of-truth/` | D170; README "P0-P9 done/pass" | **done** |
| `post-p9-hardening/stalled-attempt-recovery/` | No anchor decision; README "Status: Proposed urgent hardening slice after the 2026-06-14 dogfood smoke" | **unscheduled** (proposal, no decision anchor) |

#### 5. Phase 2 / unattended stabilization era (D172-D179 + unattended-factory-hardening)

The phase2 streams A-G live in `design/parallel/phase2-*.md`, not under
`specs/current/`. Their closeout is recorded in D172-D179 plus the
`design/parallel/unattended-factory-hardening/` README. They are not first-level
`specs/current` arcs. The active phase-2-plus surface is the
`unattended-factory-hardening` package, which is **active**.

| Artifact | Anchor | Status |
|---|---|---|
| `design/parallel/phase2-agent-identity.md` | D166, design/04 §5/§6 | stream A — done (merged) |
| `design/parallel/phase2-podman-sandbox.md` | D172 | stream B — done (driver) |
| `design/parallel/phase2-gate-transaction.md` | D173 | stream C — done |
| `design/parallel/phase2-lease-fencing.md` | D173 | stream D — done |
| `design/parallel/phase2-reconciler.md` | D173, D174 | stream E — done (proof recorded in D174) |
| `design/parallel/phase2-autonomy-legibility.md` | D173 | stream F — done |
| `design/parallel/phase2-quarantine-lineage.md` | D173, D175 | stream G — done (proof recorded in D175) |
| `design/parallel/unattended-factory-hardening/` (umbrella) | D172-D179; P1-P7 prompt files | **active**; P1-P6 partially shipped, P7 burn-in unfinished |
| `agent-first-factory-readiness/` (P1-P21) + `agent-first-factory-readiness.yaml` | D052, D053, D058, D059, D060, D108; YAML `status: approved` | done-as-implemented; superseded as *forward* roadmap by D166. The arc has no README and 21 P-files; individual P-files are not enumerated against merge evidence in this run → counted as part of the pre-recovery backlog |
| `agent-validator-bakeoff/` | D126 (bakeoff shipped), D127 (cascade-leak postmortem) — referenced from `evidence/PROMPT.md` | **abandoned** (one-shot bakeoff; preserved for audit trail per the evidence header) |

### specs/backlog

`specs/backlog/` holds dogfood + scanner + dx items that are explicitly
**backlog**, not current. None are on the active roadmap. They are listed
here for completeness and explicitly **separated from current roadmap**.

| File | Anchor | Status |
|---|---|---|
| `next-session-inventory.md` | authored 2026-05-03 snapshot | **stale snapshot** (not a contract; verify against live repo — multiple listed items have moved) |
| `spec-milestone-map-resource.md` | authored by this run, 2026-07-04; decision draft D187 | **backlog idea** (acceptance-level only; not on the active roadmap) |
| `agent-first-cli-output.yaml` | D135 agent-first contract | unscheduled |
| `dashboard-route-splitting.yaml` | none located | unscheduled |
| `dogfood-lineage-failure-cleanup.yaml` | none located | unscheduled |
| `dogfood-workflow-followups.yaml` | none located | unscheduled |
| `dx-fixes.yaml` | none located | unscheduled |
| `multi-model-test.yaml` | none located | unscheduled |
| `scanner-verify-codex.yaml` | D124 agent-test-validator | unscheduled |
| `scanner-verify.yaml` | D124 agent-test-validator | unscheduled |

### specs/dogfood

`specs/dogfood/` are demo/polish fixtures and live dogfood capture specs.
They are explicitly **separated from current roadmap**.

| File | Status |
|---|---|
| `agent-first-demo-readiness.yaml` | historical demo readiness fixture |
| `approval-deny-resume-gap.md` | historical |
| `approval-state-safety-guard.md` | historical |
| `cli-watch.md` | historical |
| `dispatcher-status-demo-polish.yaml` | historical demo fixture |
| `fix-polish-approval-and-sidebar-demo-state-r1.md` | historical |
| `model-catalog-ui-test.yaml` | historical |
| `operator-close-cli.yaml` | historical |
| `operator-queue-cli.yaml` | historical |
| `sandbox-shell-db-access-gap.md` | historical |
| `settings-model-picker-final-polish.yaml` | historical |
| `settings-model-picker-readable-recovery.yaml` | historical |
| `spec-import-role-status-glm.md` | historical |
| `spec-import-role-status.yaml` | historical |
| `telegram-cli-setup.md` | historical |
| `telegram-status-settings.yaml` | historical |
| `telegram-webhook-cli.md` | historical |

### specs/dogfood-live

`specs/dogfood-live/` holds short-lived live dogfood capture specs. They are
**separated from current roadmap** and treated as live-session artifacts.

### specs/examples and specs/templates

`specs/examples/` and `specs/templates/` are authoring fixtures, not roadmap
items. They are **separated from current roadmap**.

### specs/impl-* (historical implementation prompts)

`specs/impl-001` through `specs/impl-016-force-fail` are historical
implementation prompts. Per AGENTS.md and CLAUDE.md ("The `specs/impl-*`
directories are historical records and import fixtures"), they are
**superseded** as a forward roadmap.

| Directory | Status |
|---|---|
| `specs/impl-001/` (P1-P11 core types/API/MCP/CLI/harness/dashboard) | superseded — subsumed by D166 cutover |
| `specs/impl-002-dashboard/` | superseded — dashboard work moves through operational-model-redesign P7 and post-P9 hardening |
| `specs/impl-003-multi-model/` | superseded |
| `specs/impl-004-workflow/` | superseded — absorbed by impl-009 |
| `specs/impl-005-operational/` | superseded |
| `specs/impl-006-dx-polish/` | superseded |
| `specs/impl-007-worktrees/` | superseded |
| `specs/impl-008-containerized/` | superseded by phase-2 Podman work (D172, D176, D179) |
| `specs/impl-009-edictum-integration/` | superseded — D28 enforces @edictum/core API; runtime shipped |
| `specs/impl-010-scenario-validation/` | superseded — replaced by D124 agent-test-validator |
| `specs/impl-012-vercel-ai-harness/` | superseded — D051-D052 blocked Pi/Vercel path |
| `specs/impl-013-loop-proof/`, `specs/impl-014-fix-loop-proof/`, `specs/impl-015-fix-loop-real/`, `specs/impl-016-force-fail/` | superseded — bakeoff/loop proof fixtures, historical |

## Current-Era Evidence (live, 2026-07-04)

This section reflects what live read-only surfaces show **right now**.
Where live state disagrees with a README, the live state wins and the
README is flagged in [Stale README call-outs](#stale-readme-call-outs).

### GitHub issue state

| Issue | State | Notes |
|---|---|---|
| #243 — `fix(factory): require green PR CI and merge before completion` | OPEN | Ductum spec `PRCQDGLy9_7i` (same scope) is **done** in `ductum spec list ductum`. Runtime later approval behavior proves the gate is enforced, so the spec is functionally shipped; the GitHub issue remains the operator-visible tracker. |
| #244 — `feat(dashboard): remediate UI/DX audit lanes for dogfood readiness` | OPEN | Wave 1 + runner follow-ups shipped through PRs; wave 2 (security/auth/diff + repair/operator UX) shipped 2026-07-04. Issue still open because tracker is not closed at the GitHub layer. |

### #244 wave 1 + follow-up PRs (merged)

| PR | Merge timestamp | Title |
|---|---|---|
| #251 | 2026-07-03 20:39:05 UTC | `feat: PROJECT-SPEC-SAFE-TASK-LABELS` |
| #255 | 2026-07-03 22:34:58 UTC | `feat: DATA-TRUTH-REMAINDER` |
| #256 | 2026-07-03 22:39:58 UTC | `feat: SETTINGS-CONFIG-REMAINDER` |
| #257 | 2026-07-04 00:42:39 UTC | `feat: FOLLOWUP-ROUND-VISIBILITY-RECOVERY` (runner follow-up) |
| #258 | 2026-07-04 08:16:50 UTC | `feat: RECOVER-COMPLETE-HANDOFF-GUARD` (completion-handoff guard) |

### #244 wave 2 PRs (merged 2026-07-04)

| PR | Merge timestamp | Merge commit | Final head | Title |
|---|---|---|---|---|
| #259 | 2026-07-04 10:18:19 UTC | `5806a017f28f9a6fe72761189d1319a32b5662c1` | `643c63d94d5403a07dd5dbf9e630384758ac2537` | `feat: SECURITY-AUTH-DIFF-RECOVERY` |
| #260 | 2026-07-04 11:37:44 UTC | `9cbd8904b493cbd8e62b362baf305fdc0a33f022` | `0d7663f3e185bb40428c29803a2dcb8ffd8d2b9d` | `feat: RECOVER-REPAIR-OPERATOR-UX-FROM-GIT` |

PR #260's required checks `audit`, `bootstrap-self-test`, and `build-and-test`
were green before merge per the task brief; `gh pr view` confirms the merge
state. The exact CI matrix is not re-fetched in this run.

### #244 residual

- Browser/persona proof remains a #244 residual. The current session had no
  in-app browser backend; `agent.browsers.list()` returned `[]`. This is
  called out, not papered over.
- The Ductum spec for #244 wave 2 (`GfhV9ANtGl_C issue-244-wave2-repair-security`)
  is **failed** in `ductum spec list ductum`. The merge evidence above
  supersedes the spec status for the runtime-behavior claim; the spec status
  reflects that the run did not close cleanly through Ductum's
  approval/merge path. Both facts are recorded honestly.

### Ductum spec list highlights

- `PRCQDGLy9_7i fix: require CI green before approval merge` → **done**
  (maps to issue #243).
- `gKEnzNoEEE3x issue-244-project-spec-labels` → **done** (wave 1 labels).
- `L_h4tdrYODR8 issue-244-wave1-data-settings` → **done** (wave 1 data +
  settings).
- `GfhV9ANtGl_C issue-244-wave2-repair-security` → **failed** (wave 2 spec
  did not close cleanly through Ductum; PRs #259 + #260 still merged).
- Multiple `[post-source-of-truth P2] ...` and `[post-P9 P2] ...` specs are
  **done**, evidence that the post-P9 P2 hardening slice is partly shipped
  even though the README marks P2 as parked.

## Stale README Call-Outs

The report does not silently trust README state. The following
discrepancies between README content and live evidence are called out
explicitly:

1. **`specs/current/factory-readiness-recovery/README.md` is stale.**
   D131 says all seven P-stages shipped (Outcome A), but the README table
   still shows P2, P3, P4, P5, P6 as `[ ]`. The closeout decision
   (D131) is authoritative; the README table predates it. Do not re-close
   P-stages based on the README alone.
2. **`specs/CURRENT.md` Active Mission header is partly stale.** It still
   describes "post-P9 hardening" as the active theme, while AGENTS.md and
   CLAUDE.md name "Restart stabilization after the Ductum redo" as the
   active mission (2026-06-23). Trust AGENTS.md/CLAUDE.md over
   `specs/CURRENT.md` for the active-mission sentence.
3. **`specs/backlog/next-session-inventory.md` is a 2026-05-03 snapshot,
   not a contract.** Multiple items it lists as "next" have shipped (the
   bootstrap-redesign arc, the D146 live-demo harness for SSE/cancel,
   and the broader D135-D146 operational hardening bundle). Its own
   header says "Treat it as a snapshot, not a contract — verify against
   the live repo before claiming any item." That instruction is honored
   here.
4. **`specs/current/post-p9-hardening/README.md` marks P2 as parked**,
   but several `[post-P9 P2] ...` Ductum specs are done. The parked marker
   means "no P2 stage prompt has been authored", not "no P2 work has
   shipped." Do not read the parked marker as "nothing happened."
5. **`design/parallel/unattended-factory-hardening/README.md` execution
   order marks all P1-P7 as `[ ]`** even though D172-D179 record merged
   work that maps to those stages (Podman driver, quarantine,
   structured review contract, unattended approval policy, agent network
   boundary). The `[ ]` markers are stale; the linked decisions are the
   authoritative status source.

## Unclassified Bucket

These artifacts exist in the worktree but cannot be cleanly tied to a
decision, PR, Ductum spec state, or explicit README statement that this run
located. They are **not guessed**. A future operator decision (or a
follow-up spec like `specs/backlog/spec-milestone-map-resource.md`) should
place them in an era.

| Artifact | Why unclassified |
|---|---|
| `specs/current/qratum-dogfood-capture/` | No anchor decision located in this run; the README is an intake doc without a status verdict |
| `specs/current/contract-consistency-hardening/` | Has a P0-P5 file set and references D162-D163, but no closeout decision located; individual P-file status not enumerable from the README |
| `specs/current/harness-durability-protocol-hardening/` | Has a P0-P6 file set and references D164, but no closeout decision located; individual P-file status not enumerable from the README |
| `specs/current/agent-first-factory-readiness/` (P1-P21) | YAML marks the spec `approved`, but there is no README and no per-P merge evidence enumerated in this run. Treat the arc as the pre-recovery agent-first backlog; individual P-files are not classified by this report |
| `specs/current/agent-first-factory-readiness.yaml` | Same as above — single-file intake YAML without closeout evidence |
| `specs/dogfood-live/*` | Live dogfood capture fixtures; per-session, not roadmap. Not classified into an era |
| `specs/backlog/dashboard-route-splitting.yaml`, `dogfood-lineage-failure-cleanup.yaml`, `dogfood-workflow-followups.yaml`, `dx-fixes.yaml`, `multi-model-test.yaml` | No anchor decision located |

## Counts

| Bucket | Count |
|---|---|
| First-level `specs/current/` arcs | 40 |
| `specs/current/` READMEs | 38 (40 arcs minus `agent-first-factory-readiness` and `agent-validator-bakeoff`, which have no README) |
| `specs/impl-*` directories | 15 |
| `specs/backlog/` files | 10 (2 markdown — `next-session-inventory.md` + this run's own `spec-milestone-map-resource.md` — plus 8 yaml) |
| `specs/dogfood/` files | 17 |
| `specs/dogfood-live/` files | 6 |
| `specs/examples/` files | 3 (`cli-onboarding-smoke.yaml`, `hello-readme/README.md`, `hello-readme/P1-HELLO-README.md`) |
| `specs/templates/` files | 1 |
| Total files under `specs/` (worktree count) | 383 (includes this run's own `specs/backlog/spec-milestone-map-resource.md`) |
| Decision files under `decisions/` (`.md` file count) | 151 (max decision index is D187; not every number is used) |
| Design pillar docs (`design/01-shape.md` … `design/06-dx-onboarding.md`) | 6 |
| `design/parallel/phase2-*.md` stream briefs | 8 |
| `design/parallel/unattended-factory-hardening/P*.md` prompts | 7 + README + evidence/fixes subfolders |

The counts above come from `find specs -type f` and from listing the
`decisions/` and `design/parallel/` directories inside the run worktree.
They are file counts, not "feature counts" — the AGENTS.md rule about
SQL `COUNT(*)` vs default-limited list methods does not apply to markdown
file counts.

## Drift Handling

- **No silent guesses.** Anything not tied to a decision/PR/spec/README is
  in the Unclassified Bucket above.
- **Stale README state is named**, not trusted.
- **Live evidence updates the current-era rows.** Issue/PR state was
  fetched via read-only `gh` and `ductum` commands; if those surfaces say
  something different from a README, the README is flagged.
- **Sandbox shape.** Every file this report cites lives inside the run
  worktree. The previous attempt was cancelled for reading outside it;
  this attempt derives everything from the worktree plus the read-only
  GitHub/Ductum surfaces named in [Method](#method).

## Slop Review

- [x] **Evidence quality.** Every status entry ties to a decision number, a
  PR number with merge timestamp, a Ductum spec state, or an explicit
  "unclassified" placement. No "looks done" guesses.
- [x] **Sandbox shape.** No outside-worktree source reads. `git status`
  shows only this run's worktree branch.
- [x] **Missing or invalid inputs are loud.** Missing anchor decisions for
  `qratum-dogfood-capture`, `contract-consistency-hardening`,
  `harness-durability-protocol-hardening`, and the agent-first backlog
  land in the Unclassified Bucket rather than being silently labeled.
- [x] **No duplicate/stale planning.** This report is a single new
  artifact under `inventory/`; it does not duplicate `next-session-
  inventory.md` and explicitly flags that inventory as a stale snapshot.
- [x] **Behavior Contract items have evidence.** The "Behavior Contract"
  of the generating task is reproducible from the live-evidence tables
  above.
