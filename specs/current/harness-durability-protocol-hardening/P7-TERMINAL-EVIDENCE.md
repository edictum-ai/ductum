# P7 - Terminal Evidence

You are working in `/Users/acartagena/project/ductum`.

## Goal

Make terminal harness diagnostics first-class evidence instead of opaque log
text.

## Required Work

- Define a small taxonomy for terminal evidence:
  - `success`
  - `cancelled`
  - `approval_denied`
  - `tool_failed`
  - `model_error`
  - `max_turns`
  - `max_budget`
  - `structured_output_failed`
  - `transport_lost`
  - `crashed`
- Map existing Claude/Codex/OpenCode/Copilot terminal cases into the taxonomy
  where data already exists.
- Preserve permission denial evidence where adapters report it.
- Include last transcript sequence and diagnostic context where available.
- Preserve existing `exitReason`, `failReason`, and pause detail behavior.
- Add tests for failure evidence creation and API visibility.

## Behavior Contract

- Terminal failures have stable codes.
- Existing operator-facing messages stay understandable.
- Evidence is safe to expose in dashboard/API contexts.
- Max turns and max budget do not collapse into generic failure.
- Approval denial is distinguishable from tool execution failure.

## Non-Goals

Do not redesign all run status logic.
Do not add LLM judging.
Do not infer facts that adapters did not report.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/harness test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- taxonomy added
- adapter mappings
- permission/diagnostic fields
- API/UI visibility
- tests added
- verification commands run
