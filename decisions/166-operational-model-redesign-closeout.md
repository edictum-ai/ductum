---
date: 2026-06-09
status: accepted
deciders: operator (Arnold Cartagena), Codex
related: 053, 054, 055, 056, 057, 131, 135, 161, 165
---

# Decision 166: Operational model redesign closeout

## Context

`specs/current/operational-model-redesign/` replaced the confusing old
operator surface where `ductum.yaml`, resources, Targets, Runs, seed state,
startup state, and dispatcher state all leaked into normal operation.

P1-P8 shipped the public contract facade, Factory data startup boundary,
Factory Settings catalogs, Project/Repository/Component model, Spec/Task/
Attempt facade, legacy migration, CLI/UI cutover, and repair/prerequisite/
safety work.

P9 was the final review and demo gate. Its job was not to add a feature; it was
to prove that the redesigned operator model can run the boring normal path and
that legacy state migrates honestly.

The latest P9 delta review result is **PASS** on 2026-06-09 after the P9
blocker fixes landed in `15ab5e4` (`fix: close p9 operator blockers`).

## Decision

The operational model redesign is accepted and closed as **PASS**.

Ductum's accepted normal operator model is now:

- Factory as the local control plane.
- Project as the daily product/system boundary.
- Repository as the required source boundary.
- Component as optional repository scope.
- Spec as the operator work request.
- Task as the concrete repository-scoped unit of work.
- Attempt as one execution try for a Task.
- Factory Settings for Providers, Models, Harnesses, Workflows, Agents,
  sandboxes, notifications, budgets, and app settings.

The redesigned public contract is accepted across UI, CLI, API, JSON, and
operator errors. Legacy Target/Run/resource surfaces can remain for migration,
debug, and compatibility, but they are no longer the documented normal path.

`ductum.yaml` is no longer accepted as the daily source of truth after
setup/migration. Migration and legacy Attempt display are accepted as honest
compatibility paths, not silent rewrites of history.

Ductum may now dogfood later polish stages. That dogfooding is governed by
normal verification gates and by the post-P9 hardening spec.

## Post-P9 Hardening

The following work remains explicit post-P9 hardening. These are not blockers
to closing this arc:

- P0: `workflow_validity` targeting and secret-message wording.
- P1: safety and honesty hardening across Repair, status, migration, output,
  and evidence surfaces.
- P2: model/API architecture seams, especially public/internal DTO boundaries,
  resource identity clarity, and duplicate formatter/redaction paths.
- P3: cleanup debt from the arc, including stale docs, legacy wording, large
  or duplicated files, and debug-only surfaces that still need clearer
  isolation.
- P4: process directives for future dogfood stages, including agent
  instructions, verification expectations, and decision-drift rules.

These items are tracked in
`specs/current/post-p9-hardening/README.md`.

## Consequences

- `specs/current/operational-model-redesign/README.md` marks P7, P8, and P9
  `done/pass`.
- `specs/CURRENT.md`, `AGENTS.md`, and `CLAUDE.md` no longer point at the old
  bootstrap/P5 active state.
- Future implementation work should start from the post-P9 hardening spec or a
  newer explicit current spec, not from old bootstrap-redesign P5 status.
- Bootstrap redesign remains governed by D161 until that paused arc is resumed
  or closed by a separate decision.

## Non-Goals

- This closeout does not implement the hardening items.
- This closeout does not reopen bootstrap redesign.
- This closeout does not add new harnesses, providers, workflow semantics,
  cloud coordination, or marketplace behavior.
- This closeout does not erase or rewrite historical Runs; it accepts the
  honest legacy Attempt display path.
