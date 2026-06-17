# P0 - Audit And Decision

You are working in `/Users/acartagena/project/ductum`.

## Goal

Confirm the duplicated contract problems and record the ownership plan before
editing implementation code.

## Required Work

Create:

```text
decisions/163-contract-consistency-hardening.md
```

Use the standard ADR shape:

```md
# ADR 0163: Contract Consistency Hardening
## Status
Accepted
## Decision
...
## Reason
...
## Consequences
...
```

The decision must identify ownership for:

- run UI DTOs
- run status presentation
- run cost display/unmeasured state
- model pricing/catalog/scanner data
- external API input parsers
- harness session/event contracts
- conformance tests

## Known Files To Inspect

- `packages/api/src/lib/ui-contract.ts`
- `packages/dashboard/src/api/client.ts`
- `packages/core/src/run-display.ts`
- `packages/dashboard/src/lib/derived-status.ts`
- `packages/dashboard/src/components/signal/helpers.ts`
- `packages/core/src/model-pricing.ts`
- `packages/core/src/cost-scanner.ts`
- `packages/api/src/lib/model-catalog-data.ts`
- `packages/api/src/routes/specs.ts`
- `packages/api/src/routes/tasks.ts`
- `packages/core/src/dispatcher-support.ts`
- `packages/harness/src/types.ts`
- `packages/harness/src/claude.ts`

## Non-Goals

Do not implement the refactor in this prompt.
Do not add dependencies.
Do not change runtime behavior.

## Verification

```sh
pnpm test
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- decision file created
- duplicated sources of truth found
- selected owner for each contract
- verification commands run
