# Notification Backends

**Date:** 2026-04-26

## Decision

Telegram is the first notification and approval backend, not the notification
system itself. Ductum should model notifications as pluggable channels.

## Resource

```yaml
apiVersion: ductum.ai/v1
kind: NotificationChannel
metadata:
  name: founder-telegram
spec:
  backend: telegram
  config:
    botTokenRef: secret:telegram-bot-token
    chatIdRef: secret:telegram-chat-id
    webhookSecretRef: secret:telegram-webhook-secret
  events:
    - approval.requested
    - spec.completed
    - run.failed
```

## Backend Interface

```ts
interface NotificationBackend {
  id: string;
  send(message: NotificationMessage): Promise<NotificationResult>;
  supportsActions(): boolean;
  handleAction?(input: NotificationActionInput): Promise<NotificationActionResult>;
}
```

Message types:

- approval requested
- approval resolved
- run failed
- run stalled
- spec completed
- fan-out child blocked
- final coordinated merge ready
- deployment or doctor failure

Action types:

- approve
- deny
- retry run
- close dead run
- skip target
- request amendment
- approve coordinated merge

## Backends

Initial:

- `telegram`: interactive approval actions.
- `webhook`: signed event delivery.
- `local`: dashboard/CLI-only notifications.

Later:

- Slack
- email
- GitHub issue or PR comment
- desktop push

## Telegram Setup UX

Telegram setup must not be mysterious. The UI and CLI should present a checklist:

1. Bot token is saved.
2. User sends a message to the bot.
3. Ductum discovers the chat id.
4. Public base URL is configured.
5. Webhook is installed.
6. Test message succeeds.

Do not expose the bot token in logs, UI, or summaries.

## Approval Boundary

Notification channels transport decisions. They do not decide policy.

Ductum records the decision. Edictum enforces whether the action is now allowed.

## Next Step

Keep the current Telegram implementation, but wrap it in a backend interface and
store channel config as a declarative resource.
