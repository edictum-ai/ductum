# P1 - Run Transcript Log

You are working in `/Users/acartagena/project/ductum`.

## Goal

Persist replayable normalized run events separately from dashboard activity
summaries.

## Required Work

- Add a small canonical run transcript event shape.
- Record user/agent/tool/control lifecycle events in append-only order where
  existing harness events already pass through Ductum.
- Include `seq`, `timestamp`, `source`, `kind`, `payloadPreview`,
  `artifactPointer`, and `causalityId`.
- Skip ephemeral progress-only events unless they carry a durable state change.
- Cap transcript reads to a documented byte limit.
- Flush queued transcript writes before yielding final run completion.
- Keep `run_activity` as UI preview/index data.
- Do not store secrets beyond what current harness/activity paths already
  receive.
- Add tests proving kill-mid-turn or crash-mid-turn still leaves ordered
  transcript events up to the failure point.

## Behavior Contract

- A run has a replayable normalized event log.
- Events include run id, sequence, timestamp, kind, source, and payload.
- Sequence numbers are monotonic per run.
- Large payloads are represented by preview + artifact pointer, not duplicated
  into every event row.
- Existing dashboard activity still works.
- Transcript persistence failure must not silently mark the run successful.

## Non-Goals

Do not add a broad event-sourcing rewrite.
Do not build a replay UI.
Do not persist raw provider logs wholesale.

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

- transcript event shape
- persistence location
- read caps and flush behavior
- events recorded
- tests added
- verification commands run
