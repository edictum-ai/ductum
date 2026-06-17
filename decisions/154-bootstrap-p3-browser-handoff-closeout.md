---
date: 2026-05-03
status: accepted
deciders: Codex
related: 135, 149, 152, 153
---

# Decision 154: P3 browser handoff ships with source-path serve and documented token handoff drift

## Context

P3 closes the P0 gap where `ductum init` ended with CLI next steps that only
worked after a separate API startup. The shipped flow now mints a factory
operator token, starts the API on loopback, mints a short-lived welcome handoff
token, opens `/welcome`, and rewrites next steps around the dashboard URL.

The P3 spec was written before P2/P3's operator handoff tightened the token
rules and before P4's global install work. That left several contract details
that needed an explicit closeout decision.

## Decision

P3 accepts the pre-P4 serve limitation. `ductum init` starts:

`node ${SOURCE}/packages/api/dist/index.js --host 127.0.0.1 --port <random> --db <factory>/ductum.db`

This source-checkout coupling is acceptable only until P4. P4 owns publishing
and installing a self-contained CLI path for `ductum serve` or the equivalent
factory startup command.

P3 uses a distinct in-memory handoff token in the browser URL, not the operator
token. The token is minted by the protected API, bound to the current factory,
valid for 60 seconds, consumed once, exchanged for an `HttpOnly; Secure;
SameSite=Strict; Path=/api` operator-token cookie, and then stripped from the
URL by `/welcome` using `history.replaceState`.

The localhost handoff token uses a query parameter rather than a fragment. This
is intentional: the server must receive the token for exchange and HTTPS is not
available in the pre-P4 localhost flow. The risk is bounded by loopback binding,
60s TTL, one-shot consumption, and immediate URL stripping. Browser-open argv
and manual `--no-browser` terminal scrollback can briefly expose the handoff
URL to the local operator environment; this is accepted for P3 and documented
here.

P3 keeps CLI event names in the `init.api_*` family rather than the draft
`init.serve_*` names from the spec. The implementation is starting the API
directly, not a stable installed serve command, so the API naming is more
truthful for this stage. P4 can rename or add compatibility events when the
installed serve path exists.

P3 does not add a `ductum start` command. The operator-facing happy path is
still `ductum init`; P4/P5 can add a reusable existing-factory dashboard opener
after the install path is real.

## Consequences

`writeFactoryOperatorToken` uses exclusive writes for `.ductum/operator-token`
and `.env.local`. Re-running `ductum init` into the same existing factory is not
idempotent; this matches the one-shot bootstrap flow but leaves existing-factory
resume/start behavior to a follow-up.

The random-port flow has the usual bind-after-probe race. If another process
claims the port before the API starts, P3 fails with a structured init error
instead of silently running unprotected.

`packages/cli/src/init/steps/browser-handoff.ts` is over the P3 draft's
suggested 180-line file budget but remains under the repo's enforced 300-line
gate. Split it later only when P4/P5 need to reuse the startup pieces.

P3 seeds Anthropic and Codex agents after `init`; Copilot authentication is
available through P2, but P3 does not seed a Copilot agent because the API model
and harness catalog does not yet expose a Copilot harness/model entry.

The existing `/api/internal/operator-token-detect` loopback helper still returns
the operator token to local dashboard code. This predates P3 and is outside the
handoff diff, but it weakens the long-term token threat model. Gate or replace
it before the global-install/public demo path hardens in P4/P5.

P3 intentionally stores the operator token directly in the protected cookie.
A future session-cookie design can replace that with an opaque server-side
session id without changing the P3 welcome UX.
