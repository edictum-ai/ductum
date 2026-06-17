# P1 - Telegram Deploy Readiness Truthfulness

Make deploy doctor truthful during Telegram chat id bootstrap.

## Decision Trace

- Decisions: `055`, `058`, `059`, `060`, `064`, `066`, `079`, `087`, `091`,
  `093`, `094`, and `095`.
- Non-goals: no Telegram API calls from doctor, webhook mutation, new table,
  dependency, provider branch, Edictum change, or second policy system.
- Allowed scope: CLI doctor readiness messages, deploy webhook check
  classification, tests, dogfood records, and evidence.
- Drift handling: record a new decision before doctor calls Telegram, mutates
  webhooks, stores chat state, or changes notification runtime behavior.

## Behavior Contract

- CLI `doctor --deploy` must not report `telegram webhook: webhook not set` solely
  because Telegram runtime is waiting for `chatId`.
- CLI `doctor --deploy` must still fail loudly on missing `TELEGRAM_CHAT_ID` through
  runtime/env checks.
- CLI `doctor --deploy` must fail loudly when Telegram runtime is enabled but no
  webhook URL is known and no chat-id-bootstrap blocker explains it.
- CLI `doctor --deploy` must mark the webhook check as pending/warn when webhook
  status cannot be trusted until chat id bootstrap finishes.
- CLI `doctor --deploy` must preserve the existing `webhook not set` failure when
  Telegram runtime is otherwise active and no webhook URL is known.
- CLI `doctor --deploy` must preserve mismatch warning behavior when a known
  webhook URL differs from the expected public URL.
- Telegram readiness fixes must say to restart the Ductum API, not `pnpm serve`.
- Chat id bootstrap guidance must point operators at `ductum telegram chats`
  and the explicit webhook-delete recovery path when polling is blocked.
- CLI doctor must not call Telegram APIs directly.
- CLI doctor must not set or delete Telegram webhooks.
- CLI doctor must not silently downgrade missing chat id runtime/env failures.
- CLI doctor must not swallow API errors from Telegram runtime status into a passing
  deploy report.
- Output must not leak bot tokens, webhook secrets, operator tokens, or chat ids
  beyond already operator-provided/discovered values.
- The slice must not change Telegram send/webhook runtime behavior.
- The slice must not add dependencies, tables, provider branches, or policy
  behavior.
- Tests must prove behavior, not only output shape.

## Implementation Notes

- Keep CLI `doctor --deploy` backed by API runtime status and local config.
- Add behavioral tests around the chat-id-bootstrap pending webhook state.
- Keep `telegram webhook info` as the explicit command for direct Telegram
  webhook inspection.

## Slop Review

- Did every Behavior Contract item get behavioral tests or explicit evidence?
- Are tests behavioral, not just shape checks?
- Did reviewers attack shape-correct but behavior-empty doctor output?
- Does deploy doctor remain read-only and free of Telegram API calls?
- Are missing chat id failures still loud?
- Are API/runtime status errors still loud failures?
- Did the webhook check stop lying while preserving true webhook failures?
- Did tests assert behavior and not only message shape?
- Did any path mutate Telegram webhook state?
- Did any path silently pass deploy readiness with missing chat id?
- Did output avoid secret leakage?

## Verification

```sh
ductum spec contract-check ductum specs/current/telegram-deploy-readiness-truthfulness --path
ductum spec drift-review ductum telegram-deploy-readiness-truthfulness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
