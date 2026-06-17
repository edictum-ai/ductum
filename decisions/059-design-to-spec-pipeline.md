# 059 - Design To Spec Pipeline

## Status

Accepted

## Context

Ductum needs to capture the way software is actually designed:

- rough idea.
- adversarial questioning.
- exploration of the codebase.
- explicit decisions.
- revised spec.
- implementation prompts.
- tasks and runs.
- review, approval, merge, and audit trail.

Two reference skills capture parts of this:

- `grill-me`: interview the operator one question at a time until the design
  tree is resolved. If the codebase can answer a question, inspect code instead
  of asking.
- `spec-to-impl`: audit a spec against project rules, collect decisions for
  every violation, update the spec, generate sequenced implementation prompts,
  then final-review the prompt set.

Ductum should make that whole loop first-class without adding a pile of new
top-level concepts.

## Decision

Model design-to-implementation as a workflow over existing Ductum primitives:

- `Spec`: the design object being refined.
- `Decision`: append-only answer to a design, audit, policy, or scope question.
- `Approval`: a pending decision request when the operator must choose.
- `Evidence`: codebase findings, audits, references, source docs, or review
  output attached to the spec/run.
- `Task`: a reviewable implementation prompt derived from the spec.
- `Run`: the execution or review of a task by an agent.

Do not add a top-level `DesignSession` primitive yet. A design session is a spec
in a planning workflow.

## Workflow

The Ductum design workflow has these stages:

1. Intake
   - Capture the idea, linked docs, chat excerpts, source files, and goals.
   - Create or update a `Spec`.
2. Grill
   - Generate one question at a time.
   - Explore code first when the answer is discoverable.
   - For each unresolved branch, create a pending `Approval`/decision request
     with recommended answer and alternatives.
3. Decide
   - Operator answers pending questions.
   - Ductum records each answer as a `Decision` with rationale, alternatives,
     source references, and supersession links when needed.
4. Audit
   - Review the spec against project rules, AGENTS.md, architecture docs,
     current code, and security constraints.
   - Persist findings as `Evidence`.
   - Findings that require human judgment become pending decisions.
5. Revise Spec
   - Apply decisions into a new spec revision.
   - Keep prior revisions addressable for audit.
6. Compile Prompts
   - Generate implementation prompts as spec artifacts.
   - Each prompt must be one reviewable deliverable with required reading,
     dependency links, files to touch, and verification.
7. Final Review
   - Verify no prompt gaps, broken dependencies, vague verification, or
     unimplemented spec sections.
8. Import Tasks
   - Convert accepted prompts into Ductum tasks with dependencies, targets,
     agents, workflow profile, and verification rules.

## Edictum Boundary

Edictum remains the policy engine. Ductum uses Edictum gates to enforce the
design workflow:

- no compile before all blocking decisions are resolved.
- no task import before the spec audit is clean or explicitly waived.
- no implementation task without verification commands.
- no ship before review/CI/approval gates pass.

Ductum stores the state and coordinates the work. Edictum bounds what actions
are allowed at each stage.

## Minimal Implementation Direction

The first version can be file-backed plus indexed in SQLite:

- Store spec revisions and prompt artifacts under `specs/current/` or a
  project-specific specs directory.
- Store `Decision`, `Approval`, and `Evidence` rows in Ductum.
- Add CLI/UI actions later for:
  - start design workflow from a note or file.
  - answer next pending design question.
  - run spec audit.
  - compile implementation prompts.
  - import prompts as tasks.

No new dependencies are required for this. Markdown/YAML files plus existing
TypeScript parsing are enough for the first pass.

## Non-Goals

- Do not build a generic notebook.
- Do not build a full chat product.
- Do not add a new top-level `DesignSession` table yet.
- Do not make agent prompts the source of truth.
- Do not lose the decision trail when a spec is rewritten.

## Success Criteria

A future operator can answer:

- Why are we building this?
- What alternatives were considered?
- Who made each decision?
- Which code evidence supported the decision?
- Which spec revision introduced the change?
- Which implementation prompt came from that spec section?
- Which run implemented it?
- Which review approved it?
