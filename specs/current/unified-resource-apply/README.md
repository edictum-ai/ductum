# Unified Resource Apply

## Intake

Ductum has declarative resources, targets, and agent manifests, but operators
must currently split one factory graph across `resource apply`, `target apply`,
and `agent apply`. That is awkward for dogfood factory bootstrapping and makes
the declarative resource model feel half-connected.

This slice makes `ductum resource apply` accept mixed manifests for config
resources, `Target`, and `Agent` documents while preserving the existing
specialized commands.

## Grill Questions

- Should `Agent` and `Target` move into the config-resource table? No. They use
  existing Agent and Target APIs.
- Should this add a generic object store? No. It is a CLI dispatch path over
  existing resource APIs.
- Should `resource apply` validate runtime refs itself? No. Agent/API/runtime
  validation remains authoritative.
- Should apply be transactional across document kinds? No. This slice preserves
  current sequential apply behavior, validates all document shapes before the
  first API write, and surfaces later API failures without rollback.
- Should existing `agent apply` or `target apply` be removed? No. They remain
  compatibility paths.

## Decisions

- Add decision `098` for unified resource apply.
- Teach `ductum resource apply` to parse mixed manifests with config resources,
  `Target`, and `Agent`.
- Reuse existing Agent manifest shaping and Target manifest shaping.
- Preserve config-resource create/update behavior.
- Reject unknown kinds and malformed documents before API writes.
- Keep apply sequential and non-transactional across existing APIs.
- Keep all runtime/resource authority in existing API and dispatcher paths.

## Decision Trace

- Decisions: `053`, `054`, `056`, `057`, `058`, `059`, `060`, `064`, `066`,
  `067`, `074`, `085`, `086`, `087`, `096`, `097`, and `098`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, marketplace, plugin abstraction, second policy system, runtime
  behavior change, or migration of Agent/Target into `ConfigResource`.
- Allowed scope: CLI resource apply parsing/routing, shared manifest helpers,
  focused tests, spec records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/unified-resource-apply --path`,
  `ductum spec drift-review ductum unified-resource-apply`, CLI tests,
  core/API smoke regressions, build, diff check, and adversarial slop review.
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-UNIFIED-RESOURCE-APPLY.md](P1-UNIFIED-RESOURCE-APPLY.md) | cli | Mixed resource apply routing and tests | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `_h8oPP7ntoCa`.
- Task imported into Ductum: `yd-pIKYiTF0a`.
- Run opened in Ductum: `efLLunEvSnIR`.
- Decision recorded in Ductum: `hJBTvfZf8SmN`; follow-up sequential
  non-transactional decision `6EZqUFWk3gsy`.
- Evidence recorded: verification `JcfS8hu7YXe4`, final verification
  `kzCqh5UIhWpp`, final review `6kI4o2PaAKGc`.
- Final slop review: PASS.

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
