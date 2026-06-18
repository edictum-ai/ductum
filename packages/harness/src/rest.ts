import { log, type Agent, type AgentId, type RunId } from '@ductum/core'

import type { TokenUsageDelta } from './types.js'

interface ApiErrorPayload {
  error?: string
}

export interface AuthorizeToolResponse {
  allowed: boolean
  reason?: string
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const SESSION_CONTROL_TOKEN_HEADER = 'x-ductum-control-token'

export async function fetchAgent(apiUrl: string, agentId: AgentId): Promise<Agent> {
  return await requestJson<Agent>(buildUrl(apiUrl, `/api/agents/${encodeURIComponent(agentId)}`))
}

export async function authorizeTool(
  apiUrl: string,
  sessionId: string,
  controlToken: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<AuthorizeToolResponse> {
  const response = await fetch(buildUrl(apiUrl, '/api/internal/authorize-tool'), {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...operatorTokenHeader(), [SESSION_CONTROL_TOKEN_HEADER]: controlToken },
    body: JSON.stringify({ session_id: sessionId, tool, args }),
  })

  if (response.ok) {
    return await response.json() as AuthorizeToolResponse
  }

  const message = await readError(response)
  if (response.status === 403) {
    return { allowed: false, reason: message }
  }

  throw new Error(`authorize-tool failed: ${message}`)
}

/**
 * Report that a work tool executed successfully.
 * Called by the PostToolUse hook to feed evidence to the workflow runtime,
 * enabling auto-advancement when exit gates are satisfied.
 * Best-effort — failures are silently ignored to avoid blocking the agent.
 */
export async function reportToolSuccess(
  apiUrl: string,
  sessionId: string,
  controlToken: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<void> {
  await postJson(
    apiUrl,
    '/api/internal/report-tool-success',
    { session_id: sessionId, tool, args },
    { [SESSION_CONTROL_TOKEN_HEADER]: controlToken },
  )
}

export async function postHeartbeat(apiUrl: string, runId: RunId): Promise<void> {
  await postJson(apiUrl, `/api/runs/${encodeURIComponent(runId)}/heartbeat`, {})
}

export async function postTokens(apiUrl: string, runId: RunId, usage: TokenUsageDelta, controlToken?: string | null): Promise<void> {
  await postJson(apiUrl, `/api/runs/${encodeURIComponent(runId)}/tokens`, usage, sessionControlHeader(controlToken))
}

/**
 * Tell the API which harness-side session id (codex Thread.id, claude
 * session uuid) is bound to this run. The API stores it on
 * session_run_mapping so the local cost scanner can look up the matching
 * jsonl log file. Best-effort — failures are logged but never block the
 * agent.
 */
export async function postHarnessSessionId(
  apiUrl: string,
  runId: RunId,
  harnessSessionId: string,
): Promise<void> {
  await postJson(
    apiUrl,
    `/api/runs/${encodeURIComponent(runId)}/harness-session-id`,
    { harnessSessionId },
  ).catch((err) => {
    log.warn('rest', `postHarnessSessionId failed for ${runId}: ${err instanceof Error ? err.message : err}`)
  })
}

export async function postActivity(
  apiUrl: string,
  runId: RunId,
  kind: string,
  content: string,
  toolName?: string,
): Promise<void> {
  await postJson(apiUrl, `/api/runs/${encodeURIComponent(runId)}/activity`, {
    kind,
    content,
    ...(toolName != null ? { toolName } : {}),
  }).catch(() => undefined) // best-effort — don't block the agent
}

/**
 * Report tool success directly via run ID (for harnesses without session control tokens).
 * This triggers Edictum's recordToolSuccess which records evidence and may auto-advance the workflow.
 */
export async function postToolSuccess(
  apiUrl: string,
  runId: RunId,
  tool: string,
  args: Record<string, unknown>,
  controlToken?: string | null,
): Promise<void> {
  // Use the internal endpoint with a synthetic session lookup
  await postJson(apiUrl, `/api/runs/${encodeURIComponent(runId)}/tool-success`, { tool, args }, sessionControlHeader(controlToken)).catch((err) => {
    log.warn('rest', `postToolSuccess failed for ${runId}: ${err instanceof Error ? err.message : err}`)
  })
}

function sessionControlHeader(controlToken: string | null | undefined): Record<string, string> | undefined {
  const token = controlToken?.trim()
  return token == null || token === '' ? undefined : { [SESSION_CONTROL_TOKEN_HEADER]: token }
}

async function postJson(
  apiUrl: string,
  path: string,
  body: object,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await fetch(buildUrl(apiUrl, path), {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...operatorTokenHeader(), ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: operatorTokenHeader() })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return await response.json() as T
}

function buildUrl(apiUrl: string, path: string): string {
  return new URL(path, apiUrl).toString()
}

function operatorTokenHeader(): Record<string, string> {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token == null || token === '' || isPlaceholderToken(token) ? {} : { 'x-ductum-operator-token': token }
}

function isPlaceholderToken(token: string): boolean {
  return ['missing', 'changeme', 'replace-me'].includes(token.toLowerCase())
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload
    return payload.error ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}
