# NotificationChannel Runtime

## Intake

Back the existing Telegram notification path with declarative
`NotificationChannel` resources while preserving legacy Telegram config when no
channel resource is referenced.

## Grill Questions

- What chooses a channel? `telegram.channelRef` opts the existing Telegram path
  into a `NotificationChannel`; no ref keeps legacy env/config behavior.
- Which providers are active? Only `backend: telegram` is active in this slice.
  Disabled behavior is `config.enabled: false`, not a new provider branch.
- Where do loud failures show up? Status/brief output must report bad channel
  configuration, and run notification attempts must record evidence before
  errors are surfaced.
- Is a new delivery table needed? No. Existing run evidence is enough for this
  slice.

## Decision Trace

- Decisions: `053`, `055`, `057`, `058`, `059`, `060`, `064`, `066`, `079`.
- Non-goals: no notification marketplace; no generic provider plugin system;
  no fake provider branches; no second policy engine; no Edictum policy change;
  no Operation or WorkOrder table; no new top-level primitive or table; no new
  dependency.
- Allowed scope: Telegram channel ref resolution, Telegram status/brief wiring,
  approval notification send/skip/fail evidence, settings validation, CLI/API
  output, behavioral tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/notification-channel-runtime --path`,
  `ductum spec drift-review ductum notification-channel-runtime`, package
  tests, build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding a provider marketplace,
  generic plugin system, new notification table, second policy engine,
  dependency, or Edictum policy change.

## Behavior Contract

- A `NotificationChannel` resource with `backend: telegram` must resolve at
  runtime to the existing Telegram send path without changing message
  semantics.
- Missing referenced notification channel resource refs must fail loudly before claiming
  notification delivery.
- Wrong-kind referenced resource refs must fail loudly.
- Ambiguous referenced resource refs must fail loudly.
- Malformed Telegram channel resources must fail loudly with operator-visible
  errors.
- Disabled notification channel resources must not send messages and must record or
  return a visible skipped state.
- When `telegram.channelRef` is set, `enabled`, credentials, and
  `publicBaseUrl` must be owned by the referenced channel resource, not mixed
  with legacy Telegram config.
- Operator status output must report missing, wrong-kind, ambiguous, malformed,
  and disabled channel runtime states instead of hiding them in logs.
- A configured bad channel resource must never silently fall back to legacy
  no-channel runtime behavior.
- Legacy Telegram env/config behavior must be preserved when no
  notification channel resource is configured.
- Configured channel send failures must be operator-visible and not logs-only.
- Notification send, skip, and fail states must be visible through API/CLI
  output or recorded run evidence.
- The implementation must not add a notification marketplace, generic provider
  plugin system, second policy engine, new dependency, or new top-level
  primitive/table.

## Slop Review

- Did the implementation satisfy every Behavior Contract item?
- Are tests behavioral, not just shape checks?
- Are missing, wrong-kind, ambiguous, and malformed channels loud failures?
- Did any path silently skip a configured channel?
- Did it duplicate Telegram config or send logic?
- Did it add fake provider branches for a future marketplace?
- Did it preserve legacy Telegram behavior when no channel resource is
  configured?
- Did send failures remain operator-visible?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-NOTIFICATION-CHANNEL-RUNTIME.md](P1-NOTIFICATION-CHANNEL-RUNTIME.md) | api/cli | Telegram-backed `NotificationChannel` runtime selection, visible send states, tests, dogfood | [x] | - |

## Dogfood Record

- Imported Ductum spec: `notification-channel-runtime` (`AFnF7zSpatcc`)
- Imported P1 task: `P1-NOTIFICATION-CHANNEL-RUNTIME` (`D11DqPeNRUTb`)
- Accepted run: `GW4mXN0jG3F4`
- Recorded decision: `zQ2L0YRwfj1e`
- Spec audit evidence: `uI0RTJbL3tUE`
- Final verification evidence: `Y5Gy1aZUVvG1`
- Claude slop review evidence: `4Zzjhv7xg_tn`
- Final combined evidence: `wR0zFpWr8OPG`

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
