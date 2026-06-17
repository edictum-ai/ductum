---
date: 2026-05-03
status: accepted
deciders: Codex
related: 130, 132, 135, 147, 148, 149, 150, 151
---

# Decision 152: P1 init YAML validation uses CLI static validation until a core loader exists

## Context

P1 says the generated `ductum.yaml` Claude agent entry should verify through
`@ductum/core`'s factory loader before write. During implementation, there is
no exported core factory loader for the P0/P1 list-shaped scaffold:

- P0 emits `projects:` and `agents:` as lists.
- The existing settings validator in the API validates the older map-shaped
  runtime settings config.
- `@ductum/core` does not currently export a loader that accepts the new
  bootstrap scaffold shape.

## Decision

For P1, the CLI validates its generated YAML locally before writing:

- Parse the YAML with the existing pinned `yaml` dependency.
- Require a top-level object, `factory.name`, and a list-shaped `projects`.
- When Claude auth is enabled, require exactly the P1 `claude-builder` agent
  shape and the exact `claude-agent-sdk` harness pin `0.2.119`.
- Emit `init_yaml_invalid` and roll back if validation fails.

This is intentionally narrow. It validates only the scaffold emitted by
`ductum init`; it is not a general Ductum config validator.

## Consequences

P1 keeps the promised rollback behavior and exact Claude resource shape without
inventing a broader config loader during a security-sensitive auth slice.

When the bootstrap arc needs general config loading, add the loader in the
proper package and replace this CLI static check with that shared path.
