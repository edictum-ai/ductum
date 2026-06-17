# P9 - Harness Chaos Tests

You are working in `/Users/acartagena/project/ductum`.

## Goal

Add deterministic fake harness tools and streams that exercise fragile control
paths before real agents do.

## Required Work

- Add fake harness/test tools or stream fixtures for:
  - always allow
  - always ask
  - always deny
  - slow approval
  - duplicate response
  - crash mid-tool
  - restart then reattach
  - large result
  - hang until cancel
- Run them through the same control/transcript/evidence paths as real harness
  adapters where practical.
- Add tests proving pending state is cleaned up after deny, cancel, crash, and
  process exit.

## Behavior Contract

- Fake approval tools do not need dangerous shell/file operations.
- Each fake path is deterministic and fast.
- The tests catch duplicate control responses, dangling pending requests, lost
  transcript events, and missing terminal evidence.

## Non-Goals

Do not add a production-visible agent tool.
Do not rely on real provider sessions.
Do not add broad end-to-end tests if package-level fakes catch the issue.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/harness test
pnpm --filter @ductum/api test
pnpm test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- fake tools/streams added
- fragile paths covered
- cleanup guarantees
- tests added
- verification commands run
