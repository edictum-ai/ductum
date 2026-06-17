# 075 - Runtime Snapshot Nullability Is Legacy-Compatible

## Status

Accepted

## Context

Decision `070` made dispatch-time `runtime_model` and `runtime_harness`
snapshots authoritative for new runs. Existing databases and test fixtures can
contain pre-snapshot runs with null runtime snapshot columns.

## Decision

`runtime_model` and `runtime_harness` remain nullable for legacy and
pre-migration rows. Dispatcher-created runs must write both fields. If a
ref-backed run has no complete runtime snapshot at completion/cost time,
Ductum fails closed for cost inference instead of re-resolving current refs or
falling back to legacy Agent fields.

## Why This Is Not Drift

This preserves migration compatibility while keeping the snapshot, not today's
resource state, as the audit source of truth.

## Non-Goals

- No run table rebuild solely for snapshot `NOT NULL` constraints.
- No re-resolution of old ref-backed runs for cost.
- No new top-level primitive.
