# P1 - Resource-Backed Doctor Readiness

## Scope

Update `ductum doctor` readiness reporting so NotificationChannel-backed
Telegram config is represented accurately in normal and deploy modes.

Do not change notification runtime delivery, provider support, policy behavior,
or settings validation.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `086`, `087`.
- Non-goals: no notification marketplace; no provider plugin system; no runtime
  behavior change; no Edictum or policy behavior change; no new
  primitive/table; no new dependency.
- Allowed scope: CLI doctor readiness helpers, CLI tests, dogfood records, and
  review artifacts.
- Verification: contract-check, drift-review, `pnpm --filter @ductum/cli test`,
  `pnpm build`, `git diff --check`, and slop review.
- Drift handling: record a decision before adding providers, runtime delivery
  behavior, dependency, table, or policy behavior.

## Behavior Contract

- `ductum doctor` runtime readiness must treat `telegram.channelRef` with an enabled Telegram NotificationChannel as intended notification config.
- A disabled NotificationChannel resource must be visible as a skipped/disabled doctor output state, not silently collapsed into generic legacy disabled Telegram output.
- `ductum doctor --deploy` output must visibly resolve `notificationChannels.<ref>.config.publicBaseUrl` for public base URL readiness and webhook setup commands.
- Missing or malformed referenced channels must fail visibly through existing API validation or Telegram status output, not logs only.
- Legacy Telegram config output must be preserved for `telegram.enabled` and `telegram.publicBaseUrl` when no channel ref is configured.
- Doctor must not duplicate NotificationChannel runtime delivery or API resolution logic.
- Doctor must not add provider marketplace branches, a plugin system, a second policy system, a new table, or a dependency.

## Implementation Notes

- Add small CLI-side readers for Telegram channel intent and channel-owned
  public base URL. They should only inspect the already-loaded settings config.
- Keep API validation and `/api/telegram/status` as the loud failure source for
  missing, malformed, wrong-kind, or incomplete channel refs.
- Preserve the current legacy branch when `telegram.channelRef` is absent.
- Tests should assert rendered JSON/text status and exact webhook setup command,
  not just helper shape.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did behavioral tests prove channel-backed readiness avoids generic disabled Telegram output?
- Did behavioral tests prove deploy webhook guidance uses the channel-owned public base URL?
- Did missing or invalid inputs stay loud through existing API/status surfaces without swallowed errors?
- Did legacy Telegram readiness still behave the same?
- Did the implementation avoid duplicate resolution logic, runtime delivery changes, and provider branches?
- Did it avoid policy behavior, dead config branches, and new dependencies?

## Verification

```sh
ductum spec contract-check ductum specs/current/resource-backed-doctor-readiness --path
ductum spec drift-review ductum resource-backed-doctor-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
