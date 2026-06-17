export interface WelcomeHandoffResult {
  token: string
  expiresAt: string
  ttlSeconds: number
  welcomePath: string
}

interface ApiEnvelope<D> {
  data: D
}

export async function createWelcomeHandoff(input: {
  apiUrl: string
  operatorToken: string
  fetch: typeof fetch
}): Promise<WelcomeHandoffResult> {
  const envelope = await apiRequest<ApiEnvelope<WelcomeHandoffResult>>(input, 'POST', '/api/welcome/handoff', {})
  return envelope.data
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
