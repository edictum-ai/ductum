# D184 - Readiness checks need failing-path proof

**Date:** 2026-06-26
**Status:** accepted
**Linked:** legacy issue #36, D108 (execution-integrity operator readiness), D173 (quarantine and next action)

## Context

Legacy issue #36 called out an always-green readiness failure mode: a check that
cannot fail becomes decoration, not proof. That is worse than no check because
operators can mistake a passive badge for verified system state.

Ductum already has several repair/readiness failing-path tests, but the rule was
implicit and scattered. New repair producers could still land with only happy
paths or snapshot coverage.

## Decision

Every readiness or repair producer that can block operator trust must have at
least one failing-path test before it ships.

The failing path must prove one of these outcomes:

1. A failed prerequisite emits the expected repair item.
2. A failed prerequisite blocks dispatch, approval, or task start.
3. A failed prerequisite stays scoped to the affected project/repository/agent
   and does not make unrelated work ineligible.

If a proposed check has no meaningful failing path, do not present it as a
readiness check. Remove it, or mark the value as asserted/configured metadata so
it cannot be mistaken for verified proof.

## Enforcement in this repo

- `AGENTS.md` now states the directive as a repo rule.
- `packages/core/src/tests/repair-readiness-states.test.ts` covers the core
  failing producer families that emit repair items.
- `packages/api/src/tests/repair.routes.test.ts` keeps dispatch and accept
  paths fail-closed before attempts start.
- `packages/core/src/tests/repair-workflow-validity.test.ts` keeps workflow
  validity blockers scoped to the referencing project.
- `scripts/check-readiness-failing-paths.mjs` fails CI if the named directive
  and failing-path test evidence disappear.

This guard is intentionally evidence-based. It does not prove every future
readiness producer semantically; it blocks the known regression where a
readiness surface is added with no failing-path evidence at all.
