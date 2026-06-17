import { authorizeTool, reportToolSuccess } from './rest.js'
import type { ClaudeHookCallback } from './sdk.js'

const WORK_TOOLS = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'NotebookEdit'])

interface HookSessionControl {
  sessionId: string | null
  controlToken: string | null
}

export function createPreToolUseHook(
  apiUrl: string,
  session: HookSessionControl,
): ClaudeHookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return {}
    }

    const toolName = input.tool_name ?? ''
    if (!WORK_TOOLS.has(toolName)) {
      return {}
    }

    if (session.sessionId == null || session.controlToken == null) {
      return deny('Ductum session control unavailable - tool call blocked for safety')
    }

    try {
      const result = await authorizeTool(
        apiUrl,
        session.sessionId,
        session.controlToken,
        toolName,
        asRecord(input.tool_input),
      )
      if (result.allowed) {
        return {}
      }
      return deny(result.reason ?? 'Tool call blocked by Ductum')
    } catch (error) {
      return deny(formatHookError(error))
    }
  }
}

export function createPostToolUseHook(
  apiUrl: string,
  session: HookSessionControl,
): ClaudeHookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PostToolUse') {
      return {}
    }

    const toolName = input.tool_name ?? ''
    if (!WORK_TOOLS.has(toolName) || session.sessionId == null || session.controlToken == null) {
      return {}
    }

    void reportToolSuccess(
      apiUrl,
      session.sessionId,
      session.controlToken,
      toolName,
      asRecord(input.tool_input),
    ).catch(() => undefined)

    return {}
  }
}

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function formatHookError(error: unknown): string {
  return error instanceof Error ? `Ductum authorize_tool failed: ${error.message}` : 'Ductum authorize_tool failed'
}
