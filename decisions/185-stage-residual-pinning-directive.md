# D185 — Stage residual pinning directive

**Date:** 2026-06-29
**Status:** accepted
**Linked:** GitHub issue #56 (legacy migrated), D166 (operational model redesign closeout), D184 (readiness failing-path proof)

## Context

The closing-round evidence for the Factory Settings source-of-truth arc
(`specs/current/post-p9-hardening/factory-settings-source-of-truth/evidence/P9-07-closeout.md`)
recorded five findings "for later stages" as prose. Each one was a real defect
or known issue, but none pointed at a fix, a test pinning current behavior, or
a decision. That is the failure mode issue #56 calls out: residuals can
evaporate as prose unless pinned.

D184 set the precedent for an evidence-based process directive: state the rule
in `AGENTS.md`, record the decision, and gate the directive's continued
presence with a guard script. This decision reuses that shape for residuals.

## Decision

A stage may close with residuals only when each residual carries at least one
of these pins:

1. **Fix** — a durable artifact that addresses the residual in this stage's
   scope: a committed SHA or a merged PR. Mutable references (unmerged
   branches, staged file paths, working-tree changes) are not durable fixes
   and do not satisfy this pin. If the change is not yet committed or merged,
   use a test pin or decision reference instead, or keep the stage open.
2. **Test pinning current behavior** — a characterization or regression test
   that fails if the current behavior changes, with a comment naming the
   residual.
3. **Decision reference** — a `decisions/<NNN>-*.md` number that accepts,
   defers, or transforms the residual.

A residual with none of these pins fails closed: the stage cannot claim done.

Residuals live in a `## Residuals` section of the stage file. A stage with no
residuals writes that explicitly. The full rule, scope, and examples live in
`docs/STAGE_RESIDUAL_PINNING.md`, which is the source of truth.

## Enforcement in this repo

- `AGENTS.md` now states the directive as a repo rule, next to the D184
  failing-path rule.
- `docs/STAGE_RESIDUAL_PINNING.md` is the canonical directive text.
- `specs/current/post-p9-hardening/README.md` mentions residual pinning in the
  P4 Process Directives section so parked stages inherit the template.
- `scripts/check-stage-residuals.mjs` fails CI if the directive, decision, or
  AGENTS.md rule markers disappear, mirroring the D184 guard.

This directive is documentation-only. It does not add a second policy engine,
does not require residuals to be fixed (only pinned), and does not retroactively
rewrite historical closeouts. Existing prose residuals discovered during a
future stage get pinned when that stage touches them.

## Consequences

- New stage closeouts must either fix, pin, or decide each finding before
  claiming done.
- Reviewers have a concrete checklist for residual sections instead of trusting
  prose.
- Future regressions in findings like the P9-07 "verify-fail + fix loop on
  first dispatch" leave an auditable trail back to a fix, test, or decision.
