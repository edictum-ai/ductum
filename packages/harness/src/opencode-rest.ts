import type { OpenCodeModelRef } from './opencode-model.js'
import type { OpenCodeSubtaskPartInput } from './opencode-probe.js'

interface ApiErrorPayload {
  error?: string
  details?: unknown
}

interface OpenCodeSessionMessage {
  role: 'user' | 'assistant'
  error?: { name?: string }
  finish?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
  }
}

export interface OpenCodeSession {
  id: string
  title: string
}

export interface OpenCodeSessionStatus {
  type: 'idle' | 'busy' | 'retry'
}

export interface OpenCodeSessionMessageWithParts {
  info: OpenCodeSessionMessage
  parts: Array<{ type: string }>
}

interface OpenCodePromptBody {
  system?: string
  model?: OpenCodeModelRef
  tools?: Record<string, boolean>
  parts: Array<OpenCodeTextPartInput | OpenCodeSubtaskPartInput>
}

interface OpenCodeTextPartInput {
  type: 'text'
  text: string
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export async function createSession(openCodeUrl: string, directory: string, title: string): Promise<OpenCodeSession> {
  return await requestJson<OpenCodeSession>(openCodeUrl, '/session', directory, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  })
}

export async function deleteSession(openCodeUrl: string, directory: string, sessionId: string): Promise<void> {
  await requestVoid(openCodeUrl, `/session/${encodeURIComponent(sessionId)}`, directory, {
    method: 'DELETE',
  })
}

export async function getSessionStatuses(
  openCodeUrl: string,
  directory: string,
): Promise<Record<string, OpenCodeSessionStatus>> {
  return await requestJson<Record<string, OpenCodeSessionStatus>>(openCodeUrl, '/session/status', directory)
}

export async function promptSessionAsync(
  openCodeUrl: string,
  directory: string,
  sessionId: string,
  body: OpenCodePromptBody,
): Promise<void> {
  await requestVoid(openCodeUrl, `/session/${encodeURIComponent(sessionId)}/prompt_async`, directory, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

export async function promptSession(
  openCodeUrl: string,
  directory: string,
  sessionId: string,
  body: OpenCodePromptBody,
): Promise<OpenCodeSessionMessageWithParts> {
  return await requestJson<OpenCodeSessionMessageWithParts>(
    openCodeUrl,
    `/session/${encodeURIComponent(sessionId)}/message`,
    directory,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  )
}

export async function listSessionMessages(
  openCodeUrl: string,
  directory: string,
  sessionId: string,
): Promise<OpenCodeSessionMessageWithParts[]> {
  return await requestJson<OpenCodeSessionMessageWithParts[]>(
    openCodeUrl,
    `/session/${encodeURIComponent(sessionId)}/message`,
    directory,
  )
}

export async function addMcpServer(
  openCodeUrl: string,
  directory: string,
  name: string,
  command: string[],
  environment: Record<string, string>,
): Promise<void> {
  await requestVoid(openCodeUrl, '/mcp', directory, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      name,
      config: {
        type: 'local',
        command,
        environment,
        enabled: true,
      },
    }),
  })
}

export async function disconnectMcpServer(openCodeUrl: string, directory: string, name: string): Promise<void> {
  await requestVoid(openCodeUrl, `/mcp/${encodeURIComponent(name)}/disconnect`, directory, {
    method: 'POST',
  })
}

export async function getPluginProbe(apiUrl: string, sessionId: string): Promise<boolean> {
  const url = new URL('/api/internal/plugin-probe', apiUrl)
  url.searchParams.set('session_id', sessionId)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const payload = await response.json() as { seen?: boolean }
  return payload.seen === true
}

async function requestJson<T>(
  openCodeUrl: string,
  path: string,
  directory: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(buildUrl(openCodeUrl, path, directory), init)
  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return await response.json() as T
}

async function requestVoid(
  openCodeUrl: string,
  path: string,
  directory: string,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(buildUrl(openCodeUrl, path, directory), init)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

function buildUrl(openCodeUrl: string, path: string, directory: string): string {
  const url = new URL(path, openCodeUrl)
  url.searchParams.set('directory', directory)
  return url.toString()
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload
    return payload.error ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}
