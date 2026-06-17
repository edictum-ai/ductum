---
date: 2026-05-01
status: implemented (2026-05-01)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 060, 109, 116, 118
---

# Decision 123: Reviewer-format compatibility — accept leading-verdict completions

## Context

The strict P18 verdict parser shipped under D060 expects the verdict
to be the LAST non-empty line of the reviewer completion (or the
first line under a `## Final verdict` heading after D116). The intent
was to close an operator-flow attack: a reviewer who writes
"PASS: at first glance" early in the completion and then walks the
verdict back in trailing prose would, under the original (pre-D060)
parser, ship as PASS. D060 hardened the parser to reject that case.

The P3 dogfood session uncovered the cost: every reviewer agent that
writes prose-mixed verdicts is rejected on first try. Codex always
opens with the verdict and then explains itself — its natural style
is "FAIL: missing null guard. Findings: 1. ..., 2. ...". Three of the
four reviewer agents on 2026-04-30 hit this. P19 needed three retries
plus the bespoke `operator-ship` endpoint to land.

The spec (P3.3) put two options on the table:

- **Widen `parseReviewResult`** to accept the verdict at the START of
  the completion text while keeping last-line strictness as a fallback.
- **Pre-fill `## Final verdict\n`** in the review prompt so any LLM
  drops the verdict where the strict parser already looks.

Pre-fill (option B) is the path D116 already took — the prompt
explicitly demands a `## Final verdict` section. Codex still ignores
it and emits its natural style. So pre-fill alone is insufficient.

## Decision

**`parseReviewResult` admits a third path: leading verdict.**

Priority order:

1. **Section anchor (D116)** — `## Final verdict` heading + verdict
   line that follows. Highest priority. Wins over leading and
   terminal paths even if they would also match.
2. **Strict terminal (D060)** — last non-empty line is verdict-shaped.
   Second priority. Wins over the leading path so a reviewer who
   opens with verdict-shaped prose AND closes with a clean verdict
   still parses to the closing verdict.
3. **Leading verdict (NEW, D123)** — first non-empty line of the
   completion is verdict-shaped (`PASS` / `PASS: ...` / `WARN: ...` /
   `FAIL: ...`). Accepted only after the rest of the completion is
   scanned for any other verdict-shaped line; if a later line carries
   a different verdict word, the parse is rejected as malformed
   (downgrade-attack defense).

The trailing prose under a leading verdict is preserved as feedback
so any concerns the reviewer aired still travel into the next stage.

## A/B evidence

The four reviewer agents we drive in this repo are `claude`, `codex`,
`glm`, and `copilot`. We collected representative completions from
each on 2026-04-30 (the day the P19 retry storm happened):

| Agent     | Style observed                                                | Old parser | New parser |
|-----------|---------------------------------------------------------------|-----------|-----------|
| claude    | Emits `## Final verdict` heading reliably                     | PASS      | PASS      |
| codex     | Verdict-first then prose ("PASS: ... \n Detailed review: ...") | malformed | PASS      |
| glm       | Sometimes heading, sometimes prose-first                       | mixed     | PASS      |
| copilot   | Closes with the verdict-shaped line                           | PASS      | PASS      |

The fixtures sit in
`packages/core/src/tests/parse-review-result-leading-verdict.test.ts`.
That suite plus the existing `parseReviewResult` cases in
`post-completion.test.ts` covers the three paths and the downgrade-
attack defense.

### Slop-review attack: "loosening admits malformed PASS"

The slop review explicitly demanded that the widening not admit
malformed output as PASS. The mitigation:

- The leading path **only** matches when the first non-empty line is
  itself a clean verdict-shaped line. Mid-prose mentions ("Overall
  this is a PASS in spirit") are still rejected because the prose
  sentence does not match the anchored verdict regex.
- The leading path **refuses** when any later line of the completion
  is a verdict-shaped line with a different verdict word. A reviewer
  writing "PASS: at first glance" then "FAIL: actually broken" parses
  as malformed and triggers a re-run.
- A leading PASS followed only by trailing prose (no further verdict-
  shaped lines) IS admitted as PASS. This is the soft case the slop
  review flagged. It is accepted as the price of Codex compatibility.
  Mitigations: the next reviewer in the chain re-checks; the human
  approver sees the diff plus reviewer feedback at approve time; the
  fix-loop on WARN/FAIL is unaffected because malformed-or-misread
  PASS does not trip the loop. The trade is documented here so the
  next operator pass can revisit it with real production data.

### Why not pre-fill alone

The prompt already pre-fills the `## Final verdict` template under
D116. Codex still emits its natural style on most reviews. Pre-fill
remains in the prompt because (a) other LLMs honor it and (b) when
present, it gives the strictest parse path. But pre-fill cannot
*force* Codex to comply, so the parser must also widen.

## Alternatives considered

1. **Hard-require both anchors (leading verdict AND closing verdict
   AND they agree).** Rejected. Doubles the verdict-emission
   requirement and Codex still wouldn't comply on its own.
2. **Heuristic uncertainty detection (look for "actually", "I am not
   sure", "however" in trailing prose).** Rejected. Brittle, locale-
   specific, and false-positive prone — the reviewer's job is to
   reason about the diff, including expressing nuance.
3. **Switch to a structured tool call instead of free-text verdict.**
   Deferred. Would need a per-harness MCP tool; out of scope for P3.
   Captured as future work in `OPEN-QUESTIONS.md`.

## Surfaces shipped

- `packages/core/src/post-completion.ts`:
  - `parseReviewResult` adds the leading-verdict path with
    downgrade-attack defense.
  - `acceptLeadingVerdictMatch` builds feedback from the trailing
    prose so reviewer findings survive.
  - `REVIEW_VERDICT_FORMAT_RULE` and `buildReviewPrompt` updated to
    document the leading-line acceptance.
- `packages/core/src/tests/parse-review-result-leading-verdict.test.ts`
  — new suite with realistic Codex/Copilot/Claude/GLM completions and
  the downgrade-attack regression cases.
- `packages/core/src/tests/post-completion.test.ts` — updated the
  prior "downgrade attack" case to point at its new home.

## Consequences

- Codex review of a representative diff produces a parseable verdict
  on first try.
- Reviewers who use `## Final verdict` heading or close with verdict
  line are unaffected — the priority order keeps their parse stable.
- The downgrade-attack surface narrows: a reviewer that emits two
  conflicting verdict-shaped lines is rejected outright, where before
  D060 the downgrade would silently ship as PASS.
- The single soft case (leading PASS with trailing doubt prose, no
  later verdict line) is accepted. Documented above as a known
  trade-off, mitigated by downstream gates.
