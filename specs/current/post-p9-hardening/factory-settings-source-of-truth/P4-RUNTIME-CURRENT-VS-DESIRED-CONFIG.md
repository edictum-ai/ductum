# P4 - Runtime Current Vs Desired Config

## Goal

Make runtime/process settings honest by showing desired persisted values next
to current effective values and restart requirements.

## Scope

- Add current-vs-desired runtime DTOs for API host/port, dashboard URL, public
  API URL, DB path, Factory dir, dispatcher status, heartbeat interval, worktree
  root, and restart-required markers.
- Add write behavior for desired runtime values that cannot hot-apply safely.
- Include `applied`, `restartRequired`, `affectedRuntimes`, `current`, and
  `desired` in relevant write responses.
- Ensure active Attempts keep snapshots and future Attempts use updated desired
  settings only when appropriate.

## Files Likely Touched

- `packages/api/src/routes/factory.ts`
- `packages/api/src/routes/factory-settings.ts`
- `packages/api/src/lib/operator-brief.ts`
- `packages/cli/src/serve/api-runtime.ts`
- `packages/cli/src/serve/factory-data.ts`
- `packages/core/src/dispatcher*.ts`
- `packages/core/src/types.ts`
- `packages/core/src/tests/*runtime*.test.ts`
- `packages/api/src/tests/factory*.test.ts`

## Explicit Non-Goals

- Do not implement a process manager or automatic restart button.
- Do not make DB path or Factory dir hot-editable.
- Do not change Telegram/webhook behavior.
- Do not alter active run snapshots retroactively.

## Acceptance Tests

- Runtime API reports current and desired values separately.
- Editing API port/bind/public URL persists desired values and marks restart
  required without claiming hot application.
- Hot-reloadable fields report `applied: true`.
- Existing Runs keep their heartbeat/sandbox/workflow snapshots.
- Operator surfaces do not say "saved" when restart is still required.

## Verification Commands

```bash
pnpm --filter @ductum/api test -- factory
pnpm --filter @ductum/core test -- dispatcher
pnpm --filter @ductum/cli test -- serve-command
git diff --check
node scripts/check-file-size.mjs
```

## Dependencies On Previous Stages

- P1 for runtime settings storage.
- P3 for removal of YAML as competing runtime config.

## Risks / Rollback Notes

- Risk: current/desired values can drift silently if startup does not load the
  persisted desired state. Add startup assertions.
- Risk: operators may expect restart to happen automatically. The UI/API must
  say restart-required, not restarted.
- Rollback: hide write endpoints and keep read-only runtime status until the
  startup path is fixed.
