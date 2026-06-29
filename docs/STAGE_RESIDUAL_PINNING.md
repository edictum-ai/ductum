# Stage Residual Pinning

Generated from ductum.process.directive. Source of truth for this rule; do not
weaken it without a recorded decision.

## Problem

A stage that closes with loose "follow-up" notes tends to evaporate. The next
operator sees the closeout read as PASS, the residuals sit in prose, and the
behavior they describe is forgotten until it surprises someone in production.

The closing-round evidence for the Factory Settings source-of-truth arc
(`specs/current/post-p9-hardening/factory-settings-source-of-truth/evidence/P9-07-closeout.md`)
is the canonical local example: five findings were logged "for later stages"
with only evidence-file references. Each one was a real bug or known issue, but
none pointed at a fix, a test pinning current behavior, or a decision. That is
exactly the failure mode this directive exists to close.

## Directive

A stage may close with residuals only when each residual carries at least one
of these pins:

1. **Fix** — a durable artifact that addresses the residual in this stage's
   scope: a committed SHA or a merged PR. Reference the SHA or PR number with a
   one-line summary of the change. Mutable references — unmerged branches,
   staged file paths, working-tree changes — are not durable fixes; they can
   disappear after closeout, so they do not satisfy this pin. If the change is
   not yet committed or merged, use a test pin or decision reference instead,
   or keep the stage open.
2. **Test pinning current behavior** — a test file and test name that asserts
   the *current* (possibly wrong) behavior, with a comment naming the residual.
   The test must fail if the behavior changes, so the residual cannot disappear
   silently. Characterization/regression tests are valid pins.
3. **Decision reference** — a `decisions/<NNN>-*.md` number that accepts,
   defers, or transforms the residual. The decision must name the residual and
   state why it is not addressed in this stage.

A residual with none of these pins fails closed: the stage cannot claim done.

## Where residuals live

Residuals belong in a `## Residuals` section of the stage file (the `P*.md`
prompt or the closeout evidence). A stage with no residuals writes that
explicitly:

```markdown
## Residuals

None. Every finding from this stage was fixed, pinned by a test, or recorded as
a decision.
```

A stage with residuals lists them with explicit pin types:

```markdown
## Residuals

- **<finding>:** <one-line description>. Pin: fix `<sha>` in
  `<path/to/file.ts>`.
- **<finding>:** <one-line description>. Pin: test
  `<packages/core/src/tests/foo.test.ts> :: 'pins current X behavior'`.
- **<finding>:** <one-line description>. Pin: decision D185 accepts the current
  behavior pending a separate scope.
```

If a residual has no pin, it is not a residual — it is a blocker. Either fix
it, pin it, decide it, or keep the stage open.

## Scope of "stage"

This directive applies to any P-stage closeout, post-P9 hardening slice,
review-round fix, or dogfood run that claims a terminal status while leaving
findings open. "Terminal status" includes PASS, accepted, done, shipped, and
equivalent labels.

## Out of scope

- This directive does not require residuals to be *fixed* — only pinned. A pin
  can be a decision to defer.
- This directive does not add a second policy engine. The pin is documentation
  that points at existing artifacts (commits, tests, decisions).
- This directive does not retroactively rewrite historical closeouts. Existing
  residuals discovered during a future stage get pinned when that stage touches
  them; this directive governs new closeouts from the decision date forward.

## Enforcement

- `AGENTS.md` carries the directive as a repo rule.
- `decisions/185-stage-residual-pinning-directive.md` records the decision.
- `scripts/check-stage-residuals.mjs` fails CI if the directive, decision, or
  AGENTS.md rule markers disappear.
- Stage templates under `specs/current/post-p9-hardening/` mention this
  directive in their residual guidance.

## Failure mode this prevents

Stage P9-07 could close as PASS with five prose findings because the gate did
not ask "is each finding pinned?" The next operator who hit `verify-fail + fix
loop on first dispatch` had no trail back to a decision, test, or fix. With
this directive, the same closeout must either fix each finding, add a
characterization test, or cite the decision that accepts the behavior — or the
stage stays open.
