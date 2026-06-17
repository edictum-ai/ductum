---
date: 2026-05-02
status: accepted
deciders: operator (Arnold Cartagena)
related: 109, 110, 111, 113, 120, 122, 124, 125, 126, 127, 128, 129, 130
---

# Decision 131: Factory readiness recovery closeout (Outcome A with named follow-ups)

## Context

`specs/current/factory-readiness-recovery/` was the 2026-04-30 staged
recovery plan opened by D109 to close the gaps the audit exposed:
30 of 32 specs shipped without ever being tracked in Ductum, default
reviewers couldn't pass strict verdicts, every serve restart orphaned
live runs, and onboarding was impassable.

Six P-stages plus P7 (file-size discipline). All seven shipped to
`main` over two sessions:

| Stage | Status | Landing |
|---|---|---|
| P0 Prerequisites | done | operator-direct, D110 |
| P1 CLI skill | done | operator-direct, D111 |
| P2 Dashboard truthfulness | done | operator-ship `d1d5155` |
| P3 Factory durability | done | full Ductum dispatch `35d439e` |
| P4 Catalog truth | done | operator-ship `cffe53a` (this session) |
| P5 Diary cleanup | done | operator-ship `e4b6b85` |
| P6 Bootstrap proof | done | operator-ship `d27f5624` (this session) |
| P7 File-size discipline | done | operator-direct, D113 |

The recovery's stated exit criterion (D109): a fresh `git clone +
pnpm bootstrap` reaches one merged commit and a green factory in
under 10 minutes, on a machine where the operator has only their API
keys configured.

## Decision

Recovery ships as **Outcome A** with two named follow-ups.

`specs/current/factory-readiness-recovery/` → status **done**. All
P-stages merged. The factory runs itself; it is no longer the case
that 30 of 32 specs are unimported, that every serve restart orphans
live runs, or that strict reviewers can't reach a verdict.

The recovery's exit-demo wall-clock could not be honestly verified
end-to-end this session because the bootstrap prereq script hard-checks
`ANTHROPIC_API_KEY`, and the operator's machine uses Claude Code
subscription auth (no raw API key). The shipped prereq script is
correct in structure and fails fast (`0.77s` on the missing-key
path), but its set of accepted credentials is too narrow for
subscription-auth users. This is a **prereq-script gap, not a factory
unreadiness signal.**

### Two named follow-ups (terminal status of the recovery does not
gate them)

1. **D130 — `bootstrap-multi-provider-auth` (next active spec).**
   Port pi-mono's `packages/ai/src/env-api-keys.ts` pattern (~250
   LOC, MIT) into `scripts/bootstrap-support.mjs`. Multi-provider
   from day one: Anthropic (OAuth + API key), GitHub Copilot, OpenAI,
   plus the providers already wired through `harnessRef`. Optional
   `pnpm ductum login` wizard for subscription auth via PKCE. This
   spec subsumes the recovery's deferred demo verification: once it
   ships, the bootstrap exit demo can be re-run on this machine with
   honest wall-clock.

2. **D129 — Telegram tap-approval round-trip.** Already documented.
   Operator can run the round-trip today via ngrok or similar; the
   long-term answer is the edictum-api relay. Not on the recovery
   critical path.

### Other gaps surfaced this session that are *not* part of this
closeout

- **Gap 12 (informal):** claude-agent-sdk silently swallows
  `Prompt is too long` API errors and reports the run as
  `session ended — success` in the dashboard. Confirmed live on
  P6 sonnet run `rAJPyu` (the screenshot the operator surfaced
  during the recovery). The dashboard's green "success" pill on a
  context-overflow is misleading; the post-completion router should
  detect the error string and fail the run with `failReason:
  "claude-agent-sdk prompt-overflow"`. Adds to D115 as Gap 12.
- **Gap 11 still open:** no `pendingApproval` push notification —
  partially addressed by D129 (Telegram DMs work end-to-end), tap-
  approval round-trip deferred.
- **Gaps 1, 2, 3, 4, 8, 9, 10 from D115 remain deferred** as logged.

## Why Outcome A and not Outcome B

D109 frames Outcome B as "Pi-blocker named honestly." The blocker
that surfaced this session is **not Pi-related and not a factory
unreadiness blocker.** It is a single-line prereq script over-check
in the bootstrap entrypoint. The factory's runtime trust layer,
dispatcher, post-completion pipeline, reviewer chain, approval gate,
and merge orchestration all work end-to-end (proven by P4 + P6
shipping through Ductum dispatch in this session). Naming this as a
Pi-blocker would misread the failure mode.

## How to apply

- Mark `factory-readiness-recovery` spec status **done** via
  `ductum spec set-status`.
- Update `specs/CURRENT.md` ACTIVE MISSION banner to point to D130
  (`bootstrap-multi-provider-auth`).
- Update `AGENTS.md` ACTIVE MISSION block: recovery is closed; next
  builder reads D130 and pi-mono references.
- Update `CLAUDE.md` ACTIVE MISSION block: same.
- Commit: `chore(recovery): close factory-readiness-recovery
  (Outcome A) + record D129/D130/D131 follow-ups`.

## Non-goals

- This closeout does not amend any P-stage's exit-demo wording. P6's
  exit demo remains "fresh clone → merged commit < 10 min." That
  demo is unblocked once D130 ships, not by amending P6.
- This closeout does not retroactively change merge-orchestration,
  approval gates, or the factory's runtime contract. Anything that
  would be a runtime change belongs in its own spec.
