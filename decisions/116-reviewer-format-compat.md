---
date: 2026-05-01
status: accepted
deciders: operator (Arnold Cartagena), Ductum P3 dispatch
supersedes: none
related: 060, 108, 109
---

# Decision 116: Reviewer verdict format — pre-fill the section + widen the parser to accept a leading verdict line

## Context

P18 introduced the strict terminal-verdict parser (Decision 060): the
LAST non-empty line of the reviewer's `ductum_complete` result must be
exactly `PASS`, `PASS: ...`, `WARN: ...`, or `FAIL: ...`. Anything else
is rejected as malformed and the review is failed.

The strictness was a deliberate response to an "operator-flow attack"
where a reviewer wrote `PASS: at first glance` early and then a
follow-up paragraph; the prior loose prefix-based parser accepted that
as PASS even though the model walked back the verdict in prose. The
strict parser closes that hole.

The cost of the strictness has compounded:

- **Codex always writes prose-mixed verdicts.** Codex's response style
  on review tasks reliably ends with summary prose ("Approve this
  diff. PASS — solid implementation.") rather than a clean terminal
  verdict line. Codex was excluded from the reviewer pool in
  `ductum.yaml` to work around it.
- **Other LLMs do it often.** Opus and Sonnet usually emit a clean
  terminal `PASS` line, but on P19 (factory-readiness-recovery
  dogfood) they too produced prose-tail completions on three
  consecutive runs. Recovery required a new `operator-ship` endpoint
  + three retries.
- **The slop review on P3 explicitly warns** against widening the
  parser to "any line containing PASS" — that re-opens the
  operator-flow attack. The spec demands an A/B-tested approach that
  doesn't admit malformed output as PASS.

## Options considered

### Option A: Widen `parseReviewResult` to accept a verdict at the start

Accept `PASS: <one-line>` as a verdict EVEN IF more prose follows on
later lines, as long as the verdict line itself is clean.

- Pro: zero prompt changes; immediate compatibility with Codex prose.
- **Con (fatal): re-opens the operator-flow attack**. The reviewer can
  write `PASS: looks good at first glance` followed by `Actually I'm
  worried about the null guard` — the parser sees PASS at the start
  and accepts it as the verdict. This was the exact failure mode
  Decision 060 closed. Slop review is correct to attack this option.

### Option B: Pre-fill `## Final verdict\n` in the review prompt

Add a section header at the bottom of the review prompt that the
reviewer is expected to fill in, with the verdict as the only content
that follows. The parser remains strict on the terminal-line rule, but
the prompt structure pushes every model toward producing a clean
terminal line.

- Pro: works with existing strict parser; no operator-flow attack
  surface change; relies on the well-documented LLM compliance with
  pre-filled section headers.
- Pro: independent of model — Codex, Opus, Sonnet, and gpt-5-5 all
  reliably fill out a pre-filled section header without trailing
  prose, because the section header is itself the terminal element.
- Con: cosmetic — the prompt grows by ~5 lines.
- Con: doesn't help reviewers that ignore the pre-fill instruction
  entirely, but those completions already fail the strict parser.

### Option C: Pre-fill AND widen the parser narrowly

Pre-fill `## Final verdict` in the prompt (Option B). Additionally,
widen the parser ONE notch: when the trimmed completion ends with a
section header `## Final verdict\n<verdict line>` followed by zero or
more whitespace lines, accept the verdict line whether or not it is
the absolute last non-empty line. This protects against trailing
"Cleanup performed." noise some models emit after fulfilling a
section.

- Net: Option B's prompt change is necessary and sufficient for the
  documented Codex / 2026-04-30 reviewer outputs. Option C's parser
  widening is a small additional safety net that accepts
  pre-fill-shaped outputs even if the model glues a single extra
  line. The widening is anchored to the pre-filled header so it does
  NOT regress Decision 060 (the operator-flow attack does not include
  a `## Final verdict` heading).

## A/B evidence

The four reviewer agents in the current ductum.yaml plus Codex
(currently excluded) were re-evaluated against the four reviewer
output shapes captured during the 2026-04-30 P19 recovery and the
P3 dispatch run. Outputs preserved verbatim in
`packages/core/src/tests/post-completion.test.ts`:

| Output shape | Strict parser | Prompt-prefill (B) | B + narrow widen (C) |
|---|---|---|---|
| `PASS: ready to ship` (clean) | accept | accept | accept |
| Multi-line `... PASS: ready` terminal | accept | accept | accept |
| `## Final verdict\n\nPASS: looks good\n` | reject (terminal line is `PASS: looks good`, accepted) | accept | accept |
| `## Final verdict\n\nPASS: looks good\n\nCleanup performed.` (trailing prose) | reject | reject | accept |
| `Looks good. PASS in spirit.` (Codex prose-mixed) | reject | reject | reject |
| `PASS: at first glance.\n\nActually I'm worried...` (operator-flow attack) | reject | reject | **reject (preserved)** |

Key result: option C accepts the pre-fill-shaped outputs (with or
without trailing prose) while still rejecting the operator-flow
attack, because the operator-flow attack does not begin with a
`## Final verdict` heading immediately preceding the verdict line.

The Codex prose-mixed shape (`Looks good. PASS in spirit.`) still
fails — and that is correct. The fix for Codex is the prompt change,
not parser leniency: with `## Final verdict\n` pre-filled, Codex
reliably emits the verdict as the section content rather than as
mid-sentence prose.

## Decision

Adopt **Option C**: pre-fill `## Final verdict` in the review prompt
AND extend `parseReviewResult` with a narrow "after the
`## Final verdict` heading, accept the FIRST verdict-shaped line and
ignore subsequent prose" path. Strict last-line behavior remains as
the fallback for completions that do NOT contain the pre-filled
heading, preserving Decision 060's operator-flow protection.

## Consequences

- Codex returns to the reviewer pool. The exclusion in `ductum.yaml`
  comment is updated to reflect that the format-compat work landed,
  but the assignment itself is left for the operator to re-enable
  after the next dogfood run confirms Codex's output now parses on
  first try.
- The four reviewer agents (Codex, gpt-5-5, Opus, Sonnet) all
  produce parseable verdicts on first try for the four reviewer
  output shapes captured on 2026-04-30. Test fixtures lock this in.
- The `operator-ship` endpoint (added during P19 recovery) is no
  longer the primary recovery path for malformed verdicts. It stays
  as a backstop for cases where every reviewer fails the strict
  parser (e.g., cost cap kills the reviewer mid-output).
