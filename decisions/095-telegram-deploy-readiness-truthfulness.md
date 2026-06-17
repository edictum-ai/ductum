# 095 - Telegram Deploy Readiness Truthfulness

## Status

Accepted

## Context

After chat-discovery errors became actionable, `ductum doctor --deploy` still
reported `telegram webhook: webhook not set` while Telegram's own webhook info
showed the expected public webhook URL. The API runtime could not expose a
webhook URL because `TELEGRAM_CHAT_ID` was still missing, not because the
operator had failed to register the webhook.

The same doctor output also used dev-shell wording such as `restart pnpm serve`
in Telegram recovery guidance, which is too narrow for deployment operators.

## Decision

Keep deploy doctor read-only and API-backed:

- Do not call Telegram from `doctor --deploy`.
- Do not delete, set, or mutate Telegram webhooks from doctor.
- When Telegram runtime is blocked only by chat id discovery, report webhook
  status as pending/warn instead of falsely claiming the webhook is unset.
- Keep `webhook not set` as a failure when runtime is otherwise active and no
  webhook URL is known.
- Use deployment-neutral wording: restart the Ductum API, not `pnpm serve`, in
  Telegram readiness guidance.

## Why This Comes Next

The public URL and webhook registration path works, but the operator-facing
readiness report is misleading during the chat id bootstrap step. Fixing this
keeps the deployment loop truthful without widening Ductum into a Telegram
control plane.

## Non-Goals

- No Telegram API calls from doctor.
- No automatic webhook mutation.
- No new config source, table, dependency, provider branch, or policy behavior.
- No change to Telegram send/webhook runtime behavior.
