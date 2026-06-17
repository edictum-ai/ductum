# P0 — Design Contradiction Review

## Executor

Claude or another reviewer. Do not implement.

## Scope

Review `specs/current/operational-model-redesign/README.md` after the final
amendments.

Focus on:

- Project, Repository, and Component boundaries.
- Workflow authority and lifecycle language.
- legacy `ductum.yaml` migration.
- legacy Run to Attempt presentation.
- public naming cutover.
- whether the first successful loop is actually simpler.

## Decision Trace

- `specs/current/operational-model-redesign/README.md`
- `specs/CURRENT.md`
- D53 factory resource model.
- D119 dashboard is an operator inbox.
- D135 agent-first control plane contract.
- D147-D158 bootstrap redesign decisions.

## Behavior Contract

This is a review gate. P1-P9 remain pending until P0 finds no blocking
contradictions or the README and P-stage prompts are patched to resolve them.

## Non-Goals

- No code changes.
- No implementation prompt rewrite unless a blocking contradiction is found.
- No new product scope.

## Output

Return findings ordered by severity.

Each finding should include:

- section reference;
- current-code evidence if relevant;
- why it blocks or risks implementation;
- minimal design correction.

## Drift Handling

If the review finds a design contradiction that changes scope, do not rewrite
the implementation split silently. Name the contradiction and the smallest
spec/prompt patch needed.

## Slop Review

Attack:

- anything that makes `ductum.yaml` authoritative again;
- hidden migration loss;
- old public words leaking back into normal UI/CLI/API;
- pretending legacy Runs have snapshots they never captured;
- cross-host coordination claims without a coordination substrate.

## Acceptance

P0 is accepted when either:

- no blocking contradictions remain; or
- blocking contradictions are listed clearly enough for the spec to be patched
  before P1.
