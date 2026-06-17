/**
 * Non-interactive Codex app-server request routing.
 *
 * Maps server request methods to their response shape and Ductum harness
 * events. Pure function — no side effects, no transport, no harness state.
 *
 * The adapter calls this for every server request that does not require
 * interactive policy evaluation (i.e. everything except
 * `item/commandExecution/requestApproval` and
 * `item/fileChange/requestApproval`).
 */

import type { HarnessEvent } from './types.js'

import {
  buildAuthRefreshError,
  buildUnsupportedMethodError,
  extractElicitationContext,
  shapeElicitationAccept,
  shapeApprovalDenied,
  shapeElicitationDecline,
  shapePermissionsDecline,
  shapeToolCallBlock,
  shapeUserInputDecline,
} from './codex-server-responses.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerRequestResult {
  /** JSON-RPC result to send back (success path). */
  result?: unknown
  /** JSON-RPC error to send back (error path). */
  error?: { code: number; message: string }
  /** Whether to send an error response instead of a result response. */
  isError: boolean
  /** Ductum harness events to emit. */
  events: HarnessEvent[]
}

export interface ServerRequestRouteOptions {
  trustedMcpServerNames?: readonly string[]
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Route a non-interactive Codex app-server request.
 *
 * @param method - JSON-RPC method name from the server request.
 * @param params - JSON-RPC params from the server request.
 * @returns The response to send and events to emit.
 */
export function routeNonInteractiveRequest(
  method: string,
  params: unknown,
  options: ServerRequestRouteOptions = {},
): ServerRequestResult {
  switch (method) {
    // -------------------------------------------------------------------
    // Permissions escalation
    // -------------------------------------------------------------------
    case 'item/permissions/requestApproval': {
      return {
        result: shapePermissionsDecline(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: 'PermissionsRequestApproval',
          args: (params ?? {}) as Record<string, unknown>,
          reason: 'Ductum runs are non-interactive; permission escalation denied with no additional permissions',
        }],
      }
    }

    // -------------------------------------------------------------------
    // MCP elicitation
    // -------------------------------------------------------------------
    case 'mcpServer/elicitation/request': {
      const ctx = extractElicitationContext(params)
      const content = [ctx.serverName, ctx.message].filter(Boolean).join(': ') || undefined
      if (ctx.serverName != null && options.trustedMcpServerNames?.includes(ctx.serverName)) {
        return {
          result: shapeElicitationAccept(),
          isError: false,
          events: [{
            type: 'tool.requested',
            toolName: 'McpElicitation',
            args: {
              serverName: ctx.serverName,
              ...(ctx.message != null ? { message: ctx.message } : {}),
            },
            content,
          }],
        }
      }
      return {
        result: shapeElicitationDecline(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: 'McpElicitation',
          args: {
            ...(ctx.serverName != null ? { serverName: ctx.serverName } : {}),
            ...(ctx.message != null ? { message: ctx.message } : {}),
          },
          content,
          reason: 'Ductum runs are non-interactive; MCP elicitation declined',
        }],
      }
    }

    // -------------------------------------------------------------------
    // User input
    // -------------------------------------------------------------------
    case 'item/tool/requestUserInput': {
      return {
        result: shapeUserInputDecline(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: 'ToolRequestUserInput',
          args: (params ?? {}) as Record<string, unknown>,
          reason: 'Ductum runs are non-interactive; user input request returned empty answers',
        }],
      }
    }

    // -------------------------------------------------------------------
    // Auth refresh
    // -------------------------------------------------------------------
    case 'account/chatgptAuthTokens/refresh': {
      const authError = buildAuthRefreshError()
      return {
        error: authError,
        isError: true,
        events: [{
          type: 'tool.blocked',
          toolName: 'ChatgptAuthTokensRefresh',
          args: (params ?? {}) as Record<string, unknown>,
          reason: authError.message,
        }],
      }
    }

    // -------------------------------------------------------------------
    // Apply-patch approval
    // -------------------------------------------------------------------
    case 'applyPatchApproval': {
      return {
        result: shapeApprovalDenied(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: 'ApplyPatchApproval',
          args: (params ?? {}) as Record<string, unknown>,
          reason: 'Ductum runs are non-interactive; patch application denied',
        }],
      }
    }

    // -------------------------------------------------------------------
    // Exec-command approval
    // -------------------------------------------------------------------
    case 'execCommandApproval': {
      return {
        result: shapeApprovalDenied(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: 'ExecCommandApproval',
          args: (params ?? {}) as Record<string, unknown>,
          reason: 'Ductum runs are non-interactive; exec command approval denied',
        }],
      }
    }

    // -------------------------------------------------------------------
    // Dynamic tool call
    // -------------------------------------------------------------------
    case 'item/tool/call': {
      const toolName = String((params as Record<string, unknown>)?.tool ?? 'unknown')
      return {
        result: shapeToolCallBlock(),
        isError: false,
        events: [{
          type: 'tool.blocked',
          toolName: `DynamicToolCall/${toolName}`,
          args: (params ?? {}) as Record<string, unknown>,
          reason: 'Ductum runs are non-interactive; dynamic tool call blocked',
        }],
      }
    }

    // -------------------------------------------------------------------
    // Unknown / future methods
    // -------------------------------------------------------------------
    default: {
      const error = buildUnsupportedMethodError(method)
      return {
        error,
        isError: true,
        events: [],
      }
    }
  }
}
