# D158: P5 Exit Demo Runs As Operator Harness

Date: 2026-05-04

## Status

Accepted.

## Context

P5 closes the recovery's deferred wall-clock claim from D131. The proof
has to run on a clean machine with the published global package, real
Claude subscription auth, a real dispatch, one dashboard approval, and a
real merge in under 10 minutes.

Codex cannot honestly provide the clean machine or perform the browser
account consent. Codex can only ship the harness, typed evidence kind,
tests, and operator protocol.

There is also a package-version boundary: `ductum@0.1.0` was published
at P4 before the P5 route-level typed evidence validation existed. The
harness therefore records the ledger row with evidence type
`exit_demo.run` instead of overloading the older `custom` evidence
allow-list.

## Decision

Ship `scripts/demos/exit-demo-redo.mjs` as the live operator harness and
`scripts/demos/exit-demo.mjs` as the compatibility entrypoint named by
the P5 spec.

The harness:

- runs `pnpm install -g ductum@0.1.0`
- runs the real `ductum init` TUI with browser auth enabled
- polls the factory through the `ductum` CLI only
- records timing checkpoints under `/tmp/exit-demo-redo-evidence/`
- writes `p5-exit-demo.json` with payload kind `exit_demo.run`
- fails with structured errors for pre-existing creds, missing
  checkpoints, budget overrun, missing merge, or evidence attach failure
- never uses mocks in the live path

The script tests cover helper logic only. They do not run real agents,
open browsers, call npm, or start a factory.

## Consequences

The implementation can be reviewed and shipped before the operator runs
the clean-machine proof.

The bootstrap-redesign arc must not be marked closed until the operator
returns a `p5-exit-demo.json` payload with `totalSeconds < 600` and the
ledger evidence attach succeeds. If the published package cannot record
the typed evidence row, the honest result is a named P5 blocker, not a
silent pass.
