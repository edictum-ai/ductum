# P1 - Unified Resource Apply

Make `ductum resource apply` accept mixed manifests for config resources,
`Target`, and `Agent`.

## Decision Trace

- Decisions: `053`, `054`, `056`, `057`, `058`, `059`, `060`, `064`, `066`,
  `067`, `074`, `085`, `086`, `087`, `096`, `097`, and `098`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, marketplace, plugin abstraction, second policy system, runtime
  behavior change, or migration of Agent/Target into `ConfigResource`.
- Allowed scope: CLI resource apply parsing/routing, shared manifest helpers,
  focused tests, spec records, and evidence.
- Drift handling: record a new decision before adding transactions, a generic
  object store, new resource kinds, new tables, runtime ref validation in the
  CLI, or migration of Agent/Target storage.

## Behavior Contract

- `ductum resource apply` must preserve existing config-resource create/update
  behavior for Model, Harness, WorkflowProfile, SandboxProfile, and
  NotificationChannel documents.
- `ductum resource apply` must preserve Target runtime ownership by creating
  `Target` documents through the existing Target API.
- `ductum resource apply` must preserve Target identity by updating an existing
  `Target` by project/name instead of creating a duplicate.
- `ductum resource apply` must preserve Agent runtime ownership by creating
  `Agent` documents through the existing Agent API.
- `ductum resource apply` must preserve Agent identity by updating an existing
  `Agent` by name instead of creating a duplicate.
- `Agent` documents applied through `resource apply` must reject direct/ref
  conflicts with the same loud behavior as `agent apply`.
- `Target` documents applied through `resource apply` must fail loudly when
  `metadata.project` is missing, matching `target apply`.
- Unknown document kinds must fail loudly before any API write.
- Malformed mixed manifests must fail loudly before any API write.
- A mixed manifest must not silently skip a supported document kind.
- The result output must visibly include every applied document kind.
- The implementation must preserve storage boundaries and must not move Agent or
  Target rows into ConfigResource.
- The implementation must not silently replace API/dispatcher runtime authority
  by adding resource ref validation to the CLI.
- The implementation must not add a dependency, table, primitive, generic object
  store, marketplace, plugin abstraction, or second policy system.
- Tests must preserve behavioral evidence through API payloads and loud
  failures, not only parser shape.

## Implementation Notes

- Preserve `resource list` and `resource get` behavior for config resources.
- Keep `agent apply` and `target apply` working.
- Reuse `agentInputFromManifest` for Agent payload shaping.
- Extract or export Target manifest shaping instead of duplicating it.
- Parse all documents before applying so unknown or malformed kinds do not
  partially write earlier documents.
- Apply documents in file order after parse succeeds.
- Preserve sequential, non-transactional API behavior; later API failures must
  be loud and rerunnable, not silently swallowed or rolled back by new storage.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are tests behavioral, not just shape checks?
- Did mixed manifests route to the existing Agent, Target, and ConfigResource
  APIs?
- Did unknown or malformed documents fail before partial writes?
- Did the implementation duplicate Agent ref parsing or Target parsing instead
  of reusing existing manifest shaping?
- Did it create a fake generic object store or dead provider branch?
- Did it move runtime/resource validation into the CLI?
- Did it preserve existing specialized apply commands?

## Verification

```sh
ductum spec contract-check ductum specs/current/unified-resource-apply --path
ductum spec drift-review ductum unified-resource-apply
pnpm --filter @ductum/cli test
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
git diff --check
```
