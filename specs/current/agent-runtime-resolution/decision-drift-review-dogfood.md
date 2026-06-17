# Decision Drift Review: agent-runtime-resolution

## Decision Trace

- Project: ductum
- Spec: agent-runtime-resolution (gfRgoI7ywqis)
- Active decisions:
  - FEiGPtUGJrtg: Resolve Agent modelRef and harnessRef at core runtime boundaries before run creation (Decision 067 records project-scoped id/name lookup, factory fallback, wrong-kind and cross-project rejection, and legacy fallback only when refs are absent.)
  - Y4kMuqhqfxOa: Define Agent runtime ref validation and snapshot scope (Decision 068 records that dispatcher ref resolution is authoritative per run; Agent.model and Agent.harness stay legacy/display snapshots when refs exist; Model resources can name uncataloged model IDs; global API/settings resolve factory-scoped refs while project-scoped Agent API bindings need a later decision.)
  - wT26epgWRGXX: Treat Harness resources as authoritative for harnessRef values (Decision 069 records that API/settings validate harnessRef shape and resource existence but do not reject resource-resolved Harness.spec.type through the static HARNESSES catalog. Dispatcher adapter availability remains the runtime check and fails before run/session creation with AgentRuntimeResolutionError.)
  - c-WM5eyt7xAN: Persist dispatch-time resolved model and harness on Run rows (Decision 070: runtime ref resolution must stay auditable after refs change, resources are deleted, or the process restarts. Dispatcher writes runtime_model/runtime_harness before spawn; cost uses that snapshot instead of legacy Agent fields for ref-backed runs.)
  - 3K7lEsh9nQYS: Reject direct model/harness inputs when matching refs are set (Decision 071: persisted Agent.model and Agent.harness remain snapshots, but API/settings input must not accept competing direct values alongside modelRef or harnessRef. Uncataloged Model resources require supportedEfforts before effort can be validated.)
  - swnsbmL10px-: Require supportedEfforts for effort on any Model resource (Decision 072: when modelRef is present, the Model resource is the authority. Agent effort validation must use Model.spec.supportedEfforts and must not fall back to the legacy static model catalog, even if spec.modelId is cataloged.)
  - ZBjO-mwYsN5J: Treat harness storage as strings, not a static catalog (Decision 073: resource-resolved Harness.spec.type values must not be rejected by SQLite CHECK constraints before dispatcher runtime validates adapter availability. agents.harness and session_run_mapping.harness store strings; legacy direct Agent.harness validation remains in API/settings.)
  - mgHvAIL-XO6H: Decision 074: keep global Agent API/settings ref validation factory-scoped (Factory-level Agent operations have no run project. Dispatcher resolves project-scoped modelRef/harnessRef when a task spec project is known. Project-bound Agent API validation needs a separate decision.)
  - Y8SpAwNH5_u7: Decision 075: keep runtime snapshots nullable for legacy rows and fail closed without snapshots (New dispatcher-created runs write runtime_model/runtime_harness. Pre-migration and hand-seeded legacy runs can have null snapshots, so ref-backed rows without a complete snapshot must not re-resolve current refs for cost.)
  - maYawmARxvW6: Decision 076: uncataloged harnessRef skips static model/harness matrix (Harness resources can name adapter types absent from the static API HARNESSES catalog. Direct legacy model values must still be catalog-known, but compatibility with uncataloged harnesses is governed by dispatcher adapter availability in this slice.)
- Non-goals: no second policy engine; no graph analyzer; no unrecorded scope expansion.
- Allowed scope: review prompt, checklist, warnings, and recorded decision/evidence rows.

## Decision Trace Audit

- Spec agent-runtime-resolution: ok
- P1-AGENT-RUNTIME-REFS (5a39wAIvl7iN): ok

## Contract Coverage Audit

### Spec Contract Coverage

Status: complete

Heuristic: this checks markdown coverage only; reviewers must still prove each behavior item with tests or evidence.

| Artifact | Decision Trace | Behavior Contract | Verification | Drift Handling | Slop Review |
|---|---|---|---|---|---|
| Spec agent-runtime-resolution | ok | ok | ok | ok | ok |
| Task P1-AGENT-RUNTIME-REFS (5a39wAIvl7iN) | ok | ok | ok | ok | ok |

## Slop Review

- Does the diff match the linked decisions?
- Did new scope appear?
- Did the implementation weaken a non-goal?
- Is verification still aligned with each decision's reason?
- If there is drift, is the why recorded as a decision, waiver, or amendment with evidence?
- Did the implementation satisfy every Behavior Contract item?
- Does every Behavior Contract item have a behavioral test or explicit evidence?
- Are missing or invalid inputs loud failures?
- Did any path swallow errors?
- Did it duplicate existing resolution or routing logic?
- Did it add an abstraction with only one caller and no boundary?
- Did it add dead config branches for future features?
- PASS is invalid unless every Behavior Contract item is addressed explicitly.

## Drift Record Format

```text
Drift:
- type:
- decision or non-goal:
- changed behavior:
- why:
- evidence:
- status: pending | approved | rejected | waived
```

## Diff Under Review

Paste or attach the implementation diff and test evidence here before review.
