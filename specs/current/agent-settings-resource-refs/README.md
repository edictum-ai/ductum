# Agent Settings Resource Refs

## Intake

Make the structured settings editor respect resource-backed Agent composition
refs now that runtime dispatch resolves them. Operators should be able to edit
capabilities or effort for an agent that uses `modelRef`, `harnessRef`,
`workflowProfileRef`, or `sandboxRef` without the editor showing false
model/harness errors or rewriting the agent toward legacy direct fields.

## Grill Questions

- Is this a runtime migration? No. Runtime validation already lives in core/API.
  This slice fixes the settings surface so it stops fighting the runtime model.
- Should the dashboard become a resource marketplace? No. It should expose text
  ref fields and preserve YAML. Selection UIs can wait until the resource catalog
  is richer.
- Where should invalid refs fail? Server validation remains authoritative and
  operator-visible through the existing settings save/validate error path.
- What happens to legacy agents? Direct `model` and `harness` editing remains
  unchanged when refs are absent.

## Decisions

- Add decision `085` for Agent settings resource ref behavior.
- Keep the existing settings YAML document as the edited source.
- Add structured Agent ref fields rather than a new Agent primitive.
- Preserve top-level ref fields through YAML patching and dashboard state.
- Keep API validation as the runtime authority for missing/wrong-kind/cross-
  project/malformed refs.
- Keep `systemPromptRef`, `toolsRef`, and `policyRef` as stored Agent metadata
  in this slice; they are visible/editable but not runtime-resolved yet.

## Decision Trace

- Decisions: `053`, `057`, `058`, `059`, `060`, `064`, `065`, `066`, `067`,
  `080`, `081`, `082`, `083`, `084`, `085`.
- Non-goals: no new Agent table; no resource marketplace; no second policy
  system; no Edictum change; no broad dashboard polish; no new dependency.
- Allowed scope: dashboard settings types, Agent settings editor, YAML patch
  support for Agent refs, targeted API/dashboard tests, dogfood records, and
  review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/agent-settings-resource-refs --path`,
  `ductum spec drift-review ductum agent-settings-resource-refs`, package
  tests, build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding a new table, new Agent
  primitive, marketplace UI, dependency, or policy behavior.

## Behavior Contract

- An Agent settings YAML config with `agents.<name>.modelRef` must preserve that
  resource ref during structured edits and must not add a direct `model` field.
- An Agent settings YAML config with `agents.<name>.harnessRef` must preserve
  that resource ref during structured edits and must not add a direct `harness`
  field.
- Structured Agent edits to capabilities, effort, cost tier, pricing, or spawn
  config must preserve `modelRef`, `harnessRef`, `workflowProfileRef`,
  `sandboxRef`, `systemPromptRef`, `toolsRef`, and `policyRef`.
- A resource-backed Agent config must not render an invalid model/harness
  mismatch solely because direct `model` or `harness` fields are absent.
- A legacy Agent config without refs must preserve the current model picker,
  harness picker, effort picker, and YAML patch behavior.
- A settings Agent that uses `modelRef` must include either direct `harness` or
  `harnessRef`; settings sync must not invent an implicit harness for a
  resource-backed model.
- YAML patching must preserve comments while updating top-level Agent ref
  fields without full document rewrites for common structured edits.
- A bad Agent ref must fail through existing server validation and must not be
  swallowed by the dashboard UI.
- A missing Agent `modelRef`, `harnessRef`, `workflowProfileRef`, or
  `sandboxRef` must fail visibly on settings validate/save through the existing
  API error path.
- `systemPromptRef`, `toolsRef`, and `policyRef` must be preserved as metadata
  without pretending they are runtime-validated in this slice.
- A malformed referenced config resource must fail visibly on settings
  validate/save through the existing API error path.
- A UI save error for bad Agent refs must leave the persisted settings YAML
  config unchanged.
- Dashboard tests must prove saved YAML output preserves refs and comments, not
  only rendered control shape.
- API tests must prove visible failure behavior and unchanged persisted config,
  not only response schema.
- The implementation must not add a new Agent primitive, table, marketplace UI,
  second policy system, or dependency.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did structured edits preserve refs instead of synthesizing direct legacy
  fields?
- Did resource-backed agents stop rendering as false model/harness mismatches?
- Did legacy direct model/harness editing still behave the same?
- Did `modelRef` settings require an explicit harness source instead of
  defaulting silently?
- Did YAML patching preserve comments for ref-backed agents?
- Did server validation remain the loud failure path for bad refs?
- Did the implementation avoid resource marketplace/provider branches?
- Did it avoid policy behavior inside the dashboard?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-AGENT-SETTINGS-RESOURCE-REFS.md](P1-AGENT-SETTINGS-RESOURCE-REFS.md) | dashboard/api | Agent settings resource refs, YAML patching, behavior tests, dogfood | [x] | - |

## Dogfood Record

- Imported as Ductum spec `L-tohrBlMlti`.
- Imported task `P1-AGENT-SETTINGS-RESOURCE-REFS` as `URAXRMMgrvbJ`.
- Accepted implementation run `ae3AagC1yFZ1`.
- Recorded Ductum decision `BG-I8pT_fm6M` for decision `085`.
- Recorded spec audit evidence `byFS-icb7UzD`.
- Recorded verification evidence `-jcONes50cZD`.
- Recorded Claude review evidence `VJ7C93DiE9fK`.
- Claude adversarial slop review returned `PASS` after fixes for YAML
  separator handling, explicit harness validation for `modelRef`, and
  runtime-active versus metadata ref wording.

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-settings-resource-refs --path
ductum spec drift-review ductum agent-settings-resource-refs
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
```

Status: verified locally. Core, API, CLI, dashboard, build, spec audits, and
Claude review passed for this slice.
