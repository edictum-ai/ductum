import type { Hono } from 'hono'
import { log, redactPublicText } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { WebhookApprovalNotifier } from '../lib/webhook.js'

export function registerNotificationRoutes(_app: Hono, context: ApiContext) {
  const webhookNotifier = new WebhookApprovalNotifier(context)

  context.events.subscribe((event) => {
    if (event.type !== 'approval.requested') return
    void webhookNotifier.send({ kind: 'approval.requested', runId: event.runId }).catch((error) => {
      const message = redactPublicText(error instanceof Error ? error.message : String(error))
      log.warn('webhook', `approval notification failed: ${message}`)
    })
  })
}
