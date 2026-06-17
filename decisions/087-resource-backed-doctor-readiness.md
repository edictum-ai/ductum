# 087 - Resource-Backed Doctor Readiness

## Status

Accepted

## Context

NotificationChannel runtime backing is implemented, and Settings can now edit
NotificationChannel resources. Deployment readiness still leans on legacy
Telegram config fields in `ductum doctor`, especially `telegram.enabled` and
`telegram.publicBaseUrl`.

That can mislead an operator when `telegram.channelRef` points at a
NotificationChannel resource. The runtime may be resource-backed while the
doctor output still reports generic disabled Telegram state or misses the
channel-owned public base URL needed for webhook setup.

## Decision

Make `ductum doctor` and `ductum doctor --deploy` read the existing
resource-backed Telegram shape:

- `telegram.channelRef`
- `notificationChannels.<ref>.backend`
- `notificationChannels.<ref>.config.enabled`
- `notificationChannels.<ref>.config.publicBaseUrl`

Doctor remains a readiness reporter. It must not become a notification runtime,
provider marketplace, validator replacement, or policy system. Existing API
validation and Telegram runtime status remain authoritative for malformed or
missing channel refs.

## Why This Is Not Drift

This closes an operator-readiness gap created by decision `079`. It does not
change runtime delivery, add a provider, add a dependency, add a table, or move
policy into Ductum. It only makes existing CLI readiness output describe the
resource-backed runtime that already exists.

## Non-Goals

- No notification marketplace.
- No generic notification provider UI or plugin system.
- No runtime delivery change.
- No Edictum or policy behavior change.
- No new top-level primitive/table.
- No new dependency.
