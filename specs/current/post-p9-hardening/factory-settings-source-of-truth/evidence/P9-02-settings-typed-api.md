# P9 Evidence 02 — Settings Typed API Proof

All calls against the temp factory on `http://127.0.0.1:4180` with the
`x-ductum-operator-token` header. Endpoints exercised:

- `GET /api/factory-settings` — full typed catalogs (see P9-01).
- `GET /api/factory/settings` — `recordType: FactorySettings`, name,
  defaultMergeMode, heartbeatTimeoutSeconds, budgets, worktree. Values match
  the init seed (heartbeat 120, perSpecHardUsd 200, merge human).
- `PATCH /api/factory/settings` `{"heartbeatTimeoutSeconds":150,"budgets":{"perRunWarnUsd":5}}`
  → `{"applied":true,"restartRequired":false,"affectedRuntimes":[]}` with
  `desired.heartbeatTimeoutSeconds=150`, `desired.budgets.perRunWarnUsd=5`.
  The follow-up `GET /api/factory/runtime` shows
  `current.heartbeatTimeoutSeconds=150` and `costBudget.perRunWarnUsd=5` —
  hot-applied to the running process, honestly reported.
- `GET /api/factory/runtime` — distinguishes `current` (process observation)
  from `desired` (persisted): the demo process was started with `--port 4180`
  while desired `apiPort` is the init-persisted `4100`, and the response says
  `restartRequired: true, affectedRuntimes: ["api"]`. Honest marker confirmed.
- `PATCH /api/factory/runtime` `{"dispatcherHeartbeatIntervalSeconds":45}`
  → `{"applied":false,"restartRequired":true,"affectedRuntimes":["dispatcher"]}`,
  `current...=30`, `desired...=45`. Restart-required fields are honest:
  applied stays false until restart.

## Restart persistence

API process killed and `ductum start` re-run (same `--port 4180`):

- `GET /api/factory/settings` → `heartbeatTimeoutSeconds: 150`,
  `budgets.perRunWarnUsd: 5` (survived restart).
- `GET /api/factory/runtime` → `current.dispatcherHeartbeatIntervalSeconds: 45`
  now equals desired (applied by restart); `current.apiPort: 4180` vs
  `desired.apiPort: 4100` still honestly flagged `restartRequired` with
  `affectedRuntimes: ["api"]` because the operator keeps forcing `--port`.

PASS: typed reads/writes persist in SQLite, survive restart, and
restart-required markers are truthful.

## Finding (not a P9 blocker, pre-existing P4/P6 behavior)

`PATCH /api/factory/settings` returns `applied: true` while its `current`
snapshot in the same response still shows the pre-write value (e.g. 120 next
to `desired` 150). The value IS hot-applied (proven by the follow-up runtime
read), so the marker is truthful, but `current` in the write response is a
pre-write snapshot, which reads inconsistent next to `applied: true`. Logged
for post-source-of-truth backlog; no behavior change made in P9.
