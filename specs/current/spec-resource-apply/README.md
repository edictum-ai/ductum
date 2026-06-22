# Spec Resource Apply

## Intake

`ductum resource apply` can now create Projects, Targets, Agents, and config
resources, but work declaration still lives behind the separate
`ductum spec import` command. That keeps a complete factory bootstrap manifest
split across two entry points.

This slice adds `Spec` documents to unified resource apply by reusing the
existing spec import semantics for task fan-out, target refs, dependencies,
agent assignment, and DAG evaluation.

## Grill Questions

- Should this add standalone `Task` documents? No. A Spec owns its task graph in
  this slice.
- Should this add Factory manifests? No. Factory setup remains explicit.
- Should this update existing Specs with tasks? No. Preserve current import
  behavior: fail loudly rather than duplicate or mutate an existing task graph.
- Should this become transactional? No. It remains sequential and
  non-transactional per decisions `098`, `099`, and `100`.
- Should this duplicate spec import parsing? No. Reuse existing import semantics
  or extract a shared helper.

## Decisions

- Add decision `100` for `Spec` documents in unified resource apply.
- Add decision `101` for shared Spec import validation and partial apply
  visibility.
- Parse `kind: Spec` with `metadata.name`, `metadata.project`, and object
  `spec`.
- Reuse existing YAML spec import task semantics for `spec.tasks` and
  `spec.fanOut`.
- Preserve the legacy `ductum spec import` default of `approved` when
  `spec.status` is omitted.
- Create missing Specs and Tasks through existing APIs.
- Preserve existing import refusal when a Spec already has Tasks.
- Preserve storage and policy boundaries.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `066`, `074`, `098`, `099`,
  `100`, and `101`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, transaction coordinator, rollback system, second policy system,
  Factory manifest, standalone Task manifest, Spec/Task migration into
  `ConfigResource`, or task reconciliation behavior.
- Allowed scope: CLI resource apply parsing/routing, shared spec-import helper
  extraction if needed, focused tests, spec records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/spec-resource-apply --path`,
  `ductum spec drift-review ductum spec-resource-apply`, package tests, build,
  diff check, and adversarial slop review.
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-SPEC-RESOURCE-APPLY.md](P1-SPEC-RESOURCE-APPLY.md) | cli | Spec documents in unified resource apply | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `VdjyEfjrWo7V`.
- Task imported into Ductum: `t8p_tXOx2BND`.
- Run opened in Ductum: `8QZ9iKNhbjT9`.
- Decision recorded in Ductum: `R5TpqETX_Dgp`.
- Shared import helper decision recorded in Ductum: `6k0g63GK3MDR`.
- Validation and visibility decision recorded in Ductum: `Hn3godvsfhTC`.
- Verification evidence recorded in Ductum: `Vq1HPU21nb0y`.
- Final slop review evidence recorded in Ductum: `tX-pjYs_F6sM`.
- Final slop review: PASS.

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
