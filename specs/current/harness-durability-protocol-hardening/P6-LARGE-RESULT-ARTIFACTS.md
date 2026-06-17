# P6 - Large Result Artifacts

You are working in `/Users/acartagena/project/ductum`.

## Goal

Persist large tool results as run artifacts and keep activity rows as previews.

## Required Work

- Define a run artifact shape for large tool results.
- Store oversized stdout/diffs/RPC payloads outside activity rows.
- Activity rows should include preview text, byte counts, digest, and artifact
  reference.
- Use exclusive create semantics so an existing artifact path is not silently
  overwritten.
- Support per-tool thresholds and a documented opt-out for tools that should
  never persist large output.
- Add tests for large stdout and large tool result payloads.
- Add tests for stable byte-limited previews and replay pointer resolution.
- Ensure deletion/cascade paths clean up artifact references consistently.

## Behavior Contract

- Dashboard activity stays compact.
- Full result content remains available for audit/debug.
- Replay events can resolve the artifact pointer.
- Artifact paths are scoped to the run and cannot escape storage.
- Existing small activity behavior remains unchanged.

## Non-Goals

Do not build object storage.
Do not build a dashboard artifact viewer unless needed by tests.
Do not store secrets in new places beyond existing harness exposure.

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

- artifact storage location
- activity preview shape
- size thresholds
- cleanup behavior
- tests added
- verification commands run
