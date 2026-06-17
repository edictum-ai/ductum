# D144 — CLI Output Mode Toggle

Date: 2026-05-03

Status: Implemented

## Context

D135 requires new agent-first CLI surfaces to resolve output mode from flags,
`DUCTUM_OUTPUT`, persisted `factory.cli.outputMode`, then `auto`.

## Decision

`ductum config --set-output {auto|json|ndjson|human}` now updates
`factory.cli.outputMode` through the settings config API. `ductum config
--get-output` reads the configured value and returns the standard D135
`config.output` envelope with the currently resolved mode.

The existing shared output helper remains the single resolver. New bundle
commands use it through `ctx.writeEnvelope`; `ductum agent test` was moved from
legacy `ctx.write` to `ctx.writeEnvelope` so it matches `ductum events`,
`ductum spec sync`, and `ductum task set-status`.

## Consequences

Non-TTY invocations of those commands default to JSON envelopes unless flags,
environment, or persisted config select another mode. Existing pre-bundle
commands are intentionally unchanged per D135 section 10.
