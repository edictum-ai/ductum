---
date: 2026-05-05
status: accepted
deciders: operator (Arnold Cartagena), Claude (Opus 4.7)
related: 109, 131, 135, 155, 156, 157, 158, 159, 160
---

# Decision 161: Bootstrap-redesign arc paused — exit demos were too narrow, audit before resuming

## Context

The P5 clean-VM exit demo run on 2026-05-05 was meant to close the
bootstrap-redesign arc. Instead, it surfaced a ladder of blockers in
the published `ductum@0.1.1`:

| # | Blocker | Where it lived |
|---|---------|----------------|
| 1 | API startup guard didn't read `~/.claude/.credentials.json` | `validate-env.ts` (D159, fixed in 0.1.1) |
| 2 | pnpm 10 install scripts disabled; `better-sqlite3` native binding never built; API failed to load module | `exit-demo-redo.mjs` (D160, harness-side fix) |
| 3 | Welcome URL surfaced as `?token=undefined` instead of operator token | `init/steps/browser-handoff.ts` |
| 4 | Dashboard `/welcome` auth handoff doesn't fall back gracefully | likely related to #3 |
| 5 | Bundled hello-readme task is named `append-readme-line`; harness's `hasHelloReadme()` matcher looks for `P1-HELLO-README` or `hello-readme` substring | sample spec naming OR harness matcher |
| 6 | Imported task isn't auto-dispatched (`agent: "<agent>"` placeholder); requires explicit `ductum run` | dispatcher / task agent assignment |
| 7 | `claude-agent-sdk` rejects ductum-PKCE-written credentials with `"Not logged in · Please run /login"` — credentials format mismatch | `ductum login` PKCE flow vs SDK expected shape |

The operator's broader observation cut through:

> It would be good if that is the only issue but everything is an
> issue, for example the ui, adding another agent, opus, the defaults
> it has no boxes to choose just text box, it basically breaks
> everything. Settings menu with values that don't even work.

So this is not a "fix five bugs" situation. The shipped 0.1.1 has
multiple broken or half-built surfaces that the bootstrap-redesign
arc never directly verified. Specifically:

- Dashboard agent-add UX uses freeform text inputs where it should
  surface validated pickers.
- Dashboard settings menu has fields that don't persist or don't
  function.
- Defaults across the dashboard don't behave as a fresh user would
  expect.

## Why this happened

The arc's P-files defined exit demos too narrowly:

- **P3** (browser handoff + `/welcome` route) shipped on a single
  contract: the operator clicks "Import sample spec" on `/welcome`
  and the SSE stream renders progress. It did not exercise any other
  dashboard route, the agent CRUD UI, settings forms, or default
  values for non-init flows.

- **P4** (publish to npm) shipped on the contract: `pnpm install -g
  ductum` works on a fresh machine and `ductum init` reaches the
  dashboard. It did not include a smoke test of the dashboard's CRUD
  surface or any post-init operator workflow.

- The arc's slop-review section attacked obvious failures (no exit
  demo, broken envelope, mocked agents) but did not include
  "attack any P-file whose exit demo doesn't exercise the surface
  area end users actually use." That gap let narrow demos pass as
  shipped.

This is a process finding, not just a per-bug finding.

## Decision

**The bootstrap-redesign arc is paused as of 2026-05-05.** P5 cannot
be closed against `ductum@0.1.1` because the broader product
surface — particularly the dashboard CRUD UX and the
ductum/claude-agent-sdk credentials integration — is not in a state
that supports the arc's stated end-to-end claim.

Before resuming, an **audit pass** completes (option C from the
2026-05-05 fork-in-the-road):

1. Inventory every shipped surface in 0.1.1 (CLI commands, dashboard
   routes, API endpoints).
2. For each, name the verified-by claim and the actual observed
   behavior on a clean install.
3. Categorize findings: works / partially-works / broken /
   never-implemented.
4. Output: `specs/current/bootstrap-redesign/AUDIT-FINDINGS.md` (a
   new file the audit produces — empty until run).

After the audit:
- If 0.1.1's shipped surface is mostly green with a few named gaps,
  amend the arc with new sub-stages to close those gaps and
  re-publish 0.1.2.
- If 0.1.1's shipped surface is mostly red, P3/P4's status in the
  arc README is amended from "Shipped" to "Partially shipped — see
  D161 + AUDIT-FINDINGS.md," a separate UX-quality arc is opened to
  drive the dashboard to a usable state, and bootstrap-redesign
  closes (or stays open) on whatever narrower exit criterion the
  audit makes honest.
- Either way, P5's protocol is amended to depend only on flows that
  the audit verifies as working.

## Why option (a) wasn't picked unilaterally

The 2026-05-05 conversation considered three options:
- (a) Roll P3/P4 back to "partially shipped" now, plan UX arc.
- (b) Treat dashboard as out-of-arc, narrow P5 to CLI-only.
- (c) Pause and audit before deciding.

The operator picked (c). The reason: an audit-first approach gives
the *honest map* of 0.1.1's debt before committing to (a) or any
other resolution. Without the map, any plan would either over-correct
("rebuild the dashboard before P5 retries") or under-correct ("just
fix the seven blockers found"). The audit's findings drive the
correct response.

## What's frozen during the pause

- The arc's status table in
  `specs/current/bootstrap-redesign/README.md` is not amended yet.
  P3 and P4 still show "Shipped" until the audit gives evidence to
  amend.
- No 0.1.2 publish until audit findings + a fix-bundle plan exist.
- The Lima VM Hermes set up at `macmini-1.sunrise.box:.lima/p5-exit-demo/`
  is left running so the audit can use it as a reference clean-ish
  install of `ductum@0.1.1`. Tear it down explicitly when the audit
  finishes.
- D157's no-provenance drift continues to apply for any future
  publish.
- D158's "fail honestly" rule continues to apply: do not paper over
  audit findings to make P5 closeable; close P5 honestly or keep it
  open with a named blocker.

## What lands as part of this pause

This decision file (D161).

A new audit checklist at
`specs/current/bootstrap-redesign/AUDIT-CHECKLIST.md` that the
operator (or a delegated agent) drives the actual audit from. The
checklist captures the surfaces to inventory, the questions to ask
of each, and the output format.

P5 evidence captured during the failed run:
- `evidence/p5-blocker-api.log` (D159 blocker, 0.1.0)
- `evidence/p5-blocker-pane.txt`
- `evidence/p5-blocker-creds-shape.json`
- `evidence/p5-blocker2-api.log` (D161 blockers, 0.1.1)
- `evidence/p5-blocker2-pane.txt`
- `evidence/p5-blocker2-creds-shape.json`

## Slop review

- Attack any future "P3/P4 shipped" claim that doesn't reference
  the audit's findings.
- Attack any P5 retry that uses a `ductum@0.1.x` version where the
  audit hasn't documented the dashboard CRUD UX as either fixed or
  explicitly out-of-scope.
- Attack any narrowing of P5's protocol that hides broken surfaces
  rather than naming them.
- Attack any audit that closes with "looks fine" without naming
  every CRUD form, every default value, and every settings field.
  The 2026-05-05 finding is that the holes are in the surfaces we
  didn't look at; closing the audit without looking would repeat the
  process failure.
- Attack any 0.1.2 publish that doesn't fix #7 (claude-agent-sdk
  credentials shape mismatch). Without that fix, no fresh-machine
  user can run agents at all — the demo is meaningless and the
  product is non-functional regardless of UX.

## Non-goals

- Not deciding here whether the dashboard's UX gaps justify a
  separate arc, a 0.2.0 reset, or a smaller fix-bundle. The audit's
  output drives that.
- Not retroactively adjusting D135's agent-first contract. That
  contract is for new CLI surfaces and is still load-bearing.
- Not re-running the bootstrap PKCE flow until #7 is fixed. The
  fresh-machine flow doesn't work for agents until that lands.
