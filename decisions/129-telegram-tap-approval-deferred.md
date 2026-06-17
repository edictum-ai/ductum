---
date: 2026-05-02
status: deferred
deciders: operator (Arnold Cartagena)
related: 109, 119, 124, 126, 128
---

# Decision 129: Telegram tap-approval round-trip deferred to roadmap

## Context

P4 (Catalog Truth, shipped 2026-05-02 as commit `cffe53a`) wired the
full Telegram surface that the spec called for:

- `notificationChannels.telegram-operator` declared in `ductum.yaml`
- `/api/telegram/chats` route (chat-id discovery via `getUpdates`)
- `/api/telegram/test-send` route (operator-driven verification ping)
- Dashboard wizard: Discover / Test send / Add Telegram channel buttons
- `NotificationChannel` resource binding via `channelRef`

The bot can DM the operator end-to-end. Verified live during the recovery
session with the operator's personal chat id; test send confirmed
delivered. Specific id and token live only in `.env.local` (gitignored).

P4's exit demo had a stronger ask: the operator approves a run from
**inside Telegram** — tapping an inline button on an approval card sent
by the bot — and the merge happens. That round-trip needs Telegram to
deliver the button-tap callback to a public HTTPS URL, which Telegram
then POSTs to. Local Ductum on the operator's laptop is not directly
reachable from the public internet, so a tunnel (ngrok, cloudflared,
tailscale-funnel) or a hosted relay is required.

## Decision

Tap-approval round-trip is **deferred to roadmap** rather than gating
the factory-readiness recovery. The recovery's exit criterion is the
fresh-clone bootstrap demo (P6), not the Telegram round-trip.

P4 ships with the round-trip listed honestly as an operator-config
follow-up. Three implementation paths are recorded for whoever picks
this up later:

1. **Document the operator-tunnel path.** Add a `docs/telegram-roundtrip.md`
   page that walks through `brew install ngrok && ngrok http 4100` →
   paste the URL into `ductum.yaml` `telegram.publicBaseUrl` →
   `ductum telegram webhook set`. Cheapest path; works today on any
   machine. Cost: a doc page and an operator-guide entry.

2. **Build the edictum-api Telegram relay.** edictum-api (the hosted
   audit/storage backend) becomes the public webhook target Telegram
   POSTs to. Local Ductum maintains a long-poll / SSE / websocket
   client connection to edictum-api so callbacks reach it without a
   tunnel. This is the proper long-term answer because it benefits
   every Ductum instance (operator never needs ngrok). Cost: a new
   spec covering relay endpoint, auth model, replay protection, and
   the local poll client. Likely a Stage-2-style multi-stage spec.

3. **Hosted Ductum approval surface.** Skip Telegram round-trip
   entirely and rely on the dashboard for tap-approval. Bot stays in
   the notify-only role. This is the current shipped behavior; D129
   only formalizes that "this is okay for now."

## Why

The recovery's dogma (D109) is that **the factory must be able to run
itself.** Tap-approval-from-Telegram is a developer-experience improvement
on top of a factory that already runs itself. Bot DMs already give the
operator the "you have an approval waiting" notification; the dashboard
already ships approval. Adding a tunnel dependency to the recovery's
exit demo would inflate the threshold for "ready" without making the
factory more capable.

The shipped wiring (D124's `notificationChannels` block, P4's
`/api/telegram/*` routes, the wizard panel) means this is a **config
gap, not a code gap.** The next operator who wants the round-trip can
flip a tunnel on without writing code.

## How to apply

When picking up this deferred work:

- Default to path 1 (operator-tunnel doc) unless there is an explicit
  reason to invest in the relay. Path 1 is hours; path 2 is days.
- Path 2 is the right call only if Ductum's hosted shape grows enough
  that "every operator needs ngrok to demo Telegram" becomes a
  meaningful adoption blocker. Until then, document path 1.
- Do **not** mark path 2 as a P4 follow-up. It is an
  edictum-api-side spec; raise it through that repo's planning hub.

## Non-goals

- No new top-level primitive for "webhook tunnels" inside Ductum.
- No silent behavior change to P4's shipped surfaces. Anything that
  alters `/api/telegram/*` routes or the wizard panel must be its own
  decision.
- No retroactive amendment to P4's exit demo wording. The demo is
  recorded honestly; this decision states why the round-trip portion
  was not exercised live.
