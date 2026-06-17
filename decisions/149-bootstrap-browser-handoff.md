---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena)
related: 109, 131, 147, 151
---

# Decision 149: Browser auto-opens on `ductum init` success, with `--no-browser` opt-out

## Context

After `ductum init` finishes scaffolding and starts the dashboard
(P3), the operator needs to land on the dashboard's `/welcome` route
to import their first spec. Two shapes:

- **Auto-open**: spawn the user's default browser at the right URL.
- **Print URL**: print the URL and let the operator click or paste.

This decision picks the default behavior and documents the opt-out.

## Decision

`ductum init` **auto-opens** the browser to
`http://<host>:<port>/welcome` on the success path. The default is
suppressed in three cases:

1. `--no-browser` flag is passed.
2. `DUCTUM_NO_BROWSER=1` env var is set.
3. stdout is not a TTY (the run is scripted; auto-open would be
   surprising).

When suppressed, the URL is printed so the operator can copy/click.

## Why

- **Reduces friction at the exact moment the operator's attention is
  needed.** The arc's exit demo (P5) assumes the operator clicks one
  approve button after init. If they have to manually find the URL
  first, that's a second click of operator effort, and it inflates
  the wall-clock without adding value.
- **Matches what comparable tools do**: `gh repo create --web`,
  `vercel dev`, `stripe login`, `supabase start`, `pi`. Operators
  expect tools that "open the browser when there's a browser thing
  to do."
- **The opt-outs are the standard escape hatches**: a flag for ad-hoc
  invocations, an env var for shell aliases, and a TTY check so
  scripted/CI runs are never surprised.

## How to apply

- Use the `open` package, version `11.0.0`, exact-pinned. Audited in
  D151. MIT, sindresorhus, no native deps.
- The CLI's start-and-handoff step (P3) reads, in order:
  `--no-browser`, `DUCTUM_NO_BROWSER`, `process.stdout.isTTY`. First
  truthy → suppress.
- Suppressed path emits `init.browser_skipped` event with reason.
  Open path emits `init.browser_opened`.
- The URL passed to `open()` carries the operator token so the
  freshly-loaded `/welcome` page can authenticate without a
  separate paste step. The dashboard exchanges the URL token for a
  session cookie on first load and strips the token from the URL.
  This is documented as a known short-lived handoff, not a
  long-lived auth path.

## Non-goals

- Not opening a *specific* browser. Use the OS default. `open` lets
  callers force chrome/firefox/etc., but Ductum doesn't choose.
- Not auto-opening on every `ductum init` re-run. P0's
  `init_already_initialized` error path does *not* auto-open; it
  prints the existing URL and exits.
- Not opening the dashboard outside of the init flow. Future arcs
  may add `ductum dashboard` (a one-shot opener), but this arc
  doesn't.

## Slop review

- Attack any commit that auto-opens without honoring the three
  opt-outs.
- Attack any commit that opens the browser even when init *failed*.
  Auto-open is success-path only.
- Attack a URL handoff that leaves the operator token in the URL
  bar permanently. The dashboard must rotate to a session cookie
  and strip the URL on first load.
- Attack any P3 commit that picks a different open-package without
  re-running the D52 audit and recording it as a follow-up
  decision.
