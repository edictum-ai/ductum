# 106 - State Convergence Reconcile

## Status

Accepted

## Context

The reconcile command can repair one contradiction and expose the next one
without reaching a fixed point in the same invocation. The common case is stale
lineage: a stale child run is repaired first, then its stale parent only
becomes eligible on the next manual reconcile. That leaves operator recovery
half-finished unless they already know to run the command again.

The orphan path also needs better liveness truth. When dispatcher liveness is
known, Ductum should use the run's own heartbeat timeout instead of the old
one-hour fallback. But when liveness is unavailable, reconcile must stay
conservative and keep the existing one-hour threshold.

## Decision

- Keep one reconcile entry point and one repair path.
- Implement reconcile as bounded fixed-point repair: run a single repair pass,
  rescan, and repeat until no more visible repairs remain or a maximum pass
  count is reached.
- Dry-run stays read-only. It reports first-pass-visible candidates only and
  surfaces non-convergence when repairs are visible but not applied.
- When dispatcher liveness is available, orphan detection uses only
  `hasActiveSession(run.id)` for live-session truth and the run's own
  `heartbeatTimeoutSeconds` for stale-session timeout.
- When dispatcher liveness is unavailable, preserve the existing one-hour
  orphan fallback.
- API and CLI reconcile output must include pass count and convergence so
  bounded non-convergence is operator-visible.

## Why

This closes a trust gap in operator recovery without adding storage, fake
operator state, or a second reconcile path. Ductum repairs until the reachable
state settles, but still stops loudly when a pathological chain exceeds the
bound.

## Non-Goals

- No new primitive, table, dependency, or marketplace.
- No second policy system.
- No broad success inference from evidence, review prose, or spec text.
- No dispatcher session ownership change.
- No Edictum behavior change.
