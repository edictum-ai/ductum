import { redactPublicText, type ConfigResource, type RunId } from '@ductum/core'

import type {
  NotificationBackend,
  NotificationDeliveryResult,
  NotificationMessage,
} from './notification-backends.js'
import type { ApiContext } from './deps.js'
import {
  computeWebhookSignature,
  listFactoryWebhookChannels,
  recordWebhookDelivery,
  webhookConfigFromChannel,
} from './webhook-runtime.js'

const SIGNATURE_HEADER_PREFIX = 'sha256='
const TIMESTAMP_HEADER = 'x-ductum-timestamp'
const SIGNATURE_HEADER = 'x-ductum-signature'

export class WebhookApprovalNotifier implements NotificationBackend {
  readonly id = 'webhook'

  constructor(private readonly context: ApiContext) {}

  async send(message: NotificationMessage): Promise<NotificationDeliveryResult<'sent' | 'skipped'>> {
    return this.notifyApprovalRequested(message.runId)
  }

  supportsActions(): boolean {
    return false
  }

  async notifyApprovalRequested(runId: RunId): Promise<NotificationDeliveryResult<'sent' | 'skipped'>> {
    const run = this.context.repos.runs.get(runId)
    if (run == null || !run.pendingApproval) {
      return { status: 'skipped', reason: 'run is not pending approval' }
    }
    const channels = listFactoryWebhookChannels(this.context)
    if (channels.length === 0) {
      return { status: 'skipped', reason: 'no factory webhook channels configured' }
    }

    let anySent = false
    let aggregateFailure: Error | null = null
    for (const channel of channels) {
      try {
        const result = await this.deliverTo(channel, runId)
        if (result === 'sent') anySent = true
      } catch (error) {
        aggregateFailure = error instanceof Error ? error : new Error(String(error))
      }
    }

    if (!anySent && aggregateFailure != null) {
      throw aggregateFailure
    }
    return {
      status: anySent ? 'sent' : 'skipped',
      ...(aggregateFailure == null ? {} : { reason: errorMessage(aggregateFailure) }),
    }
  }

  private async deliverTo(channel: ConfigResource, runId: RunId): Promise<'sent' | 'skipped'> {
    let resolved: ReturnType<typeof webhookConfigFromChannel>
    try {
      const config = (channel.spec as { config?: Record<string, unknown> }).config ?? {}
      resolved = webhookConfigFromChannel(channel.name, config, this.context)
    } catch (error) {
      const detail = errorMessage(error)
      recordWebhookDelivery(this.context, runId, channel, 'failed', { error: detail })
      throw error
    }
    if (!resolved.enabled) {
      recordWebhookDelivery(this.context, runId, channel, 'skipped', { reason: 'disabled', url: resolved.url || undefined })
      return 'skipped'
    }
    const body = buildApprovalRequestBody(this.context, runId)
    const timestamp = String(Math.floor(this.context.now().getTime() / 1000))
    const signature = computeWebhookSignature(timestamp, body, resolved.secret)
    const response = await fetch(resolved.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: `${SIGNATURE_HEADER_PREFIX}${signature}`,
      },
      body,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      const error = `Webhook delivery failed: ${response.status} ${detail.slice(0, 200)}`
      recordWebhookDelivery(this.context, runId, channel, 'failed', { url: resolved.url, error })
      throw new Error(error)
    }
    recordWebhookDelivery(this.context, runId, channel, 'sent', { url: resolved.url })
    return 'sent'
  }
}

export function buildApprovalRequestBody(context: ApiContext, runId: RunId): string {
  const run = context.repos.runs.get(runId)
  const task = run == null ? null : context.repos.tasks.get(run.taskId)
  const spec = task == null ? null : context.repos.specs.get(task.specId)
  const project = spec == null ? null : context.repos.projects.get(spec.projectId)
  const agent = run == null ? null : context.repos.agents.get(run.agentId)
  return JSON.stringify({
    event: 'approval.requested',
    runId,
    project: project == null ? null : { id: project.id, name: project.name },
    spec: spec == null ? null : { id: spec.id, name: spec.name },
    task: task == null ? null : { id: task.id, name: task.name },
    agent: agent == null ? null : { id: agent.id, name: agent.name, model: agent.model },
    branch: run?.branch ?? null,
    commitSha: run?.commitSha ?? null,
  })
}

function errorMessage(error: unknown): string {
  return redactPublicText(error instanceof Error ? error.message : String(error))
}

// Re-exported so tests can assert header constants without hardcoding them.
export const WEBHOOK_HEADERS = {
  timestamp: TIMESTAMP_HEADER,
  signature: SIGNATURE_HEADER,
  signaturePrefix: SIGNATURE_HEADER_PREFIX,
} as const

// Re-export the signature helper so tests can recompute independently.
export { computeWebhookSignature, listFactoryWebhookChannels }
