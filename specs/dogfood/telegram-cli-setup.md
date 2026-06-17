# Dogfood: Telegram CLI setup

Implement a small operator-facing Telegram CLI surface so Ductum can be configured without curl.

Required behavior:

- Add `ductum telegram status` that prints `/api/telegram/status` in human and JSON form.
- Add `ductum telegram chats`.
- `telegram chats` should read a bot token from `--token-env` or `TELEGRAM_BOT_TOKEN`.
- Do not print the bot token.
- Call Telegram `getUpdates` and list unique chat ids with chat type/title/username when available.
- If there are no updates, print a clear instruction to send the bot a message first.
- Make network access injectable in tests.
- Add focused CLI tests.
- Keep every new file below 300 LOC.

Verification:

- `pnpm --filter @ductum/cli exec vitest run src/tests/telegram-command.test.ts`
- `pnpm --filter @ductum/cli build`
