# P1 - Project Resource Apply

Make `ductum resource apply` accept `Project` documents through the existing
Project API.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `066`, `074`, `098`, and
  `099`.
- Non-goals: no dependency, table, primitive, Operation, WorkOrder, generic
  object store, transaction coordinator, rollback system, second policy system,
  Factory manifest, Spec/Task manifest, or Project migration into
  `ConfigResource`.
- Allowed scope: CLI resource apply parsing/routing, CLI Project API client
  update support, focused tests, spec records, and evidence.
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

## Implementation Notes

- Add `updateProject` to the CLI API client/type/mocks by calling the existing
  `PUT /api/projects/:id` route.
- Parse all mixed documents before applying so malformed `Project` manifests do
  not partially write earlier documents.
- Keep apply order sequential after parse succeeds, so later Targets can use
  Projects created earlier.
- Reuse existing `Project` API payload shapes: `name`, `repos`, and `config`.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did Project documents route through the existing Project API?
- Did mixed malformed Project documents fail before partial writes?
- Did Target-after-Project work without a fake cache or new storage layer?
- Did any path silently swallow Project API failures?
- Did it preserve existing Project commands?
- Did it add Factory/Spec/Task scope or a generic object store?
- Did it preserve the sequential non-transactional decision?

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
