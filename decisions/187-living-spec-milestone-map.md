# Decision 187 — Living spec/milestone map (draft)

**Date:** 2026-07-04
**Status:** draft (append-only). No operator sign-off yet. This record
captures the feature idea and its open questions; it does not authorize
implementation.
**Deciders:** none yet — proposed by the P1-GENERATE-SPEC-MAP-ARTIFACTS run.
**Linked:** `inventory/spec-arc-classification-report.md`,
`specs/backlog/spec-milestone-map-resource.md`, decisions `059`, `060`,
`131`, `135`-`146` (operational hardening bundle, including the D146
live-demo harness for SSE/cancel), `161`, `166`, `170`, `172`-`179`.

This is an **append-only decision draft**. It records context, draft
decision, alternatives, acceptance criteria, non-goals, and open
questions. Per `decisions/060`, no silent drift — if the eventual
implementation drifts from this draft, the drift is recorded as a
follow-up decision, not a quiet edit.

## Context

The 2026-07-04 operator request asked for two deliverables:

1. An immediate spec classification report — which specs/arcs belong to
   which era or milestone, and whether each is done, active, paused,
   abandoned, superseded, unscheduled, or unclassified.
2. A backlog feature idea with a decision draft for a living spec /
   milestone map.

The first deliverable shipped as
`inventory/spec-arc-classification-report.md`. It is a hand-produced
snapshot. Producing it surfaced real friction:

- The same arc is described in `specs/current/<arc>/README.md`, in one
  or more decisions under `decisions/`, in the GitHub issue/PR layer,
  and in Ductum `spec`/`task`/`run` records. There is no single index.
- README status tables drift from the decisions that actually closed
  the work. Concrete examples:
  - `specs/current/factory-readiness-recovery/README.md` still shows
    P2-P6 as `[ ]` even though D131 closed the arc as Outcome A.
  - `design/parallel/unattended-factory-hardening/README.md` shows
    every stage as `[ ]` even though D172-D179 record merged work that
    maps to those stages.
  - `specs/CURRENT.md`'s Active Mission header still says "post-P9
    hardening" while AGENTS.md and CLAUDE.md name "Restart stabilization
    after the Ductum redo" as the active mission.
- `specs/backlog/next-session-inventory.md` is explicitly a 2026-05-03
  snapshot, not a contract. It is the closest thing to a backlog map
  today.
- Phase-2 streams live under `design/parallel/phase2-*.md`, not under
  `specs/current/`. A spec-list view scoped to `specs/current/` hides
  in-flight work.
- "Unclassified" is a real category. Several arcs (qratum-dogfood-
  capture, contract-consistency-hardening, harness-durability-protocol-
  hardening, agent-first-factory-readiness) have no clean decision
  anchor today.

The operator's second deliverable asks for a feature idea that makes
this kind of map *part of the factory's durable state*, so the next
classification report is regenerated instead of hand-written.

## Draft Decision

Record a feature idea for a **living spec/milestone map resource** that:

1. Adds era and status as durable, queryable attributes of existing
   Ductum Spec records, **without adding a new top-level primitive** in
   the first cut. This honors `decisions/059`, which says "Do not add a
   top-level `DesignSession` yet. A design session is a spec in a
   planning workflow." The same restraint applies to `Milestone` and
   `Era`.
2. Treats era as a small enum anchored to the seven eras named in
   `inventory/spec-arc-classification-report.md`:
   pre-recovery/resource-model, factory-readiness-recovery,
   bootstrap-redesign, operational-model-redesign, post-P9 hardening,
   phase-2/unattended stabilization, and current dogfood remediation.
3. Treats status as one of `done`, `active`, `paused`, `abandoned`,
   `superseded`, `unscheduled`, or `unclassified`. The
   `unclassified` value is **explicit**, not a silent default.
4. Ties each Spec to the decisions, PRs, Ductum specs, and Ductum runs
   that opened and closed it, using existing record types.
5. Surfaces stale-README disagreements as repair items or operator-visible
   warnings instead of auto-rewriting README tables.
6. Is **read-mostly**. It does not bypass approval/merge gates, does not
   auto-close GitHub issues, and does not introduce a new policy engine.
7. Reuses the operator-model names (Factory, Project, Repository/Component,
   Spec, Task, Attempt) per `decisions/166` and does not surface legacy
   `resource`/`target`/`run`/`seed` words in normal UI.

The decision is **draft** because:

- The operator has not picked between SQLite-backed, Markdown-backed, or
  both (D170 strongly prefers SQLite for Factory Settings; D059 prefers
  Markdown for the first cut of design artifacts — these are in tension).
- The operator has not decided whether to add a `Milestone` primitive
  later. This draft explicitly defers that.
- The operator has not picked which design surfaces the map reads from
  (`specs/current/` only, or also `design/parallel/`).
- The operator has not decided whether stale-README detection is
  automatic or operator-triggered.

Those questions live in **Open Questions** below. None of them block the
decision draft; all of them block implementation.

## Alternatives Considered

### A. SQLite-backed map (authoritative)

Era, status, decision links, PR links, and run links live in typed
SQLite tables. CLI/dashboard/JSON consumers read typed APIs. README
tables become exports.

- **Pro:** matches D170 Factory Settings storage posture and D166
  operator-model cutover.
- **Pro:** strongest query/story for repair, audit, and drift detection.
- **Con:** schema migration cost; the first cut is heavier than D059's
  minimal direction.
- **Con:** harder for operators to hand-edit if the factory state and
  the map disagree.

### B. Markdown + front-matter map (minimal)

Era and status live in the front matter of each `specs/current/<arc>/`
README or in a single project-scoped `specs/MAP.md`. CLI/dashboard
consumers parse markdown.

- **Pro:** matches D059's "first version can be file-backed plus indexed
  in SQLite."
- **Pro:** trivial to author by hand for the first cut; matches the
  existing classification report.
- **Con:** drifts from D166's "DB is the source of truth after setup."
- **Con:** markdown is easy to edit and easy to leave inconsistent.

### C. SQLite authoritative + Markdown export

Authoritative era/status live in SQLite; a markdown view (the shape of
`inventory/spec-arc-classification-report.md`) is regenerated on demand
or on each status change.

- **Pro:** single source of truth + human-readable export.
- **Pro:** the existing classification report becomes the export, not a
  hand-maintained artifact.
- **Con:** more surface area than A or B alone; needs a generation
  command and a regen-on-change hook.
- **Recommended** for the first implementation, but the operator has not
  picked yet.

### D. Add a new top-level `Milestone` primitive

Treat era/milestone as a first-class record with its own table,
lifecycle, and links.

- **Pro:** cleanest model; enables milestone-level reporting and
  cross-arc milestone views.
- **Con:** rejected by D059's restraint rule ("Do not add a top-level
  `DesignSession` yet") and by D166's "Do not add new top-level
  concepts named `Operation` or `WorkOrder` yet."
- **Con:** until a real second consumer of milestone records exists,
  this is speculative abstraction. Per the design/README.md Scope Rule,
  reject until a real dogfood flow forces it.

### E. Do nothing; keep hand-produced classification reports

Stay with the status quo. Each classification report is one-shot.

- **Pro:** zero implementation cost.
- **Con:** every future report re-derives the era map by hand. README
  drift continues. The next operator session after a long gap is
  exactly where this hurts.

## Acceptance Criteria

This decision is **accepted** only when the operator records an
amendment that:

1. Picks one of alternatives A, B, or C (or names a different one).
2. Picks whether the map covers only `specs/current/` first-level arcs
   or also `design/parallel/phase2-*.md` and
   `design/parallel/unattended-factory-hardening/`.
3. Picks the rule for resolving disagreements between Ductum spec status
   and GitHub issue state (today's example: spec `PRCQDGLy9_7i` is
   `done` while issue #243 is `OPEN`).
4. Names the operator decision that authorizes implementation (e.g.
   "D187 amendment 1" or a separate D188+).

Implementation is acceptable only when the acceptance criteria in
`specs/backlog/spec-milestone-map-resource.md` are observable.

## Non-Goals

- Do not implement from this decision. It is a draft.
- Do not add a new top-level `Milestone` primitive in the first cut. A
  separate decision is required first.
- Do not auto-close GitHub issues, auto-merge PRs, or auto-rewrite
  README tables.
- Do not bypass Edictum enforcement boundaries or duplicate policy
  logic in Ductum.
- Do not store sensitive auth material in the map. Era anchors and status
  labels are non-sensitive metadata only; the excluded categories are the
  ones named in the run's behavior contract.
- Do not introduce third-party or outside-work references.
- Do not surface legacy `resource`/`target`/`run`/`seed` words in normal
  UI (D166).
- Do not change the operator model's public names (Factory → Project →
  Repository/Component → Spec → Task → Attempt).

## Open Questions

These are deliberately recorded as questions, not silently resolved:

1. Era as enum (the seven eras above) or free-form label?
2. SQLite-backed, Markdown-backed, or both with SQLite authoritative
   (alternatives A/B/C above)?
3. Scope: `specs/current/` only, or also `design/parallel/`?
4. Status disagreement rule: when Ductum spec is `done` but the linked
   GitHub issue is `OPEN`, which wins for *operator-facing* status? (The
   classification report records both honestly. The map needs one rule.)
5. Stale-README detection: automatic (continuous comparison) or
   operator-triggered?
6. Should the map require an Evidence row pinning a "burn-in complete"
   claim before an arc can move to `done`? Or is that owned by the
   `unattended-factory-hardening` P7 burn-in?
7. Historical `specs/impl-*`: first-class entries or a single
   `superseded` bucket?
8. Backlog/dogfood/examples/templates separation: handled by a
   `kind` field, by directory convention, or by Project scope?
9. PR/head evidence granularity: store merge-commit SHA + final head SHA
   (as the classification report does for PR #259 and #260), or only the
   PR number?
10. CLI surface shape: `ductum spec map`, `ductum era list`, a
    dashboard view, or all three? D135's agent-first contract applies
    to any new CLI surface.

## Drift Handling

- Implementation that drifts from this draft must be recorded as a
  follow-up decision per `decisions/060`.
- Adding a new primitive (`Milestone`, `Era`, etc.) requires a separate
  decision; it is not permitted by this draft.
- Adding a new npm dependency requires a supply-chain decision per
  D052/D167 before installation.
- Reading source files outside `specs/`, `decisions/`, `design/`, and
  `inventory/` requires a follow-up decision naming the path.
- The map must not become a second policy engine. If a future change
  would make the map enforce behavior (instead of report state), stop
  and record a decision.

## Slop Review (for the eventual implementation)

- [ ] Attack the implementation if a new top-level primitive appears
  without a separate decision.
- [ ] Attack the implementation if any of the excluded categories named
  in the run's behavior contract appear in map output.
- [ ] Attack the implementation if it bypasses approval/merge gates,
  auto-closes issues, or auto-rewrites README tables.
- [ ] Attack the implementation if the `unclassified` bucket is missing
  or silently guessed.
- [ ] Attack the implementation if a status disagreement (Ductum spec
  vs. GitHub issue vs. README) is silently resolved instead of surfaced.
- [ ] Attack the implementation if normal-UI surfaces `resource`,
  `target`, `run`, or `seed` words (D166).
- [ ] Attack the implementation if it adds an npm dependency without a
  supply-chain decision.

## How to apply (when accepted)

When the operator accepts this decision (or its amendment), apply it by:

1. Recording an amendment to this file (append-only, do not rewrite
   history) that names the chosen alternative and the answers to the
   open questions.
2. Authoring a stage prompt under `specs/current/` (likely under a new
   `specs/current/spec-milestone-map/` arc) with explicit scope,
   behavior contract, verification, drift handling, and slop review
   sections per the post-P9 stage template.
3. Running the stage through normal Ductum dispatch with verification
   gates per AGENTS.md.
4. Updating `inventory/spec-arc-classification-report.md` to note that
   the next report should be regenerated from the map, not by hand.
