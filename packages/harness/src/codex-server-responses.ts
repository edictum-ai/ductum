/**
 * Codex app-server response shaping for non-interactive harness mode.
 *
 * Each function returns a protocol-valid response for a specific Codex
 * app-server request. The Codex CLI deserializes these responses strictly
 * (missing fields cause crashes), so every response must match the generated
 * TypeScript types from `codex app-server generate-ts`.
 *
 * This module is independently unit-testable — no child process, no JSON-RPC
 * transport, no harness state.
 */

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * Response to `mcpServer/elicitation/request`.
 *
 * Codex sends this when an MCP server the agent connects to asks for
 * human input (elicitation). Ductum runs are non-interactive, so we
 * always decline.
 *
 * Protocol type (from generated TS):
 * ```
 * type McpServerElicitationRequestResponse = {
 *   action: "accept" | "decline" | "cancel";
 *   content: JsonValue | null;
 *   _meta: JsonValue | null;
 * };
 * ```
 */
export function shapeElicitationDecline(): {
  action: 'decline'
  content: null
  _meta: null
} {
  return { action: 'decline', content: null, _meta: null }
}

export function shapeElicitationAccept(): {
  action: 'accept'
  content: null
  _meta: null
} {
  return { action: 'accept', content: null, _meta: null }
}

/**
 * Response to `item/tool/requestUserInput`.
 *
 * Codex sends this when a tool needs interactive user answers.
 * Ductum runs are non-interactive, so we return empty answers.
 *
 * Protocol type (from generated TS):
 * ```
 * type ToolRequestUserInputResponse = {
 *   answers: { [key in string]?: ToolRequestUserInputAnswer };
 * };
 * ```
 */
export function shapeUserInputDecline(): {
  answers: Record<string, never>
} {
  return { answers: {} }
}

/**
 * Response to `item/permissions/requestApproval`.
 *
 * Grants no additional permissions, scoped to the current turn.
 *
 * Protocol type (from generated TS):
 * ```
 * type PermissionsRequestApprovalResponse = {
 *   permissions: GrantedPermissionProfile;   // { network?: ..., fileSystem?: ... }
 *   scope: "turn" | "session";
 *   strictAutoReview?: boolean;
 * };
 * ```
 */
export function shapePermissionsDecline(): {
  permissions: Record<string, never>
  scope: 'turn'
} {
  return { permissions: {}, scope: 'turn' }
}

/**
 * Response to `applyPatchApproval` and `execCommandApproval`.
 *
 * Both use `ReviewDecision` — we always deny.
 *
 * Protocol type (from generated TS):
 * ```
 * type ReviewDecision = "approved" | "approved_for_session" | "denied" | ... ;
 * type ApplyPatchApprovalResponse = { decision: ReviewDecision };
 * type ExecCommandApprovalResponse = { decision: ReviewDecision };
 * ```
 */
export function shapeApprovalDenied(): {
  decision: 'denied'
} {
  return { decision: 'denied' }
}

/**
 * Response to `item/tool/call`.
 *
 * Returns a failure with an explanation content item. Dynamic tool calls
 * are not allowed in non-interactive harness mode.
 *
 * Protocol type (from generated TS):
 * ```
 * type DynamicToolCallOutputContentItem =
 *   | { type: "inputText", text: string }
 *   | { type: "inputImage", imageUrl: string };
 * type DynamicToolCallResponse = {
 *   contentItems: Array<DynamicToolCallOutputContentItem>;
 *   success: boolean;
 * };
 * ```
 */
export function shapeToolCallBlock(): {
  success: false
  contentItems: Array<{ type: 'inputText'; text: string }>
} {
  return {
    success: false,
    contentItems: [
      { type: 'inputText', text: 'Ductum harness blocked dynamic tool call (non-interactive mode)' },
    ],
  }
}

/**
 * JSON-RPC error for `account/chatgptAuthTokens/refresh`.
 *
 * Non-interactive auth refresh is unsupported. The agent must authenticate
 * via `codex login` before the run is dispatched.
 *
 * Codex treats this as a JSON-RPC error (not a result), so no shaped
 * response is needed and strict deserialization won't attempt to parse it.
 */
export function buildAuthRefreshError(): {
  code: number
  message: string
} {
  return {
    code: -32000,
    message: 'Ductum harness does not support non-interactive auth token refresh. Authenticate via "codex login" before dispatching.',
  }
}

/**
 * JSON-RPC error for unknown/unhandled server request methods.
 *
 * Codex deserializes successful results strictly against the declared
 * response type, so an arbitrary result object causes crashes. Returning
 * a JSON-RPC error instead avoids deserialization entirely.
 */
export function buildUnsupportedMethodError(method: string): {
  code: number
  message: string
} {
  return {
    code: -32601,
    message: `Ductum harness does not support server request method: ${method}`,
  }
}

// ---------------------------------------------------------------------------
// Method → shaper lookup
// ---------------------------------------------------------------------------

/**
 * All server request methods that the harness handles explicitly without
 * interactive human input. Every method here has either a shaped response
 * or a deliberate JSON-RPC error.
 */
export const KNOWN_SERVER_REQUEST_METHODS = new Set([
  'mcpServer/elicitation/request',
  'item/tool/requestUserInput',
  'item/permissions/requestApproval',
  'item/tool/call',
  'applyPatchApproval',
  'execCommandApproval',
  'account/chatgptAuthTokens/refresh',
])

/** Check if a method is a known non-interactive server request. */
export function isKnownNonInteractiveMethod(method: string): boolean {
  return KNOWN_SERVER_REQUEST_METHODS.has(method)
}

// ---------------------------------------------------------------------------
// Elicitation context extraction
// ---------------------------------------------------------------------------

export interface ElicitationContext {
  serverName: string | null
  message: string | null
}

/**
 * Extract the server name and message from an elicitation request's params.
 *
 * Codex sends params like:
 * ```json
 * { "serverName": "ductum_run_abc123", "message": "Do you want to proceed?" }
 * ```
 */
export function extractElicitationContext(params: unknown): ElicitationContext {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    return { serverName: null, message: null }
  }
  const p = params as Record<string, unknown>
  return {
    serverName: typeof p.serverName === 'string' ? p.serverName : null,
    message: typeof p.message === 'string' ? p.message : null,
  }
}
