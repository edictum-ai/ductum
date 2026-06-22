# Telegram Chat Discovery Errors

## Intake

`ductum telegram chats` currently hides Telegram `getUpdates` errors behind a
generic message. Once a webhook is active, this blocks chat id bootstrap because
Telegram requires the webhook to be deleted before polling updates.

## Grill Questions

- Should Ductum delete the webhook automatically? No. Webhook deletion is an
  explicit operator command.
- Should Ductum store discovered chats? No. Existing CLI output is enough.
- What is the smallest useful fix? Show Telegram's error description and a
  precise next step when polling is blocked by an active webhook.
- What remains unchanged? Telegram runtime delivery, webhook setup behavior,
  notification resources, and Edictum policy.

## Decisions

- Add decision `094` for actionable Telegram chat discovery errors.
- Preserve explicit webhook setup/delete commands.
- Surface Telegram error descriptions without leaking bot tokens.
- Add webhook-active guidance for chat id bootstrap.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `091`,
  `093`, and `094`.
- Non-goals: no new table, chat registry, automatic webhook deletion, provider
  abstraction, dependency, Edictum change, or second policy system.
- Allowed scope: CLI Telegram chat/setup output, tests, dogfood records, and
  evidence.
- Verification: `ductum spec contract-check ductum specs/current/telegram-chat-discovery-errors --path`,
  `ductum spec drift-review ductum telegram-chat-discovery-errors`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  adversarial slop review.
- Drift handling: record a new decision before deleting webhooks automatically,
  storing chat ids, adding dependencies, or changing notification delivery.

## Behavior Contract

- CLI `telegram chats` must fail loudly when Telegram `getUpdates` returns
  `ok: false`.
- CLI `telegram chats` generic Telegram API errors must include an
  operator-visible failure message.
- CLI `telegram chats` must include Telegram's error description when present.
- CLI `telegram chats` must include webhook-active recovery guidance when the
  Telegram error mentions an active webhook.
- CLI `telegram chats` active-webhook errors must tell the operator to run
  `ductum telegram webhook delete` before polling updates.
- CLI `telegram setup` must preserve non-throwing setup output when chat
  discovery fails.
- CLI `telegram setup` must include Telegram's error description when discovery
  fails.
- CLI `telegram setup` active-webhook output must preserve an operator-visible
  next step for chat id bootstrap.
- CLI successful chat discovery output must preserve the existing chat table.
- CLI output must not leak bot tokens, webhook secrets, or chat ids that were
  not returned as discovered chat ids.
- CLI JSON/error output must preserve parseable failure behavior for automation.
- CLI runtime behavior must not delete or set webhooks automatically.
- CLI runtime behavior must not store chat ids or add a chat registry.
- Telegram runtime send/webhook behavior must remain unchanged.
- CLI runtime behavior must not add dependencies, tables, provider branches, or policy
  behavior.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are behavioral tests present for generic Telegram errors and active-webhook
  errors?
- Did reviewers attack shape-correct but behavior-empty error messaging?
- Did output avoid token/secret leakage?
- Did it avoid automatic webhook mutation and chat storage?
- Did it preserve existing successful chat discovery output?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-TELEGRAM-CHAT-DISCOVERY-ERRORS.md](P1-TELEGRAM-CHAT-DISCOVERY-ERRORS.md) | cli | Telegram chat discovery errors, setup output, tests, evidence | [x] | - |

## Dogfood Record

- Imported spec `1F_NyNX5z-i1`.
- Imported task `NEJZERscAu7C`.
- Dogfood run `4_4-yNdHX0f2`.
- Recorded decision `w_0MRzLDZ2A-`.
- Recorded evidence:
  - `a12lvFjZJJMO`: spec contract check.
  - `nH1XK5svZzP_`: first CLI test pass.
  - `Q278eb0KBVJF`: core/API test pass.
  - `2-pEAj9VaHkQ`: live smoke before review fixes.
  - `jzLBiH_aSMi-`: first build and diff pass.
  - `rz_EKb4cGiyB`: final CLI test pass with slop-review coverage fixes.
  - `6fXNB4fRISLJ`: final build, spec, drift, and diff pass.
  - `vC0Hwh1VRT3p`: Claude slop review PASS with caveats, fixes applied.
  - `XW4bcL-XAKFz`: final live Telegram smoke.
- Drift: none for this slice. Claude noted adjacent pre-existing transport and
  webhook-command redaction risks for a follow-up slice.

## Verification

```sh
ductum spec contract-check ductum specs/current/telegram-chat-discovery-errors --path
ductum spec drift-review ductum telegram-chat-discovery-errors
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
