# 091 - Public URL Deploy Readiness

## Status

Accepted

## Context

After dispatcher startup was fixed, `ductum doctor --deploy` still marked
`https://factory.arnoldcartagena.com` as an OK public base URL because it only
validated URL shape. Running `ductum telegram webhook set` then failed with
Telegram's `Failed to resolve host` error. That means the deploy readiness check
can claim a public URL is ready while the notification setup path cannot use it.

## Decision

Make deploy doctor verify public URL DNS readiness:

- `ductum doctor --deploy` resolves the public base URL hostname with Node DNS
  before marking it OK.
- Unresolvable hostnames fail loudly with an operator-visible fix.
- Loopback and non-HTTPS URL failures keep their existing behavior.
- Doctor still does not call Telegram, store secrets, or become a webhook
  installer.
- This check is deploy-readiness only. Runtime notification delivery,
  NotificationChannel resources, Telegram webhook setup, and Edictum policy are
  unchanged.

## Why This Comes Next

The live factory can dispatch again, but deploy readiness is still blocked by
notification setup. The failed Telegram webhook command produced direct evidence
that the current doctor check missed a real deployment blocker.

## Non-Goals

- No Telegram API call from doctor.
- No DNS provider integration or tunnel management.
- No notification marketplace or new provider abstraction.
- No credential storage change.
- No new dependency.
- No new table, top-level primitive, Operation, or WorkOrder.
- No Edictum policy change or second policy system.
