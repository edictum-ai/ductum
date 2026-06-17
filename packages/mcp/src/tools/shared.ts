import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { DuctumApiError } from '../api-client.js'
import type { DuctumMcpServer } from '../server.js'

function textBlock(text: string) {
  return [{ type: 'text' as const, text }]
}

export function okResult(message: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: textBlock(message),
    structuredContent,
  }
}

export function errorResult(
  message: string,
  structuredContent: Record<string, unknown> = {},
): CallToolResult {
  return {
    content: textBlock(message),
    structuredContent: { ok: false, ...structuredContent },
    isError: true,
  }
}

/**
 * Wrap a tool call with error handling and activity logging.
 * Posts the tool response to the activity feed so the dashboard shows it.
 */
export async function safeToolCall(
  callback: () => Promise<CallToolResult>,
  server?: DuctumMcpServer,
  toolName?: string,
): Promise<CallToolResult> {
  try {
    const result = await callback()

    // Post the response to the activity feed (best-effort)
    if (server != null && toolName != null) {
      const runId = server.getBoundRunId()
      if (runId != null) {
        const content = result.structuredContent != null
          ? JSON.stringify(result.structuredContent).slice(0, 2000)
          : result.content?.map((b) => 'text' in b ? b.text : '').join('\n').slice(0, 2000) ?? ''
        void server.client.postActivity(runId, 'tool_result', content, toolName).catch(() => undefined)
      }
    }

    return result
  } catch (error) {
    if (error instanceof DuctumApiError) {
      return errorResult(error.message, {
        error: error.message,
        status: error.status,
        details: error.details,
      })
    }

    const message = error instanceof Error ? error.message : 'Unexpected MCP tool error'
    return errorResult(message, { error: message })
  }
}
