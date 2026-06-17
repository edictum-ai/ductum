# P1 - NotificationChannel Runtime Backing

## Scope

Make `NotificationChannel` resources drive the existing Telegram approval
notification path when `telegram.channelRef` is configured. Preserve legacy
Telegram env/config behavior when no channel ref is configured.

## Decision Trace

- Decisions: `053`, `055`, `057`, `058`, `059`, `060`, `064`, `066`, `079`.
- Non-goals: no notification marketplace; no generic provider plugin system;
  no fake provider branches; no second policy engine; no Edictum policy change;
  no Operation or WorkOrder table; no new top-level primitive or table; no new
  dependency.
- Allowed scope: `telegram.channelRef` resolution, Telegram-compatible channel
  config validation, approval notification send/skip/fail evidence, status and
  operator brief output, settings validation, and behavioral tests.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding new providers, a
  provider plugin system, a notification table, a second policy engine, new
  dependency, or any Edictum policy change.

## Behavior Contract

- A `NotificationChannel` resource with `backend: telegram` must resolve at
  runtime to the existing Telegram send path and keep existing approval message
  text, parse mode, callback data, and reply markup semantics.
- Missing `telegram.channelRef` targets must fail in CLI/API/operator-visible
  output before claiming delivery.
- Wrong-kind `telegram.channelRef` targets must fail in CLI/API/operator-visible
  output.
- Ambiguous `telegram.channelRef` targets must fail in CLI/API/operator-visible
  output.
- Malformed Telegram channel resources missing required Telegram fields must
  fail loudly with operator-visible errors.
- `config.enabled: false` on a referenced channel must skip delivery visibly and
  must not call Telegram.
- When `telegram.channelRef` is configured, legacy Telegram credentials,
  `enabled`, and `publicBaseUrl` must not be accepted as fallback or shadow
  config.
- Operator status output must report missing, wrong-kind, ambiguous, malformed,
  and disabled channel runtime states instead of hiding them in logs.
- A configured bad channel resource must never silently fall back to legacy
  no-channel runtime behavior.
- Legacy Telegram env/config behavior must be preserved when
  `telegram.channelRef` is absent.
- Telegram send failures must record run evidence or return visible status; they
  must not be logs-only.
- The slice must not add a notification marketplace, fake provider branch,
  second policy engine, Edictum policy change, new top-level primitive/table, or
  dependency.

## Implementation Notes

- Extend `TelegramConfig` with optional `channelRef`.
- Resolve channel refs inside the existing Telegram notifier/status path, not
  through a second notification pipeline.
- Keep the active resource schema to `NotificationChannelSpec.backend` and
  `spec.config`.
- Support only `backend: telegram` at runtime; malformed or unsupported
  configured channels should fail loudly.
- Use existing evidence records for notification send, skip, and fail states.
- Keep webhook callbacks using the same resolved Telegram credentials so
  resource-backed channels can approve/deny exactly like legacy config.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are missing, wrong-kind, ambiguous, and malformed channel refs loud?
- Did a configured bad channel ever fall back to legacy Telegram config?
- Did disabled channel delivery skip without calling Telegram and with visible
  evidence/status?
- Did this duplicate Telegram send or config parsing logic?
- Did this add dead future-provider branches?
- Did legacy no-ref Telegram behavior still send as before?

## Verification

```sh
ductum spec contract-check ductum specs/current/notification-channel-runtime --path
ductum spec drift-review ductum notification-channel-runtime
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
