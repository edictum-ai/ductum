# Spec Milestone Map Resource — backlog feature idea

**Status:** backlog idea (acceptance-level only). Do not implement from this
document until a separate stage prompt names scope and verification.

**Author:** P1-GENERATE-SPEC-MAP-ARTIFACTS run, 2026-07-04.
**Linked:** `inventory/spec-arc-classification-report.md`,
`decisions/187-living-spec-milestone-map.md`, decisions `059`, `060`,
`131`, `161`, `166`, `172`-`179`.

## 1. Problem

The 2026-07-04 spec/arc classification report
(`inventory/spec-arc-classification-report.md`) was produced by hand from
the worktree plus live read-only surfaces. It surfaced several honest
inconveniences:

- The same arc appears under `specs/current/`, in `decisions/`, and in
  Ductum's `spec`/`task`/`run` records, with no single index that ties them
  together.
- README status tables inside `specs/current/*/README.md` drift from the
  decisions that actually closed the work. The recovery README still shows
  stages as `[ ]` even though D131 closed them; the
  `unattended-factory-hardening/README.md` execution order shows every
  stage as `[ ]` even though D172-D179 record merged work that maps to
  those stages.
- `next-session-inventory.md` is a snapshot, not a contract, but it is the
  closest thing to a backlog map.
- Phase-2 streams live in `design/parallel/phase2-*.md`, not under
  `specs/current/`, so a "list specs under `specs/current`" view hides
  in-flight work.
- There is no first-class Ductum resource that says "this arc belongs to
  this era, was opened by decision X, was closed by decision Y, and has
  these live PR/spec/run IDs."

This backlog feature idea is for a **living spec/milestone map resource**
that captures era/milestone/status for every spec or arc as durable
Ductum state, instead of regenerating it by hand.

## 2. Goals

- Make spec/arc era, milestone, and status a durable, queryable attribute
  of the spec or arc — not a README table that drifts.
- Tie each spec/arc to the decisions, PRs, Ductum specs, and Ductum runs
  that opened and closed it.
- Replace ad-hoc classification reports with a regenerable view.
- Make "this README is stale, here is the live decision" discoverable from
  one place.
- Keep the operator model intact: this is a *resource*, not a new
  top-level concept.

## 3. Non-Goals

- Do not implement the feature in this backlog spec. It is acceptance-level
  only. Implementation requires a separate stage prompt with its own
  verification.
- Do not introduce a new top-level primitive called `Milestone` or `Era`.
  The first cut should reuse existing Ductum resources (Spec, Decision,
  Evidence, Task, Run) per `decisions/059` and `decisions/060`. A new
  primitive needs a separate decision (D187 is the draft).
- Do not replace README tables by force. The map is the source of truth;
  README tables that disagree are *flagged*, not auto-rewritten.
- Do not add a new policy engine. Edictum keeps owning enforcement
  boundaries.
- Do not store sensitive auth material in the map. Era anchors and status
  labels are non-sensitive metadata only.
- Do not close GitHub issues from the map. Issue state is owned by the
  operator and the GitHub lifecycle.
- Do not surface third-party or outside-work references.

## 4. Acceptance Criteria

A future implementation is acceptable only when all of the following are
observable:

1. **Era is a durable attribute.** Every Spec record under a Ductum
   Project carries an `era` (or equivalent) field whose values are the
   eras named in `inventory/spec-arc-classification-report.md`
   (pre-recovery / resource-model, factory-readiness-recovery,
   bootstrap-redesign, operational-model-redesign, post-P9 hardening,
   phase-2 / unattended stabilization, current dogfood remediation).
2. **Status is durable and derived.** Every Spec carries a status that is
   either explicitly set by an operator decision or derived from linked
   Task/Run/Evidence/Decision rows. The values include `done`, `active`,
   `paused`, `abandoned`, `superseded`, `unscheduled`, and
   `unclassified`.
3. **Decision trace is queryable.** For every Spec, the map can answer
   "which decisions opened this arc, which closed it, and which decisions
   reference it" without re-deriving the answer from prose.
4. **Live evidence is queryable.** For every Spec, the map can answer
   "which GitHub issues, PRs, and Ductum specs/runs are linked to this
   arc" using existing Ductum records (no new GH fetch surface is
   required for the first cut).
5. **Stale README detection is real.** The map can compare its own status
   for a Spec to the status recorded in the README of the corresponding
   `specs/current/<arc>/README.md` (when one exists) and surface
   mismatches as repair items or operator-visible warnings.
6. **Regenerable report.** The same shape as
   `inventory/spec-arc-classification-report.md` can be produced from the
   map in one command, without manual worktree inspection.
7. **Unclassified bucket is honest.** Specs with no era anchor are listed
   in an explicit unclassified bucket, not silently guessed.
8. **No new policy path.** The map does not bypass approval/merge gates
   and does not auto-close issues. It is read-mostly.
9. **No sensitive-material leakage.** Public output of the map (CLI,
   dashboard, JSON) never includes any of the excluded categories named
   in the run's behavior contract.
10. **Operator model preserved.** The map does not introduce generic
    `resource`, `target`, or `run` wording in normal UI per
    `decisions/166`.

## 5. Dependencies

- Ductum Spec/Task/Attempt records (post-P9 operator model, D166).
- Ductum Decision/Evidence records (D059 design-to-spec workflow).
- Ductum GitHub lifecycle integration for issue/PR linkage (existing).
- Edictum enforcement boundaries (no new policy engine).
- No new npm dependencies for the first cut. Markdown/YAML plus existing
  TypeScript parsing are enough, matching D059's minimal-implementation
  direction.

## 6. Design Questions

These are open questions for the operator, not implementation guidance:

1. **Era as enum vs free-form?** Should the era field be a fixed enum
   (the seven eras above) or a free-form label that operators can extend?
   Enum is more rigid but cleaner; free-form is flexible but invites
   drift.
2. **Where does the map live?** Options:
   - SQLite-backed (matches D170 Factory Settings storage posture).
   - Markdown + front-matter (matches D059 minimal direction).
   - Both, with SQLite authoritative and Markdown exported.
3. **Stale README detection — read which files?** The first cut must read
   the README of each `specs/current/<arc>/` directory. Is that an
   acceptable read path, or should era/status live in a single
   project-scoped map file under `specs/` instead?
4. **Phase-2 streams and design/parallel — in scope?** Should the map
   also cover `design/parallel/phase2-*.md` and
   `design/parallel/unattended-factory-hardening/`, or only first-level
   `specs/current/` arcs?
5. **Status derivation rules — explicit decision needed?** When a Ductum
   spec is `done` but the linked GitHub issue is `OPEN` (e.g. issue #243
   today), which status wins? The report records both honestly; the
   resource needs one rule.
6. **Historical `specs/impl-*` — first-class or archive?** Should the
   map treat `specs/impl-*` as a single bucket marked superseded, or
   enumerate each impl-* directory?
7. **Backlog vs current vs dogfood — separation rule?** How should the
   map separate `specs/backlog/`, `specs/dogfood/`, `specs/dogfood-live/`,
   `specs/examples/`, and `specs/templates/` from the active roadmap
   without hiding them?
8. **PR/head evidence granularity?** Should the map store exact merge
   commit SHAs and final head SHAs (as the classification report does
   for PR #259 and #260), or only the PR number? Storing SHAs enables
   stronger audit but adds rows.
9. **Burn-in proof gate?** Should the map require an Evidence row
   pinning a "burn-in complete" claim before an arc can move to `done`,
   per the unattended-factory-hardening P7 pattern? Or is that the
   unattended-factory-hardening arc's job, not the map's?
10. **CLI surface?** Should `ductum spec map` (or similar) be the only
    operator-facing surface, or does the dashboard need a corresponding
    view? D135 agent-first contract applies if a new CLI surface is added.

## 7. Drift Handling

- If implementation needs a new primitive (e.g. `Milestone`), record a
  decision before adding it. D059 says "Do not add a top-level
  `DesignSession` yet"; the same caution applies to `Milestone`.
- If implementation needs to read files outside `specs/` and `decisions/`
  (e.g. `design/parallel/`), record a decision naming the read path and
  the reason.
- If implementation needs to add a new dependency, follow the supply-chain
  rule (D052 / D167 / SECURITY.md) and record the audit as a follow-up
  decision before installing.
- If the map's status for a Spec disagrees with a README, the map wins
  for *operator-facing* status; the README is flagged as stale. If the
  map's status disagrees with a decision, the decision wins and the map
  is repaired.
- No silent status guesses. Anything that cannot be derived is
  `unclassified` until an operator decision places it in an era.

## 8. Slop Review (acceptance-level only)

- [ ] Attack the implementation if it adds a new top-level primitive
  without a decision.
- [ ] Attack the implementation if it stores or echoes any of the
  excluded categories named in the run's behavior contract.
- [ ] Attack the implementation if it bypasses approval/merge gates or
  auto-closes GitHub issues.
- [ ] Attack the implementation if it surfaces `resource`, `target`,
  `run`, `seed` as normal-UI words (banned by D166).
- [ ] Attack the implementation if the unclassified bucket is missing or
  guessed.
- [ ] Attack the implementation if a README/decision/PR/spec/run status
  disagreement is silently resolved instead of surfaced.
- [ ] Attack the implementation if it adds a new npm dependency without
  a supply-chain decision.

## 9. Out-of-Scope Companion Artifacts

This backlog spec is one of three artifacts produced by the
P1-GENERATE-SPEC-MAP-ARTIFACTS run:

- `inventory/spec-arc-classification-report.md` — the one-shot
  classification report that motivates this feature idea.
- `specs/backlog/spec-milestone-map-resource.md` — this file.
- `decisions/187-living-spec-milestone-map.md` — the append-only decision
  draft that records the feature idea, draft decision, alternatives, and
  open questions.

Implementation is out of scope for this run.
