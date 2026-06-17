# Resource-Backed Doctor Readiness

## Intake

Make deployment readiness checks understand NotificationChannel-backed Telegram
config. Runtime channel delivery already works, but `ductum doctor` still reads
mostly legacy Telegram settings and can give misleading deployment guidance for
`telegram.channelRef`.

## Grill Questions

- Is this a notification runtime change? No. Runtime delivery and Telegram
  status remain unchanged.
- Should doctor validate channel refs itself? No. Existing API validation and
  Telegram status stay authoritative.
- Should this add provider discovery? No. Only the existing Telegram-backed
  NotificationChannel shape is in scope.
- Should disabled channels block deploy readiness? No. They should be visible as
  skipped/disabled rather than silently reported as generic legacy disabled
  Telegram.

## Decisions

- Add decision `087` for resource-backed doctor readiness.
- Read `telegram.channelRef` and the referenced `notificationChannels` entry
  only to report readiness and next commands.
- Keep malformed/missing refs loud through existing API validation and Telegram
  status surfaces.
- Preserve legacy Telegram readiness behavior when no channel ref is configured.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `086`, `087`.
- Non-goals: no notification marketplace; no provider plugin system; no runtime
  behavior change; no Edictum or policy behavior change; no new
  primitive/table; no new dependency.
- Allowed scope: CLI doctor readiness checks, CLI tests, spec records,
  evidence, and adversarial review.
- Verification: contract-check, drift-review, `pnpm --filter @ductum/cli test`,
  `pnpm build`, `git diff --check`, and slop review.
- Drift handling: record a decision before adding providers, runtime delivery
  behavior, a dependency, a table, or policy behavior.

## Behavior Contract

- `ductum doctor` runtime readiness must treat `telegram.channelRef` with an enabled Telegram NotificationChannel as intended notification config.
- A disabled NotificationChannel resource must be visible as a skipped/disabled doctor output state, not silently collapsed into generic legacy disabled Telegram output.
- `ductum doctor --deploy` output must visibly resolve `notificationChannels.<ref>.config.publicBaseUrl` for public base URL readiness and webhook setup commands.
- Missing or malformed referenced channels must fail visibly through existing API validation or Telegram status output, not logs only.
- Legacy Telegram config output must be preserved for `telegram.enabled` and `telegram.publicBaseUrl` when no channel ref is configured.
- Doctor must not duplicate NotificationChannel runtime delivery or API resolution logic.
- Doctor must not add provider marketplace branches, a plugin system, a second policy system, a new table, or a dependency.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did behavioral tests prove channel-backed readiness avoids generic disabled Telegram output?
- Did behavioral tests prove deploy webhook guidance uses the channel-owned public base URL?
- Did missing or invalid inputs stay loud through existing API/status surfaces without swallowed errors?
- Did legacy Telegram readiness still behave the same?
- Did the implementation avoid duplicate resolution logic, runtime delivery changes, and provider branches?
- Did it avoid policy behavior, dead config branches, and new dependencies?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-RESOURCE-BACKED-DOCTOR-READINESS.md](P1-RESOURCE-BACKED-DOCTOR-READINESS.md) | cli | Doctor readiness for NotificationChannel-backed Telegram config | [x] | - |

## Dogfood Record

- Spec imported as `qUUtUKnIDQrH`.
- Task imported as `-yImvlTO5NTA`.
- Implementation run accepted as `G7VwXG4LjetI`.
- Decision record: `vkjx6zV4ctM9`.
- Spec audit evidence: `gXIWzcPSIc_w`.
- Verification evidence: `Z3SAy59KUKru`.
- Review evidence: `SrxCdembL80X` (`claude -p` produced no stdout and was
  killed after the bounded review timeout; local slop review completed).

## Verification

```sh
ductum spec contract-check ductum specs/current/resource-backed-doctor-readiness --path
ductum spec drift-review ductum resource-backed-doctor-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```

Status: implemented and verified; external Claude reviewer unavailable in this
session, with failed review attempt recorded as evidence.
