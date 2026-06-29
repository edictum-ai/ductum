# D185 - Stage residuals must be pinned before a stage closes

**Date:** 2026-06-29
**Status:** accepted
**Linked:** legacy issue #56, D173 (quarantine and next action), D177 (structured
review contract), D183 (count-query directive), D184 (failing-path proof)

## Context

Legacy issue #56 documented an honesty failure mode: residual issues noted in
review or closeout prose can evaporate. A stage that closes with a sentence
like "we noticed X but ran out of time" leaves no enforceable trace. The next
operator sees the closed stage, treats the prose as acknowledged work, and the
issue disappears into archived markdown without an owner, a test, or a follow-up
record.

The pattern mirrors the always-green readiness failure mode (D184) and the
silent truncated count (D183): a passive artifact is mistaken for verified
state. The safe closed-form interpretation of the legacy issue body is narrow
and explicit:

- A stage may close with residuals only when each residual is **pinned**.
- A residual is pinned when it has at least one of:
  1. A **fix** in the same change (the residual is fully resolved before close).
  2. A **test pinning current behavior** (the residual is reproducible and any
     future change has to keep the test or update it on purpose).
  3. A **decision reference** (the residual is recorded as a decision in
     `decisions/`, with context, alternatives, and an explicit owner of the
     follow-up).

Prose-only acknowledgment is not pinning. A TODO comment is not pinning. A
dashboard note is not pinning. The pin must be discoverable by the next agent
or operator without re-reading the original review.

## Decision

For any stage closeout, review note, or completion summary that lists a
residual:

1. **Each residual must cite at least one pin kind**, by reference, in the same
   artifact that records the close.
   - Fix: name the file/test/command that resolves it.
   - Test: name the test file and the behavior it pins.
   - Decision: name the `decisions/<NNN>-*.md` document and its status.
2. **Unpinned residuals block stage close.** The stage stays open, or the
   residual is recorded as a decision that explicitly accepts the residual and
   owns the follow-up.
3. **Prose-only acknowledgment is not a pin.** If a residual cannot be fixed or
   tested in scope, it must be escalated to a decision before the stage closes.
4. **Stage prompts and templates must mention residual pinning** so authors
   know to design acceptance criteria around pinned residuals rather than
   prose-only caveats.

## Enforcement in this repo

- `AGENTS.md` now states the directive as a repo rule.
- `.agents/skills/ductum-spec-authoring/SKILL.md` now requires stage prompts to
  mention residual pinning in their acceptance shape.
- `scripts/check-residuals-pinned.mjs` fails CI if the directive, the repo
  rule, or the stage-template mention disappear.

This guard is intentionally evidence-based. It does not prove semantically
that every future stage closeout has pinned every residual; it blocks the known
regression where the directive itself disappears and prose-only residuals
become acceptable again.
