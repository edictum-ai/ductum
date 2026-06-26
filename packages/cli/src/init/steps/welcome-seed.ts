export interface WelcomeHandoffResult {
  token: string | null
  expiresAt: string
  ttlSeconds: number
  welcomePath: string
}

interface ApiEnvelope<D> {
  data: D
}

interface WelcomeHandoffData {
  handoffToken?: unknown
  token?: unknown
  expiresAt?: unknown
  ttlSeconds?: unknown
  welcomePath?: unknown
}

export async function createWelcomeHandoff(input: {
  apiUrl: string
  operatorToken: string
  fetch: typeof fetch
}): Promise<WelcomeHandoffResult> {
  const envelope = await apiRequest<ApiEnvelope<WelcomeHandoffData>>(input, 'POST', '/api/welcome/handoff', {})
  return parseWelcomeHandoff(envelope.data)
}

function parseWelcomeHandoff(data: WelcomeHandoffData): WelcomeHandoffResult {
  if (
    data == null ||
    typeof data.expiresAt !== 'string' ||
    typeof data.ttlSeconds !== 'number' ||
    typeof data.welcomePath !== 'string'
  ) {
    throw new Error('API handoff response was missing required fields')
  }
  const token = typeof data.handoffToken === 'string'
    ? data.handoffToken
    : typeof data.token === 'string'
      ? data.token
      : null
  return {
    token,
    expiresAt: data.expiresAt,
    ttlSeconds: data.ttlSeconds,
    welcomePath: data.welcomePath,
  }
}

async function apiRequest<T = unknown>(
  input: { apiUrl: string; operatorToken: string; fetch: typeof fetch },
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await input.fetch(`${input.apiUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-ductum-operator-token': input.operatorToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`API ${method} ${path} failed with ${response.status}`)
  return (text === '' ? null : JSON.parse(text)) as T
}
