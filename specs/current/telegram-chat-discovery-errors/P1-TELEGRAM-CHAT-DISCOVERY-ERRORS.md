# P1 - Telegram Chat Discovery Errors

Make Telegram chat discovery failures actionable.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `091`,
  `093`, and `094`.
- Non-goals: no new table, chat registry, automatic webhook deletion, provider
  abstraction, dependency, Edictum change, or second policy system.
- Allowed scope: CLI Telegram chat/setup output, tests, dogfood records, and
  evidence.
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

## Implementation Notes

- Extend the Telegram updates response type with `description`.
- Keep successful chat table output unchanged.
- Add active-webhook guidance without invoking webhook delete.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are behavioral tests present for generic Telegram errors and active-webhook
  errors?
- Did reviewers attack shape-correct but behavior-empty error messaging?
- Did output avoid token/secret leakage?
- Did it avoid automatic webhook mutation and chat storage?
- Did it preserve existing successful chat discovery output?

## Verification

```sh
ductum spec contract-check ductum specs/current/telegram-chat-discovery-errors --path
ductum spec drift-review ductum telegram-chat-discovery-errors
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
