# 079 - NotificationChannel Runtime Backing

## Status

Accepted

## Context

Decision `055` introduced `NotificationChannel` resources, and the factory
resource model already stores them as config resources. Telegram approval
notifications are working legacy behavior, but runtime notification selection
does not yet use `NotificationChannel`.

The next useful step is making configured notification channels meaningful
without turning this into a provider marketplace.

## Decision

Allow the Telegram runtime config to opt into a `NotificationChannel` by setting
`telegram.channelRef`.

- `telegram.channelRef` resolves to a factory-scoped `NotificationChannel`
  config resource by id or name.
- The only runtime-active backend in this slice is `telegram`.
- A Telegram channel uses `spec.config` for the same fields as legacy Telegram
  config: `botToken`, `chatId`, `webhookSecret`, `publicBaseUrl`, and optional
  `enabled`.
- When `telegram.channelRef` is set, channel-owned fields must come from the
  resource; mixing the ref with legacy credentials, `enabled`, or
  `telegram.publicBaseUrl` is a configuration error.
- `spec.config.enabled: false` disables delivery and must record a visible
  skipped notification state.
- The historical shell-only `events` field is removed from active
  `NotificationChannel` validation because this slice has no event-routing
  marketplace; existing examples must use `backend: telegram` with `config`.
- Missing, wrong-kind, ambiguous, or malformed referenced channels fail loudly
  before Ductum claims delivery.
- Send failures are recorded on the run as evidence and remain visible to API,
  CLI, and operator output through existing evidence/status surfaces.
- When no `telegram.channelRef` is configured, legacy Telegram env/config
  behavior continues unchanged.

## Why This Is Not Drift

This implements the smallest runtime use of the existing `NotificationChannel`
resource shell. It does not add a notification marketplace, plugin system,
second policy engine, new table, new dependency, or any Edictum policy change.

## Non-Goals

- No notification marketplace.
- No generic provider plugin system.
- No fake provider branches for future channels.
- No second policy engine.
- No Edictum policy change.
- No new top-level primitive or table.
- No new dependency.
