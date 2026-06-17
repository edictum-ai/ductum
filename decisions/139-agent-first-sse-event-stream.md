# Decision 139: Agent-First SSE Event Stream

Date: 2026-05-03

## Status

Accepted.

## Context

D115 Gap 11 and D135 require an agent-consumable event surface. The existing
`/api/events/stream` endpoint is dashboard/watch-oriented: it streams raw
internal event objects, has no event ids, and cannot resume after a client
disconnect.

## Decision

Add `GET /api/events` as the D135 event stream. It emits SSE messages whose
`data` field is one schema envelope per event. Event ids are monotonic
process-local integers backed by an in-memory ring buffer on the core event
emitter.

`Last-Event-ID` resumes from that in-memory buffer. If the process restarted
or the id fell out of the buffer, Ductum resumes with live events only. This is
the simplest D135-compatible interpretation for the first reliability bundle;
durable event history is a later scaling concern.

The existing `/api/events/stream` endpoint remains unchanged for the dashboard
and `ductum watch` compatibility.

The new `ductum events` command connects to `/api/events`, sends the operator
token as `Authorization: Bearer <token>`, supports `--from` and `--filter`, and
prints NDJSON for structured modes. Human mode prints timestamped one-line
summaries.

## Consequences

- Agents can consume events without scraping dashboard-shaped payloads.
- Reconnects are safe within the in-memory event window.
- The dashboard does not need to migrate in this bundle.
- Durable event replay remains out of scope for D139.
