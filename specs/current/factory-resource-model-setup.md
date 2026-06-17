# Next Session Prompt: Factory Resource Model Setup

Paste this into a fresh Ductum session.

```text
You are continuing Ductum in /Users/acartagena/project/ductum.

First read AGENTS.md and obey it strictly.

Goal:
Start implementing Ductum's declarative factory resource model. Do not build more
placeholder UI. Ground the work in the current codebase and preserve user changes.
Dogfood Ductum's own design-to-spec loop while doing it: capture the reasoning,
decisions, spec artifacts, prompts, tasks, and implementation runs inside Ductum
instead of leaving them only in chat.

Current architecture source:
- decisions/053-factory-resource-model.md
- decisions/054-harness-plugin-model.md
- decisions/055-notification-backends.md
- decisions/056-sandbox-resource-model.md
- decisions/057-reference-runtime-systems.md
- decisions/058-minimal-scope-and-reference-non-goals.md
- decisions/059-design-to-spec-pipeline.md
- decisions/060-decision-drift.md
- specs/CURRENT.md

Reference workflows to inspect:
- /Users/acartagena/project/edictum/.claude/skills/spec-to-impl/SKILL.md
- https://raw.githubusercontent.com/mattpocock/skills/main/grill-me/SKILL.md

Use them as workflow references, not dependencies. The Ductum version should use
Ductum primitives and no new dependency unless absolutely forced.

Important direction:
- Ductum coordinates work.
- Edictum bounds agency.
- Add Target as the missing config primitive.
- Treat multi-repo operations as fan-out Specs that emit target-scoped Tasks.
- Treat Agent as model + harness + system prompt + tools + sandbox + policy.
- Make sandboxing first-class with SandboxProfile.
- Make Telegram one NotificationChannel backend, not a special global feature.
- Make harnesses pluggable, with Pi as the preferred future default once proven.
- Keep dependencies minimal. Prefer no new dependencies.
- Edictum is the policy engine; do not grow a second policy engine in Ductum.
- Planning is a workflow too: rough idea -> grill questions -> decisions ->
  audited spec -> implementation prompts -> tasks.
- Catch decision drift. Every generated prompt and review needs a decision trace
  and an explicit "why" for any drift.
- This next pass must produce something Ductum can actually use on itself.

Start by:
1. Run git status -sb.
2. Inspect current Project, Agent, Spec, Task, Run config/types/repos/routes/UI.
3. Create a Ductum spec artifact for this work, using the design-to-spec flow:
   - intake: summarize the resource-model goal
   - grill: list the blocking design questions and recommended answers
   - decide: record the answers as decisions or references to decisions 053-059
   - audit: list risks against AGENTS.md, SECURITY.md, and current code shape
   - compile: generate reviewable implementation prompts
   - drift: include a decision trace in every prompt and define how reviewers
     should catch unapproved drift
4. Import or represent those prompts as Ductum tasks if the current CLI/API can
   do it safely. If not, implement the smallest missing import/apply piece and
   then use it.
5. Before proposing schema, name the Ductum dogfood flow each new field supports.
6. Propose the smallest DB/config/API migration for Target, WorkflowProfile,
   Harness, Model, SandboxProfile, and NotificationChannel.
7. Implement Target first end to end:
   - types
   - repo/storage
   - config import/export
   - API route
   - CLI get/describe/apply if feasible
   - Settings/Project UI only if it is clearly tied to the resource model
8. Add tests for config parsing and API persistence.
9. Add a sample declarative file for the Edictum ecosystem targets.
10. Dogfood at least one generated prompt through Ductum as a real task/run.
    If the control plane blocks this, fix the blocker or record the exact
    missing capability as a task with evidence.

Expected artifacts:
- a spec artifact under specs/current/ or a project-specific specs directory
- recorded decisions/evidence for the design questions
- a decision-drift checklist and "why" format for any drift from decisions or
  non-goals
- implementation prompts generated from the spec
- imported or represented tasks
- at least one real Ductum run created from those tasks
- tests proving the implemented slice works

Do not:
- invent Operation/WorkOrder tables yet
- rip out existing harnesses yet
- hardcode Pi as the only harness yet
- delete old impl specs
- leak secrets
- build an OpenShell clone; use its public resource / private driver split as a
  design reference
- copy T3 Code wholesale; use its adapter registry/service split as a design
  reference
- add fields just because a reference system has them
- add new dependencies unless the dogfood flow cannot be solved cleanly with
  existing code
- build inference.local, full sandbox conditions/events, draft policy
  recommendations, provider marketplaces, settings change streams, or remote
  sandbox orchestration in this pass
- add a new top-level DesignSession table yet; model design workflows as Specs
  with decisions, approvals, evidence, artifacts, tasks, and runs
- leave this as docs only; the point is to implement and use the loop

Verification:
- targeted package tests for changed packages
- pnpm build
- run the Ductum CLI/API path used to import or create the dogfood tasks
- git diff --check

Commit real progress with conventional commits.
```
