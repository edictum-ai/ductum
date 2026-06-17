# Dogfood: Telegram webhook CLI setup

Make Telegram approvals deployable without curl or guessing Telegram API calls.

Required behavior:

- Add `ductum telegram webhook info`.
- Add `ductum telegram webhook set`.
- Add `ductum telegram webhook delete`.
- Read the bot token from `--token-env` or `TELEGRAM_BOT_TOKEN`; never accept or print a raw token argument.
- For `set`, use `--url <url>` when provided, otherwise use `/api/telegram/status.webhookUrl`; fail clearly if neither is available.
- For `set`, read the secret from `--secret-env` or `TELEGRAM_WEBHOOK_SECRET`; never print it.
- Call Telegram `getWebhookInfo`, `setWebhook`, and `deleteWebhook`.
- Show clear human output and JSON output.
- Make Telegram API access injectable in tests.
- Keep files below 300 LOC.

Verification:

- `pnpm --filter @ductum/cli exec vitest run src/tests/telegram-command.test.ts`
- `pnpm --filter @ductum/cli build`
