import type { RunId } from '@ductum/core'

import { truncateActivity } from './activity-limits.js'
import { postActivity, postHarnessSessionId, postHeartbeat, postTokens, postToolSuccess } from './rest.js'
import type { HarnessEvent } from './types.js'

export async function emitHarnessEvent(
  apiUrl: string,
  runId: RunId,
  event: HarnessEvent,
  controlToken?: string | null,
): Promise<void> {
  switch (event.type) {
    case 'session.started': {
      const harnessSessionId = event.harnessSessionId?.trim()
      if (harnessSessionId != null && harnessSessionId !== '') {
        await postHarnessSessionId(apiUrl, runId, harnessSessionId)
      }
      return
    }
    case 'text.delta':
      await postActivity(apiUrl, runId, 'text', truncateActivity(event.content))
      return
    case 'tool.requested':
      await postActivity(apiUrl, runId, 'tool_call', truncateActivity(resolveToolContent(event)), event.toolName)
      return
    case 'tool.allowed':
      return
    case 'tool.blocked': {
      const parts = [`BLOCKED: ${resolveToolContent(event)}`]
      if (event.reason != null && event.reason !== '') parts.push(`— ${event.reason}`)
      await postActivity(apiUrl, runId, 'tool_call', truncateActivity(parts.join(' ')), event.toolName)
      return
    }
    case 'tool.result': {
      const content = event.content?.trim() ?? ''
      if (content !== '') {
        await postActivity(apiUrl, runId, 'tool_result', truncateActivity(content), event.toolName)
      }
      if (event.success === true && event.toolName != null && event.args != null) {
        await postToolSuccess(apiUrl, runId, event.toolName, event.args, controlToken)
      }
      return
    }
    case 'cost.updated':
      await postTokens(apiUrl, runId, event.usage, controlToken)
      return
    case 'heartbeat':
      await postHeartbeat(apiUrl, runId)
      return
    case 'needs_approval':
      await postActivity(apiUrl, runId, 'summary', truncateActivity(`approval requested: ${event.toolName} ${resolveToolContent(event)}`.trim()), event.toolName)
      return
    case 'completed':
      await postActivity(apiUrl, runId, 'result', event.content?.trim() || 'Turn completed')
      return
    case 'failed':
      await postActivity(apiUrl, runId, 'result', event.content)
      return
  }
}

function resolveToolContent(
  event:
    | Extract<HarnessEvent, { type: 'tool.requested' }>
    | Extract<HarnessEvent, { type: 'tool.blocked' }>
    | Extract<HarnessEvent, { type: 'needs_approval' }>,
): string {
  if (event.content != null && event.content !== '') return event.content
  return JSON.stringify(event.args ?? {})
}
