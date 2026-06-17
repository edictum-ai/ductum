# P1 - Spec Resource Apply

Make `ductum resource apply` accept `Spec` documents through the existing spec
import behavior.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `066`, `074`, `098`, `099`,
  `100`, and `101`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, transaction coordinator, rollback system, second policy system,
  Factory manifest, standalone Task manifest, Spec/Task migration into
  `ConfigResource`, or task reconciliation behavior.
- Allowed scope: CLI resource apply parsing/routing, shared spec-import helper
  extraction if needed, focused tests, spec records, and evidence.
- Drift handling: record a decision before adding standalone Task manifests,
  transactions, rollback, a generic object store, new storage, dependency, or
  policy behavior.

## Behavior Contract

- `ductum resource apply` must preserve existing import behavior by accepting a
  valid `Spec` document and creating the Spec through the existing Spec API.
- Spec creation payload evidence must preserve `name`, `project`, `status`,
  `document`, and `maxFixIterations`.
- New Spec documents with no `spec.status` input must preserve the legacy spec
  import runtime default of `approved`.
- A valid `Spec` document must preserve existing import behavior by creating
  Tasks through the existing Task API.
- Task creation payload evidence must preserve task names, prompts, repos,
  verification commands, target IDs, assigned agent IDs, complexity,
  requiredRole, and status.
- A valid `Spec` document must preserve existing import behavior by wiring task
  dependencies through the existing Task dependency API.
- A valid `Spec` document must preserve DAG runtime behavior by evaluating the
  DAG after Tasks and dependencies are created.
- `Spec.spec.tasks` must preserve existing YAML spec import task fields:
  `name`, `target`, `prompt`, `repos`, `verification`, `depends_on`,
  `assignedAgent`, `complexity`, `requiredRole`, and `status`.
- `Spec.spec.fanOut` must preserve existing YAML spec import fan-out behavior.
- A Target applied earlier in the same resource manifest must resolve for a
  later Spec task target ref through the existing target lookup.
- Missing target refs must fail loudly before Task creation.
- Assigned agent names must resolve through the existing agent lookup and fail
  loudly when missing.
- Missing `metadata.project` must fail loudly before any API write.
- Missing `metadata.name` must fail loudly before any API write.
- Missing or non-object `spec` must fail loudly before any API write.
- Malformed task fields must fail loudly before any API write.
- Duplicate task names must fail loudly before any API write.
- Unknown task dependency names must fail loudly before any API write.
- Existing Spec task graphs must not be duplicated or mutated.
- Existing Spec task graphs must return a visible skipped/error state instead
  of claiming new task delivery.
- Existing empty Specs must preserve existing import behavior by being
  populated through the existing Task API.
- Existing empty Spec metadata update input (`status`, `document`, or
  `maxFixIterations`) must fail loudly instead of silently ignoring unsupported
  metadata updates.
- Spec API, Task API, target lookup, agent lookup, dependency, or DAG failures
  must fail loudly with operator-visible output and must not be swallowed.
- Resource apply partial progress must be operator-visible when a later document
  or later Spec task fails.
- Spec status, maxFixIterations, empty target refs, and empty assignedAgent refs
  must fail loudly when malformed.
- A Spec API failure after earlier successful resource writes must remain loud
  and must not pretend the full manifest applied.
- A Task API failure after Spec creation must remain loud and must not claim DAG
  evaluation succeeded.
- A dependency API failure must remain loud and must not claim import success.
- Spec DAG evaluation failure must remain loud and must not be logs-only.
- Text output must make applied `Spec` documents visible.
- JSON output must make applied `Spec` documents visible.
- Legacy `ductum spec import --json` output must remain parseable JSON for
  success and partial-failure progress.
- Legacy `ductum spec import` behavior must be preserved.
- Existing Project, Target, Agent, and config-resource apply behavior must be
  preserved.
- The implementation must not add standalone top-level Task documents.
- The implementation must not move Spec or Task rows into ConfigResource.
- Tests must prove behavior through API calls, payloads, dependencies, DAG
  evaluation, and loud failures, not only parser shape.

## Implementation Notes

- Prefer extracting a shared spec-apply helper from `executeSpecImport` over
  duplicating import logic in `resources.ts`.
- Keep document validation eager before the first API write.
- Keep apply order sequential after parse succeeds, so earlier Target documents
  are visible to later Spec target lookup through the API.
- Preserve the existing refusal for Specs that already contain Tasks.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did Spec documents route through existing Spec/Task APIs?
- Did it reuse spec import semantics instead of duplicating a second parser?
- Did mixed malformed Spec documents fail before partial writes?
- Did Target-before-Spec work without a fake cache or new storage layer?
- Did any path silently swallow Spec, Task, dependency, target, agent, or DAG
  failures?
- Did partial resource apply failures show prior applied rows and Spec import
  messages?
- Did it preserve existing spec import behavior?
- Did it add standalone Task documents, Factory manifests, or a generic object
  store?
- Did it preserve the sequential non-transactional decision?

## Verification

```sh
ductum spec contract-check ductum specs/current/spec-resource-apply --path
ductum spec drift-review ductum spec-resource-apply
pnpm --filter @ductum/cli test
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
git diff --check
```
