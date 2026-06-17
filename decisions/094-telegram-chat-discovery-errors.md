# 094 - Telegram Chat Discovery Errors

## Status

Accepted

## Context

After the factory webhook was registered, `ductum telegram chats` failed with
only `Telegram API returned an error`. Telegram polling via `getUpdates` is not
available while a webhook is active, so this generic error blocks chat id
bootstrap even though the next operator action is known.

## Decision

Make Telegram chat discovery errors actionable:

- Surface Telegram's `description` in CLI output.
- When Telegram says a webhook is active, tell the operator to delete the
  webhook, message the bot, run chat discovery, set `TELEGRAM_CHAT_ID`, restart
  Ductum, and set the webhook again.
- Keep webhook setup/deletion as explicit operator commands.
- Do not store chat ids or create a Telegram chat registry in this slice.

## Why This Comes Next

DNS and webhook setup now work. The remaining deployment blocker is chat id
bootstrap, and the current CLI hides the exact Telegram error needed to proceed.

## Non-Goals

- No new table or chat registry.
- No automatic webhook deletion.
- No Telegram marketplace or provider abstraction.
- No new dependency.
- No Edictum policy change or second policy system.
