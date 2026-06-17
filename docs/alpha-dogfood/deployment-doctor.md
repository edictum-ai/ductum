# Deployment Readiness: Alpha Dogfood

Quick checklist for Mac mini -> Cloudflare deployment. Verify with the current
operator path:

```bash
alias ductum="node /Users/acartagena/project/ductum/packages/cli/dist/index.js"
ductum repair
ductum status
```

## 1. Mac Mini Hosting

- Factory runs via launchd (`com.ductum.factory`).
- API binds to `127.0.0.1:4100` only.
- The API serves the built dashboard.
- Verify: `launchctl list | grep ductum` shows the service running.

## 2. Cloudflare Tunnel

- Tunnel routes `factory.arnoldcartagena.com` -> `http://127.0.0.1:4100`.
- Tunnel daemon runs as `com.cloudflare.cloudflared` (launchd service).
- Verify: `cloudflared tunnel info <name>` shows `healthy`.

## 3. Cloudflare Access

- Main Access app protects all of `factory.arnoldcartagena.com`.
- A second, more specific app covers `/api/telegram/webhook` with a Bypass
  policy. Telegram cannot complete browser auth; Ductum verifies the webhook
  secret instead.

## 4. Telegram

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
  `TELEGRAM_WEBHOOK_SECRET` must be set in `.env.local` or Factory Settings.
- Use Factory Settings to discover the chat id after the bot receives one
  message.
- Restart after any `.env.local` change:
  `launchctl kickstart -k gui/$(id -u)/com.ductum.factory`.

## 5. Operator Token

- `DUCTUM_OPERATOR_TOKEN` must be set in `.env.local` on the Mac mini.
- CLI callers need `export DUCTUM_OPERATOR_TOKEN=<same value>` in their shell.
- Generate with: `openssl rand -hex 32`.
- Never commit `.env.local` or print the token in logs.

## 6. SQLite Backup

```bash
sqlite3 ductum.db ".backup 'backups/ductum-$(date +%Y%m%d-%H%M%S).db'"
```

- Back up `ductum.db`, `.ductum/secrets.key`, and `.env.local` together regularly. Losing the key makes encrypted secrets unrecoverable (D170).
- Store backups outside the repo or in an ignored `backups/` directory.

## Remaining Production Risks

| Risk | Status | Notes |
|------|--------|-------|
| Single-host SPOF | Open | Mac mini is the only host; no failover. |
| No automated SQLite backup | Open | Manual `sqlite3 .backup` only; no cron job yet. |
| `.env.local` not rotated | Open | Secrets are static; no rotation policy. |
