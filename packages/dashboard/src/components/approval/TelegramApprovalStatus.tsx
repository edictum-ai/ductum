import type { TelegramStatus } from '@/api/client'
import { Card, Mono, tokens } from '@/components/signal'

export function TelegramApprovalStatus({
  status,
  loading,
  error,
}: {
  status: TelegramStatus | undefined
  loading: boolean
  error: boolean
}) {
  const missing = status?.missing ?? []
  const hasWebhook = status?.webhookUrl != null && status.webhookUrl.trim() !== ''
  const needsConfig = !loading && !error && status?.configured === false && missing.length > 0
  const title = loading
    ? 'Checking Telegram runtime'
    : error
      ? 'Telegram status unavailable'
      : needsConfig
        ? `Telegram waiting for ${missing.join(', ')}`
      : status?.enabled && hasWebhook
        ? 'Telegram approvals active'
        : status?.enabled
          ? 'Telegram runtime enabled, webhook not set'
          : 'Telegram approvals offline'

  const body = loading
    ? 'Local approve and reject controls remain available while status loads.'
    : error
      ? 'Use the dashboard buttons below or CLI fallback until the API status endpoint responds.'
      : needsConfig
        ? `Message the bot once, discover the chat id in Factory Settings, save ${missing.join(', ')}, restart, then set the webhook.`
      : status?.enabled && hasWebhook
        ? `Webhook: ${status.webhookUrl}`
        : status?.enabled && missing.length > 0
          ? `Missing ${missing.join(', ')}. Message the bot once, discover the chat id in Factory Settings, save it, restart, then set the webhook.`
          : status?.enabled
            ? 'Set the webhook after your public HTTPS origin reaches this API.'
            : 'Use the dashboard buttons below or CLI fallback until Telegram is configured.'

  return (
    <div data-testid="telegram-approval-status">
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: tokens.strong }}>{title}</div>
          <div style={{ fontSize: 13, color: tokens.mid, lineHeight: 1.5 }}>{body}</div>
          <Mono size={11.5} color={tokens.dim}>
            CLI fallback: ductum approve &lt;attemptId&gt; · ductum deny &lt;attemptId&gt; --reason &lt;reason&gt;
          </Mono>
        </div>
      </Card>
    </div>
  )
}
