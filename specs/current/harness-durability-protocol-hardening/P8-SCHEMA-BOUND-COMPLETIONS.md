# P8 - Schema Bound Completions

You are working in `/Users/acartagena/project/ductum`.

## Goal

Require machine-checkable terminal payloads for workflows where Ductum needs a
structured handoff.

## Required Work

- Define adapter-independent final payload contracts for:
  - review complete
  - fix attempted
  - CI/verification failed
  - ready to ship
- Add validation for required terminal payloads.
- Add a configurable retry cap for missing or invalid structured terminal
  payloads.
- Preserve final text output alongside structured payloads.
- Record structured-output failures through the terminal evidence taxonomy.

## Behavior Contract

- Valid structured payload appears on the final run result or evidence.
- Invalid payloads retry up to a configured cap.
- Missing required payload fails with `structured_output_failed`.
- Existing text-only flows keep working unless the workflow explicitly requires
  a schema-bound payload.

## Non-Goals

Do not add a broad schema dependency unless P0/P8 records a decision.
Do not require structured payloads for every agent message.
Do not weaken reviewer/fixer workflow gates.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/harness test
pnpm --filter @ductum/api test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- payload contracts added
- validation/retry behavior
- failure taxonomy mapping
- tests added
- verification commands run
