# Harness Resource Runtime

## Intake

Make `Harness` resources the declarative runtime source for agents that set
`resourceRefs.harnessRef`, while preserving legacy harness behavior for agents
without a harness ref.

## Grill Questions

- What selects the runtime adapter? `Harness.spec.type` selects the existing
  dispatcher adapter. This slice does not add a marketplace or plugin loader.
- When do bad refs fail? Missing, wrong-kind, cross-project, unsupported, and
  malformed harness resources fail before run/session creation.
- What counts as malformed? `spec.type` must be a non-empty string; optional
  `command` and `controlMode` must be strings; optional
  `supportedSandboxes` must be an array of strings.
- Where is audit visibility recorded? Existing run state records
  `runtimeHarness`, and existing run evidence records the resolved Harness
  resource snapshot before adapter spawn.
- Does this change policy? No. Edictum remains the policy system;
  `authorize_tool` remains harness-internal and `gate_check` remains
  agent-visible.

## Decisions

- Use existing config-resource lookup rules for `harnessRef`: id first, then
  project-scoped name, then factory-scoped name.
- Treat `Harness.spec.type` as the only active runtime selector in this slice.
- Validate optional Harness runtime metadata in core, because direct repo rows
  can bypass API/settings normalization.
- Record resolved Harness resource metadata as existing run evidence before
  session creation instead of adding a run column or table.
- Preserve legacy dispatch exactly when `harnessRef` is absent.

## Decision Trace

- Decisions: `053`, `054`, `057`, `058`, `059`, `060`, `064`, `065`, `066`,
  `067`, `068`, `069`, `070`, `073`, `076`, `080`.
- Non-goals: no Operation or WorkOrder table; no new top-level primitive/table;
  no second policy system; no Edictum policy change; no harness marketplace;
  no generic provider plugin system; no fake future provider branches; no
  adapter rewrite; no new dependency; no real sandbox driver.
- Allowed scope: Harness ref runtime validation, adapter selection through
  existing `spec.type`, run evidence audit snapshot, CLI/API/operator-visible
  failures through existing dispatch surfaces, MCP boundary evidence, and
  behavioral tests.
- Verification: `ductum spec contract-check ductum specs/current/harness-resource-runtime --path`,
  `ductum spec drift-review ductum harness-resource-runtime`, package tests,
  build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding a plugin marketplace, a
  second policy path, a new primitive/table, a new dependency, adapter rewrites,
  or Edictum enforcement changes.

## Behavior Contract

- An agent with a valid `harnessRef` must dispatch through the referenced
  Harness resource.
- A missing referenced Harness resource must fail loudly before session
  creation.
- A wrong-kind referenced resource must fail loudly.
- A cross-project referenced resource must fail loudly.
- A malformed Harness resource must fail loudly with operator-visible output.
- A bad configured `harnessRef` must never silently fall back to legacy harness
  config.
- Agents without `harnessRef` must preserve existing legacy dispatch behavior.
- Dispatcher must remain the sole creator of session-to-run mappings.
- `authorize_tool` must remain harness-internal and must not appear in MCP tool
  signatures.
- `gate_check` must remain the agent-visible policy check path.
- Resolved harness metadata must be visible in run state or audit output.
- Tests must prove behavior, not only schema shape.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are failure modes loud before session creation?
- Did any path silently fall back after a configured bad harness ref?
- Did the implementation duplicate existing harness resolution/routing logic?
- Did it blur `authorize_tool` and `gate_check`?
- Did it add fake abstraction with only one caller and no boundary?
- Did it add dead provider/config branches for future features?
- Did it preserve legacy behavior for agents without `harnessRef`?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-HARNESS-RESOURCE-RUNTIME.md](P1-HARNESS-RESOURCE-RUNTIME.md) | core/api/cli | Harness resource runtime validation, adapter selection, audit evidence, tests, dogfood | [x] | - |

## Dogfood Record

- Imported Ductum spec: `harness-resource-runtime` (`8t6g5eFXbfJF`)
- Imported P1 task: `P1-HARNESS-RESOURCE-RUNTIME` (`wzfiepuzwA0_`)
- Accepted run: `a8Bg5AECvNln`
- Recorded decisions: `JZBqF0E82W-8`, `RxJ_jP5MiOWa`
- Spec audit evidence: `UWd3tOC9mqMH`
- Final verification evidence: `SXGiCrayumPl`
- Claude slop review evidence: `sK7EcZomznJN`

## Verification

```sh
ductum spec contract-check ductum specs/current/harness-resource-runtime --path
ductum spec drift-review ductum harness-resource-runtime
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
