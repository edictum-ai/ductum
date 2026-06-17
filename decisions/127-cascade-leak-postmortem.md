---
date: 2026-05-02
status: accepted
deciders: operator (Arnold Cartagena)
related: 109, 124, 126
---

# Decision 127: Bakeoff cascade-leak postmortem and prevention

## Context

The 2026-05-01 `agent-validator-bakeoff` ran 5 candidate
implementations of `ductum agent test` against the live factory.
Each candidate impl actually executed `ductum agent test --all`-style
dispatches as part of its own self-test, which created a hidden
`agent-smoketest` spec (id `6K0TPiPLNObU`) with **21 transient tasks**
on the live factory. That spec was never authored as a real spec —
it leaked out of candidate code running its own validator against
production state.

Three of those leaked tasks failed; eighteen "completed" but two of
those were still sitting in `awaiting_approval` on 2026-05-02:

- `zbrzjjaveNBX` — agent-test-opus-4-6, awaiting_approval since
  2026-05-01T17:20:40Z. Diff: a 1-line `agent-test-opus-4-6.txt`.
  Closed as cascade-leak noise on 2026-05-02.
- `P40EYEanW_Ph` — agent-test-sonnet, awaiting_approval since
  2026-05-01T17:26:11Z. Diff: a 2-character whitespace shuffle in
  `post-completion.test.ts` files. Closed as cascade-leak noise on
  2026-05-02.

## Root cause

Candidate `ductum agent test` implementations spawned **real Ductum
dispatches** against the live factory. There was no isolation:

- the validator wrote against the production `ductum.db`,
- it created production specs and tasks,
- it consumed production dispatcher slots,
- its runs were indistinguishable from real work in the queue.

So a tournament that was supposed to evaluate validator quality
ended up running 5 × N self-tests against live state, leaving 21
zombie tasks and 2 zombie approvals after the winner merged.

## Decision

- The `agent-smoketest` spec is closed as **failed**. It was never a
  real spec — it was the byproduct of unsafe validator
  implementations.
- The 2 leaked approvals are closed via `run-close --reason
  "agent-smoketest cascade leak; closed during 2026-05-02 cleanup"`.
- Future validators (any code that spawns dispatches as part of its
  own self-test) **must** run in a sandboxed factory or behind a
  `--dry-run` flag. This is a follow-up to D124 (`ductum agent test`
  validator scope) and binds the next iteration of the validator to:
  - either accept a `DUCTUM_DB` / `DUCTUM_API` override pointing at
    a temporary factory the test owns and tears down,
  - or accept a `--dry-run` flag that exercises the spawn/harness
    plumbing without creating Spec/Task/Run rows.

## Why

A factory whose validators tag the production ledger with garbage
loses the meaning of its ledger. We caught this one because the
queue surfaced the orphaned approvals; the next leak might not be
that loud.

## Prevention checklist for the next bakeoff

- [ ] Validator-class code must accept a sandbox factory or dry-run
      mode before being added to the bakeoff pool.
- [ ] Any spec that creates rows in the live DB during candidate
      evaluation is a bakeoff foul; the candidate is disqualified
      regardless of code quality.
- [ ] Bakeoff prompts must explicitly forbid candidate-side
      production dispatches in the contract section.

## Non-goals

- No new sandbox primitive in this decision. D056 already declares
  sandboxing as a first-class resource; that is the right home for
  the validator-sandbox plumbing when it lands.
- No retroactive cleanup of the 21 leaked tasks beyond closing the
  spec as failed. Their rows stay in the ledger as evidence.
