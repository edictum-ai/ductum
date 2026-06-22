# Decision: atomic evidence/gate commit — idempotent-replay, not cross-store transaction

**Date:** 2026-06-17 · **Decided by:** operator (Arnold) + this session · **Status:** accepted

## Context
The evidence pillar wanted "record evidence + gate verdict + stage advance" to be one atomic
transaction. Reading the real code surfaced two facts the original design under-estimated:

1. **Edictum's `StorageBackend` is async-interfaced** (`set(): Promise<void>`), so `runtime.setStage`
   returns a Promise. better-sqlite3's `db.transaction(fn)` requires a synchronous `fn` — you cannot
   `await runtime.setStage(...)` inside it.
2. **The common stage advance is not a single Ductum write.** It runs inside Edictum's runtime
   (`recordResult` → auto-advance, managing its own evidence + stage in its async store), and Ductum
   only *mirrors* the result into `run.stage` via `refreshRunFromWorkflow` — the moat's most fragile,
   load-bearing path (the `'done'` guard). The only co-located Ductum gate write is the approval path.

## Decision
Exactly-once for the gate commit is achieved by **idempotency + replay**, not a single cross-store
transaction (the async-native standard, the same model Temporal/outbox patterns use):

- Every step is made **idempotent**: evidence write dedups on `content_sha` (shipped); Edictum's
  `set` is already an upsert; `run.stage` is the idempotency anchor (set-to-X is naturally idempotent).
- Where Ductum writes are **co-located and synchronous**, wrap them in one `db.transaction()` for
  local atomicity (shipped for the approval-rejection path: verdict + evidence + run-state).
- A crash that splits the Ductum side from Edictum's async write is healed on recovery by **replay**,
  which re-checks `run.stage` and re-applies only what's missing.

## Alternatives rejected
- **Force one transaction (manual BEGIN / await setStage / COMMIT):** the `await` holds the SQLite
  transaction open across the event loop; another write on the shared connection can interleave into
  it. Too fragile for a correctness product without a global gate-commit lock.
- **Synchronous storage path:** would require an Edictum SDK change or writing Edictum's stage key
  directly — couples Ductum to Edictum's internal key format and bends the D28 4-method contract.

## Shipped vs deferred
- **Shipped:** idempotent (content-addressed) evidence write; atomic approval-rejection gate commit.
- **Deferred to the recovery pillar (deliberately, not by effort):** making the common
  `refreshRunFromWorkflow` stage-mirror replay-safe. It is surgery on the fragile moat and its main
  payoff (no duplicate evidence on retry) is already captured by the idempotent write. It must land
  with the recovery/replay path, not as a standalone change to the advancement core.
