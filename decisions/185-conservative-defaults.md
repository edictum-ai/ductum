# D185 — Conservative defaults for new records

**Date:** 2026-06-27
**Status:** accepted
**Linked:** legacy issue #55 (originally acartag7/ductum#36), D166 (operational-model-redesign closeout), D178 (workflow-owned unattended approval policy)

## Context

Legacy issue #55 called out a process-enforcement failure mode: new Project
creation defaulted `mergeMode` to `auto`. For a product whose wedge is governed
execution ("approval before risky transitions", "no done state before required
evidence"), an opt-out conservative default is the only honest stance. Operators
who want auto-merge, auto-dispatch, or unattended approval must escalate
explicitly; the system never silently picks the faster path.

The imported issue body was brief. The closed-form interpretation is therefore
narrow and explicit: every defaults producer that can mutate how a record is
merged, dispatched, or approved must default to the protective mode unless an
operator opts in.

## Decision

For any new record that controls merge, dispatch, or approval behavior:

1. **Merge mode defaults to `human`.** Project create, factory seed, and any
   future producer that mints a `mergeMode` value must pick `human` when no
   explicit value is supplied. `auto` is opt-in only.
2. **Dispatch defaults to off.** No new task, run, or attempt is auto-dispatched
   without an explicit operator action (CLI command, dashboard click, or
   approved dispatcher policy). Factory-wide `dispatcherEnabled` is a separate
   runtime setting, not a per-record default; it is not a substitute for the
   per-record rule.
3. **Approval defaults to required.** Unattended approval, unattended merge,
   and unattended push are blocked unless the workflow profile explicitly
   allows them and all gate evidence is present. Absence of policy means
   "blocked", never "allowed".

When a producer wants to ship a different default, it must record a follow-up
decision that names the protective default being relaxed and the operator
opt-in that replaces it. Silent regressions are not acceptable.

## Enforcement in this repo

- `AGENTS.md` now states the directive as a repo rule.
- `packages/api/src/routes/projects.ts` defaults `mergeMode` to `'human'` when
  the request omits it or passes an unrecognized value. Only an explicit
  `'auto'` opt-in produces an auto-merge project.
- `packages/core/src/factory-seed.ts` seeds the initial factory project with
  `mergeMode: 'human'`, matching the directive's reference shape for new
  records.
- `packages/core/src/unattended-approval-policy.ts` keeps approval fail-closed
  when no `unattended` policy is present, when stages are incomplete, or when
  required evidence is missing. This is the approval-required default.
- `packages/api/src/tests/conservative-defaults.test.ts` covers representative
  default choices: project create without `mergeMode`, factory seed project
  `mergeMode`, and unattended approval rejection when no policy exists.
- `scripts/check-conservative-defaults.mjs` fails CI if the directive, the
  AGENTS.md rule, or the named evidence markers disappear.

This guard is intentionally evidence-based. It does not prove every future
defaults producer will be conservative semantically; it blocks the known
regression shapes (auto-merge default, silent unattended approval) that made
the legacy issue necessary in the first place.

## Consequences

- New factories, projects, tasks, and runs start in the protective mode.
- Operators who want auto behavior must escalate through an explicit,
  auditable opt-in (request field, runtime setting, or workflow profile
  policy).
- Future defaults producers must add a representative test and a guard
  marker, or this directive will block the change in review.
