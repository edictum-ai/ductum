---
date: 2026-05-02
status: closed
deciders: operator (Arnold Cartagena)
related: 109, 124
---

# Decision 126: agent-validator-bakeoff shipped — winner merged, spec closed

## Context

The `agent-validator-bakeoff` spec (id `Oe1-re3BXRNT`) ran a 5-agent
bakeoff for the `ductum agent test` validator on 2026-05-01. The five
candidate impls (sonnet, opus, opus-4-6, codex, gpt-5-5) each wrote
their own version of the validator; the winning candidate was merged
to main as `abab92e`:

```
abab92e Merge ductum/candidate-opus-GVjqQa (bakeoff winner: ductum agent test validator)
```

The validator landed alongside D124 (`ductum agent test` validator
scope and `--all` parallelism). All 17 tasks in the bakeoff spec
served their purpose — the winner shipped, the losers are evidence.

## Decision

- Mark the `agent-validator-bakeoff` spec **done**. The winner is on
  main, the validator behavior is captured in D124, and the
  evidence-grade prompt has been moved to
  `specs/current/agent-validator-bakeoff/evidence/PROMPT.md` for the
  audit trail.
- Do not retroactively dispatch or mark the losing candidates'
  individual tasks. They are recorded in the spec history; their
  branches were superseded by the merge of the winner.

## Why

The bakeoff was a tournament, not a fan-out. Closing the spec as
**done** is honest — its goal (pick the best validator and ship it)
was met. Closing it as `failed` because most candidates didn't merge
would misread the format. The cascade-leak that the bakeoff exposed
(real Ductum dispatches against the live factory from each candidate
impl) is captured separately in D127.

## Non-goals

- No re-running of losing candidates. Their evidence sits in the
  recorded runs.
- No new bakeoff format proposal here. D127 names the prevention work
  needed before the next bakeoff is safe.
