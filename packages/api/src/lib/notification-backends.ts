import type { RunId } from '@ductum/core'

export type NotificationDeliveryStatus = 'sent' | 'skipped' | 'failed'

export interface NotificationDeliveryResult<TStatus extends NotificationDeliveryStatus = NotificationDeliveryStatus> {
  status: TStatus
  evidenceId?: string
  reason?: string
  error?: string
}

export interface NotificationMessage {
  kind: 'approval.requested'
  runId: RunId
}

export type NotificationAction = 'approve' | 'deny'

export interface NotificationActionInput {
  action: NotificationAction
  runId: RunId
  actor: string
  callbackQueryId?: string
  chatId?: string | number
  messageId?: number
}

export interface NotificationActionResult {
  ok: boolean
  runId: RunId
  action: NotificationAction
  error?: string
  statusCode?: number
}

export interface NotificationBackend {
  id: string
  send(message: NotificationMessage): Promise<NotificationDeliveryResult<'sent' | 'skipped'>>
  supportsActions(): boolean
  handleAction?(input: NotificationActionInput): Promise<NotificationActionResult>
}
