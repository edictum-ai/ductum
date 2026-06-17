# P1 - Agent Settings Resource Refs

## Scope

Update the structured dashboard settings flow so Agent composition refs are
visible, editable, and preserved without converting resource-backed agents back
to direct legacy `model` and `harness` fields.

## Decision Trace

- Decisions: `053`, `057`, `058`, `059`, `060`, `064`, `065`, `066`, `067`,
  `080`, `081`, `082`, `083`, `084`, `085`.
- Non-goals: no new Agent table; no resource marketplace; no second policy
  system; no Edictum change; no broad dashboard polish; no new dependency.
- Allowed scope: dashboard settings types, Agent settings editor, YAML patch
  support for Agent refs, targeted API/dashboard tests, and existing
  operator-visible validation surfaces.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding a new table, new
  Agent primitive, marketplace UI, dependency, or policy behavior.

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

## Implementation Notes

- Extend dashboard settings types with Agent ref fields and resource sections
  only as needed for typed editing.
- Add compact advanced ref controls to `AgentConfigPanel`.
- When refs are present, avoid direct model/harness mismatch logic and avoid
  writing direct `model`/`harness`.
- Extend `yamlPatch` supported Agent paths for top-level ref fields and nested
  `resourceRefs` where needed.
- Keep API validation scoped to settings ref behavior: bad refs remain loud
  through settings save/validate, and `modelRef` settings require an explicit
  harness source.

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

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-settings-resource-refs --path
ductum spec drift-review ductum agent-settings-resource-refs
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm build
git diff --check
```
