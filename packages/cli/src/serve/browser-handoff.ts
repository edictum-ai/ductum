export interface StartBrowserHandoff {
  dashboardUrl: string
  handoffUrl: string
  expiresAt: string
  ttlSeconds: number
}

interface ApiEnvelope<D> {
  data?: D
}

interface WelcomeHandoffData {
  handoffToken?: unknown
  expiresAt?: unknown
  ttlSeconds?: unknown
  welcomePath?: unknown
}

interface ParsedWelcomeHandoff {
  handoffToken: string
  expiresAt: string
  ttlSeconds: number
  welcomePath: string
}

export async function createStartBrowserHandoff(input: {
  apiUrl: string
  operatorToken: string
  fetch?: typeof fetch
}): Promise<StartBrowserHandoff> {
  const fetchImpl = input.fetch ?? fetch
  const response = await fetchImpl(`${input.apiUrl}/api/welcome/handoff`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ductum-operator-token': input.operatorToken,
    },
    body: '{}',
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`API POST /api/welcome/handoff failed with ${response.status}`)
  const parsed = parseHandoffEnvelope(text)
  const welcomePath = parsed.welcomePath.trim()
  const handoffToken = parsed.handoffToken.trim()
  if (!welcomePath.startsWith('/')) throw new Error('API handoff response used a non-local welcome path')
  return {
    dashboardUrl: `${input.apiUrl}${welcomePath}`,
    handoffUrl: `${input.apiUrl}${welcomePath}?token=${encodeURIComponent(handoffToken)}`,
    expiresAt: parsed.expiresAt,
    ttlSeconds: parsed.ttlSeconds,
  }
}

function parseHandoffEnvelope(text: string): ParsedWelcomeHandoff {
  let parsed: ApiEnvelope<WelcomeHandoffData>
  try {
    parsed = JSON.parse(text) as ApiEnvelope<WelcomeHandoffData>
  } catch {
    throw new Error('API handoff response was not valid JSON')
  }
  const data = parsed.data
  if (
    data == null ||
    typeof data.handoffToken !== 'string' ||
    typeof data.expiresAt !== 'string' ||
    typeof data.ttlSeconds !== 'number' ||
    typeof data.welcomePath !== 'string'
  ) {
    throw new Error('API handoff response was missing required fields')
  }
  return {
    handoffToken: data.handoffToken,
    expiresAt: data.expiresAt,
    ttlSeconds: data.ttlSeconds,
    welcomePath: data.welcomePath,
  }
}
