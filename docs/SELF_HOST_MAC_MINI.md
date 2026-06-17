# Self-Hosting On A Mac Mini

Target: `factory.arnoldcartagena.com` on `acartagena@10.0.0.137`.

The public alpha shape is:

- Ductum API listens on `127.0.0.1:4100`.
- Dashboard listens on `127.0.0.1:5176`, or the API serves the built dashboard.
- Cloudflare Tunnel exposes only HTTPS.
- Cloudflare Access protects dashboard/API paths.
- `/api/telegram/webhook` stays reachable by Telegram and is protected by `TELEGRAM_WEBHOOK_SECRET`.

Cloudflare references:

- macOS service install: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/
- Access self-hosted apps and paths: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/
- Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Bypass policy for public callback paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/

## 1. Prepare The Host

```bash
ssh acartagena@10.0.0.137
cd /Users/acartagena/project/ductum
git status -sb
pnpm install --frozen-lockfile
pnpm build
```

Initialize the Factory once (DB-only — creates `ductum.db` and
`.ductum/secrets.key`; there is no `ductum.yaml`):

```bash
node packages/cli/dist/index.js init --dir /Users/acartagena/project/ductum --no-login --no-browser --no-git
```

Create or update `.env.local` on the Mac mini. Do not commit it.

```bash
printf 'DUCTUM_OPERATOR_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env.local
printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.local
```

Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `ZAI_API_KEY` there as needed.

## 2. Run With Launchd

Create `~/Library/LaunchAgents/com.ductum.factory.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ductum.factory</string>
  <key>WorkingDirectory</key><string>/Users/acartagena/project/ductum</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/acartagena/project/ductum/packages/cli/dist/index.js</string>
    <string>start</string>
    <string>--dir</string>
    <string>/Users/acartagena/project/ductum</string>
    <string>--db</string>
    <string>/Users/acartagena/project/ductum/ductum.db</string>
    <string>--no-browser</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/acartagena/Library/Logs/ductum.out.log</string>
  <key>StandardErrorPath</key><string>/Users/acartagena/Library/Logs/ductum.err.log</string>
</dict>
</plist>
```

Start it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ductum.factory.plist
launchctl kickstart -k gui/$(id -u)/com.ductum.factory
tail -f ~/Library/Logs/ductum.err.log
```

Stop it:

```bash
launchctl bootout gui/$(id -u)/com.ductum.factory
```

Docker Compose remains valid for local development, but launchd keeps the Mac mini closer to how the harnesses already run on the host.

## 3. Cloudflare Tunnel

Create a locally managed tunnel in Cloudflare, then place this in `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /Users/acartagena/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: factory.arnoldcartagena.com
    service: http://127.0.0.1:4100
  - service: http_status:404
```

Route DNS:

```bash
cloudflared tunnel route dns <tunnel-name> factory.arnoldcartagena.com
cloudflared tunnel run <tunnel-name>
```

Install as a user service after the manual run works:

```bash
cloudflared service install
launchctl start com.cloudflare.cloudflared
```

## 4. Cloudflare Access

Create a self-hosted Access application for `factory.arnoldcartagena.com` and require your trusted users.

Create a second, more specific Access application for:

```text
factory.arnoldcartagena.com/api/telegram/webhook
```

Give that second app a `Bypass` policy for `Everyone`. This is intentional: Telegram cannot complete browser Access auth. Ductum still checks the webhook secret on that endpoint.

## 5. Telegram

Telegram configuration is runtime env state; the Settings page is read-only and
has no Telegram controls (Telegram-specific Settings are deferred to a later
stage). After the bot receives one message, discover the chat id through the
runtime API with your operator token:

```bash
curl -H "Authorization: Bearer $DUCTUM_OPERATOR_TOKEN" \
  http://127.0.0.1:4100/api/telegram/chats
```

Save the chat id into the `DUCTUM_TELEGRAM_CONFIG` JSON in `.env.local`, then
restart Ductum.

```bash
launchctl kickstart -k gui/$(id -u)/com.ductum.factory
```

## 6. Backups

Back up:

- `/Users/acartagena/project/ductum/ductum.db`
- `/Users/acartagena/project/ductum/.ductum/secrets.key` (back this up with the
  DB — without it, encrypted secrets in the DB are unrecoverable)
- `/Users/acartagena/project/ductum/.env.local`
- the Repositories registered in Factory Settings
- `.ductum/` if you need active worktree recovery

SQLite backup while Ductum is running:

```bash
sqlite3 ductum.db ".backup 'backups/ductum-$(date +%Y%m%d-%H%M%S).db'"
```

Keep backups outside the repo or in an ignored `backups/` directory.

## 7. Deployment Doctor

Run this on the Mac mini:

```bash
alias ductum="node /Users/acartagena/project/ductum/packages/cli/dist/index.js"
ductum repair
ductum status
```

It checks the Factory readiness path and shows the current Project,
Repository, Spec, Task, Attempt, approval, and repair state.
