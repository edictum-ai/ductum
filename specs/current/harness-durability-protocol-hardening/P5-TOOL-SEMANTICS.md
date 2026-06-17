# P5 - Tool Semantics

You are working in `/Users/acartagena/project/ductum`.

## Goal

Add a small core `ToolSemantics` registry so workflow gates can reason from
canonical tool metadata instead of only names and ad hoc args.

## Required Work

- Define metadata for built-in tool families:
  - input schema
  - output schema
  - read-only
  - writes files
  - executes shell
  - destructive potential
  - network potential
  - concurrency safety
  - requires approval
  - permission matcher or equivalence key
  - interrupt/cancel sensitivity
  - result-size behavior
- Wire authorization/gate paths to consult the registry where it removes
  special cases.
- Add tests for Bash, Read, Write, Edit, and unknown tools.

## Behavior Contract

- Unknown tools default conservative.
- Equivalent tool inputs can dedupe approval/cache decisions where the
  semantics registry says this is safe.
- Existing authorization outcomes are preserved unless tests prove the old
  behavior was unsafe.
- Tool semantics are owned in core, not duplicated per harness.

## Non-Goals

Do not build a full plugin tool catalog.
Do not change Edictum workflow policy semantics.
Do not add dependencies.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- registry location
- semantics added
- special cases removed or intentionally left
- tests added
- verification commands run
