# D186 — Run-detail command copy writes the unredacted command

**Date:** 2026-07-01
**Status:** accepted (operator sign-off)
**Linked:** GitHub issue #211, P1-RUN-DETAIL-SHELL-TIME-MOBILE review round 3

## Context

The run-detail CommandBlock (timeline + activity tab) renders a shell command
in a bounded `<pre>` for safe screenshotting and screen sharing: secrets are
redacted on screen via `redactSensitiveText` (e.g. `TOKEN=[hidden]`). The
copy button beside the block, however, calls
`navigator.clipboard.writeText(copyValue ?? command)` where `copyValue`
carries the **original unredacted** command. This split was added in P1 round 1
in response to earlier review feedback that copying must not paste
`[hidden]`/`[redacted]` placeholders, and it is pinned by tests in
`packages/dashboard/src/tests/run-timeline.test.tsx` and
`run-detail-activity.test.tsx`.

Review round 3 flagged this as **the first UI path that surfaces a live secret
through the dashboard**: every other surface is display-only. The reviewer
marked it "intentional/tested design — worth conscious operator sign-off, not
a defect." This decision records that sign-off so future readers understand
the asymmetric display/clipboard behavior is a deliberate operator-enabling
choice, not an oversight.

## Decision

Keep the asymmetric behavior. The copy button intentionally writes the
unredacted, re-usable command to the clipboard while the on-screen `<pre>`
stays redacted. Operator sign-off is recorded here.

## Why this is the right trade-off

- **Display must stay redacted.** Run detail is the page operators share in
  screenshots, screen shares, and review threads. A live `TOKEN=...` or
  `Authorization: ...` header in the `<pre>` would leak through any of those
  paths. `redactSensitiveText` runs on every render path that paints command
  text into the DOM (`run-timeline.tsx`, `activity-tab.tsx`,
  `signal-panels.tsx`).
- **Clipboard must carry the original.** The copy button exists so operators
  can re-run, paste into a terminal, paste into a PR thread, or paste into an
  incident channel. Pasting `TOKEN=[hidden] node scripts/check.mjs` is
  useless: the operator would have to retype the secret. Round 1 of this
  task explicitly rejected that behavior, and the regression tests pin it.
- **The clipboard is already a trusted local surface.** The dashboard is a
  local-first loopback app (see README and D181). The operator already owns
  the browser, the machine, and the factory credentials; the clipboard is
  not a new exfiltration vector for them. The asymmetric path would be
  higher-risk on a hosted/remote dashboard, which is not the current
  deployment shape.

## Operator guidance

- The copy button is a **reuse** action, not a **share** action. To share a
  command, screenshot the redacted `<pre>` (or copy from the screenshot).
- Operators who paste a copied command into a chat, PR, or external tool are
  responsible for redacting before send, the same as if they had retyped it
  from their shell history.

## Residuals and future work

- If the dashboard ever ships a hosted/remote deployment mode, the clipboard
  path must be revisited. Likely options: a per-deployment toggle that forces
  `copyValue = command` (redacted clipboard in protected modes), or a confirm
  dialog when `copyValue` differs from `command`.
- We do not add a tooltip/title attribute on the copy button in this round.
  The button's accessible label (`Copy shell command`) is honest about what
  it does; a verbose warning tooltip is a separate UX call and belongs in a
  dashboard-wide clipboard-policy pass, not in a run-detail cleanup task.

## Test pins

The asymmetric behavior is pinned by the existing copy-action assertions:

- `packages/dashboard/src/tests/run-timeline.test.tsx` — "bounds long shell
  commands in a scrollable code block with a copy action instead of wrapped
  prose" asserts `writeText` receives the original `longCommand` (with
  `TOKEN=super-secret-value` intact) while the displayed `<pre>` shows
  `TOKEN=[hidden]`.
- `packages/dashboard/src/tests/run-detail-activity.test.tsx` — "bounds
  approval-requested Bash commands serialized as plain text in a
  CommandBlock" makes the same assertion for the activity-tab path.

Removing the asymmetry would fail these tests, which is the correct pin
direction: any change to this decision must update both the tests and this
record.
