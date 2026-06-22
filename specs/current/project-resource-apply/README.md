# Project Resource Apply

## Intake

`ductum resource apply` can now apply config resources, `Target`, and `Agent`
documents, but a manifest still cannot create the `Project` that target
documents reference. That leaves factory bootstrap split across commands.

This slice adds `Project` documents to unified resource apply using the existing
Project API and storage.

## Grill Questions

- Should `Project` move into `ConfigResource`? No. It remains the existing
  Project primitive and table.
- Should this add `Factory`, `Spec`, or `Task` manifests? No. This slice only
  closes the Project bootstrap gap.
- Should apply become transactional? No. It remains sequential and
  non-transactional per decision `098`/`099`.
- Should the CLI validate runtime refs? No. Runtime authority stays in API and
  dispatcher paths.
- What should `Project.spec` contain? Existing API fields: `repos` and
  `config`.

## Decisions

- Add decision `099` for Project documents in unified resource apply.
- Parse `kind: Project` with `metadata.name` and object `spec`.
- Map `spec.repos` and `spec.config` to the existing Project API.
- Create missing Projects and update existing Projects by name.
- Preserve all existing Project commands and APIs.
- Preserve storage boundaries and sequential loud-failure semantics.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `066`, `074`, `098`, and
  `099`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, transaction coordinator, rollback system, second policy system,
  Factory manifest, Spec/Task manifest, or Project migration into
  `ConfigResource`.
- Allowed scope: CLI resource apply parsing/routing, CLI Project API client
  update support, focused tests, spec records, and evidence.
- Verification: `ductum spec contract-check ductum specs/current/project-resource-apply --path`,
  `ductum spec drift-review ductum project-resource-apply`, package tests,
  build, diff check, and adversarial slop review.
- Drift handling: record a decision before adding Factory/Spec/Task manifests,
  transactions, rollback, a generic object store, new storage, dependency, or
  policy behavior.

## Behavior Contract

- `ductum resource apply` must preserve existing Project API create behavior
  when a `Project` document is missing from storage.
- Project create evidence must be visible through the exact API payload for
  `name`, `repos`, and `config`.
- `ductum resource apply` must preserve existing Project API update behavior
  when a `Project` with the same name already exists.
- Project update evidence must prove no duplicate Project is created.
- `Project` documents must reject missing `metadata.name` before any API write.
- `Project` documents must reject missing or non-object `spec` before any API
  write.
- `Project.spec.repos`, when present, must reject non-array and non-string
  entries before any API write.
- `Project.spec.config`, when present, must reject non-object config before any
  API write.
- A malformed `Project` document in a mixed manifest must fail loudly before
  any API write.
- A `Project` document with malformed `repos` or `config` must reject before
  any earlier valid document is written.
- A `Target` document later in the same manifest must resolve a `Project`
  document applied earlier in file order.
- Project API failures must be operator-visible and must not be swallowed.
- A Project API failure after earlier successful writes must remain loud and
  must not pretend the full manifest applied.
- Text output must visibly identify applied `Project` documents.
- JSON output must visibly identify applied `Project` documents.
- Legacy config-resource-only apply must preserve existing behavior.
- Legacy `project create`, `project list`, `project show`, and `project delete`
  must preserve existing behavior.
- Existing config-resource, Target, Agent, and Project commands must preserve
  their existing behavior.
- The implementation must preserve storage boundaries and must not move Project
  rows into ConfigResource.
- Tests must prove behavior through API payloads and loud failures, not only
  parser shape.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did Project documents route through the existing Project API?
- Did mixed malformed Project documents fail before partial writes?
- Did Target-after-Project work without a fake cache or new storage layer?
- Did any path silently swallow Project API failures?
- Did it preserve existing Project commands?
- Did it add Factory/Spec/Task scope or a generic object store?
- Did it preserve the sequential non-transactional decision?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-PROJECT-RESOURCE-APPLY.md](P1-PROJECT-RESOURCE-APPLY.md) | cli | Project documents in unified resource apply | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `izWQprt4cNcO`.
- Task imported into Ductum: `CGQPZo7uaVgr`.
- Run opened in Ductum: `vg0HBnBrLA5v`.
- Decision recorded in Ductum: `hh9jyj2aMG36`.
- Verification evidence recorded: `GzkfK2lcGV3u`.
- Final slop review evidence recorded: `oSmWUxNKRcmH` (PASS).
- Supersession evidence recorded: `wooMrpNSsc5e`; the duplicate dogfood agent
  session was closed after local verification and the imported task was marked
  done.

## Verification

```sh
ductum spec contract-check ductum specs/current/project-resource-apply --path
ductum spec drift-review ductum project-resource-apply
pnpm --filter @ductum/cli test
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
git diff --check
```
