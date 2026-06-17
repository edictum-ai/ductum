---
date: 2026-05-25
status: accepted
deciders: Codex
related: 147, 150, 154, 156
---

# Decision 165: Factory data startup boundary

## Context

P2 of the operational model redesign introduces a per-Factory data directory
under `~/.ductum`, but the prompt does not name the exact default child path or
how it coexists with legacy `ductum.yaml` startup before P6 migration exists.

## Decision

`ductum start` defaults to the Factory data directory:

```text
~/.ductum/factories/default
```

`--dir` means the Factory data directory. Startup state must stay inside that
directory: the legacy config path defaults to `<dir>/ductum.yaml`, the database
path defaults to `<dir>/ductum.db`, and explicit `--config` or `--db` paths are
rejected when they escape `--dir`.

Until P6 ships the one-time migration, either of these counts as existing
Factory state:

- a legacy `<dir>/ductum.yaml`;
- a Ductum database at `<dir>/ductum.db` with a persisted Factory row.

If neither exists, or if the database exists but has no Factory row,
`ductum start` routes to setup or migration planning instead of starting an
empty app.

`pnpm serve` remains the contributor/dev startup path and still reads legacy
`ductum.yaml` before P6. It now preflights the legacy config before reset,
startup, or seed mutation. The legacy seed path also writes declarative config
resources before agent rows so `agent.*Ref` values validated by preflight can
resolve during the existing legacy import.

## Consequences

This keeps the normal operator path under a user-global Ductum root without
claiming legacy YAML is gone. P6 can later make the database-only state the
normal migrated shape and stop reading `ductum.yaml` after migration succeeds.

The root-level `~/.ductum/operator-token` fallback remains for compatibility
with D156. New per-Factory startup also reads `<dir>/.ductum/operator-token`.
