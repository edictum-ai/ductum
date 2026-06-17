# 073 - Harness Storage Is Not Static Catalog

## Status

Accepted

## Context

Decision `069` made `Harness` resources authoritative for `harnessRef` values
and left dispatcher adapter availability as the runtime check. The SQLite
`agents.harness` and `session_run_mapping.harness` columns still had static
CHECK constraints from legacy harness support.

Those CHECK constraints made storage a hidden harness catalog and could reject a
resource-resolved `Harness.spec.type` before dispatcher runtime saw it.

## Decision

Store harness values as strings in `agents` and `session_run_mapping`; do not
use SQLite CHECK constraints as a harness catalog. API/settings still validate
legacy direct `Agent.harness` with the static catalog, but resource-resolved
`harnessRef` values may persist. Dispatcher adapter availability remains the
pre-run runtime check.

## Why This Is Not Drift

This aligns storage with decision `069` without adding a second harness
registry, a fake adapter, or a new runtime policy layer.

## Non-Goals

- No new harness registry table.
- No fake harness adapter.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No second policy engine.
- No new dependency.
