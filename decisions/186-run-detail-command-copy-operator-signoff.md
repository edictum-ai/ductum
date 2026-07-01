# D186 — Run-detail command copy writes the displayed (redacted) command

**Date:** 2026-07-01
**Status:** accepted (Ductum review round 4 reversal)
**Linked:** GitHub issue #211, P1-RUN-DETAIL-SHELL-TIME-MOBILE review rounds 3 and 4
**Replaces:** the round-3 draft of this decision, which claimed
`accepted (operator sign-off)` for the opposite behavior. No operator approved
that behavior; the claim was false and this record corrects it.

## Context

The run-detail `CommandBlock` (timeline + activity tab) renders each shell
command in a bounded `<pre>` for safe screenshotting and screen sharing:
secrets are redacted on screen via `redactSensitiveText` (e.g.
`TOKEN=[hidden]`).

Review round 1 added a `copyValue` prop to `CommandBlock` so the copy button
could write the **original unredacted** command to the clipboard while the
`<pre>` stayed redacted. Round 3 then drafted an earlier version of this
decision (`accepted (operator sign-off)`) to record operator approval of that
asymmetric display/clipboard behavior. No such operator approval happened.
Round 4 flagged two defects:

1. The decision falsely implied a human signed off on copying hidden live
   secrets from a redacted UI.
2. `CommandBlock` still copied the original unredacted command while the
   button only said `Copy shell command` — the first UI path that surfaced a
   live secret through the dashboard, with a label that did not disclose the
   asymmetry.

## Decision

The clipboard mirrors the displayed text. `CommandBlock` writes the same
string to `navigator.clipboard.writeText` that it renders in the `<pre>`, and
the `copyValue` prop has been removed. Callers continue to redact before
passing `command` (e.g. via `redactSensitiveText`), so both the screen and the
clipboard receive the redacted form. The default accessible button label is
now `Copy displayed shell command` so the affordance is honest about what
operators will paste.

The earlier round-3 draft's `accepted (operator sign-off)` status is
retracted. Ductum rejected the unredacted clipboard behavior on the operator's
behalf in review round 4; no operator ever approved the prior behavior, and
this record exists in part to make that correction durable.

## Why this is the right trade-off

- **Display and clipboard must agree.** Run detail is the page operators
  share in screenshots, screen shares, and review threads. The moment the
  clipboard path diverges from the rendered text, every "I copied the
  redacted block" mental model breaks, and the dashboard becomes a path that
  can exfiltrate a live `TOKEN=...` or `Authorization: ...` header that the
  operator was shown as `[hidden]`. Keeping the two in lockstep is the
  smallest, most auditable surface.
- **The asymmetric copy was an undisclosed exfil path.** Round 1's intent was
  operator convenience (paste a re-runnable command without retyping the
  secret). In practice it meant a screenshot-safe block could be copied into a
  chat, PR thread, or external tool with the secret intact and without any
  signal in the UI that the clipboard differed from the rendered text. The
  `Copy shell command` label did not disclose the asymmetry.
- **Operators who really need the original command still have it.** The
  factory already owns the source of truth for every command it executes:
  attempt activity rows, the run log, and the harness's own audit trail. A
  dashboard copy button is a convenience, not the canonical source; losing
  the unredacted clipboard path does not lose the command.

## Operator guidance

- The copy button is a **reuse-the-displayed-text** action. Pasting it into a
  terminal will produce `TOKEN=[hidden] ...`; the operator must fill the
  secret back in (the same as if they had retyped it from the screenshot).
- Operators who need the original unredacted command for re-execution should
  pull it from the attempt activity / run log surface where the factory
  recorded it, not from the dashboard `<pre>`.

## Residuals and future work

- A future dashboard-wide clipboard-policy pass could reintroduce an explicit
  `Copy original command` affordance behind a confirm dialog and a verbose
  tooltip, gated on a factory setting. That is a cross-surface design call
  and is out of scope for this run-detail cleanup task; until then, the safe
  default (displayed text) stands.
- If the dashboard ever ships a hosted/remote deployment mode, the displayed
  text default is the only safe baseline; the asymmetric path must not be
  re-enabled as a default.

## Test pins

The display-agrees-with-clipboard behavior is pinned by the copy-action
assertions in the post-split test files. Both tests fail if
`navigator.clipboard.writeText` receives a command containing
`super-secret-value`:

- `packages/dashboard/src/tests/run-timeline.test.tsx` — "bounds long shell
  commands in a scrollable code block with a copy action instead of wrapped
  prose" asserts `writeText` receives the same redacted value rendered in the
  `<pre>` (`TOKEN=[hidden]`, never `super-secret-value`).
- `packages/dashboard/src/tests/run-detail-activity-command-block.test.tsx`
  — "bounds approval-requested Bash commands serialized as plain text in a
  CommandBlock" makes the same assertion for the activity-tab path. (This
  test was split out of `run-detail-activity.test.tsx` during review round 3
  to keep that file under the 300 LOC file-size gate; the round-3 draft of
  this decision pointed at the wrong file.)

Changing the displayed-text-default behavior would fail these tests, which is
the correct pin direction: any change to this decision must update both the
tests and this record.
