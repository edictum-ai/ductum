import { DUCTUM_HEALTH_PROBE_TOOL, extractHealthProbeTarget } from '../opencode-probe.js'

interface PluginInput {
  tool: string
  sessionID: string
}

interface PluginOutput {
  args: unknown
}

interface AuthorizeToolResponse {
  allowed: boolean
  reason?: string
}

interface Hooks {
  'tool.execute.before'?: (input: PluginInput, output: PluginOutput) => Promise<void>
}

type PluginFactory = (_input?: unknown, _options?: unknown) => Promise<Hooks>

const DEFAULT_API_URL = 'http://localhost:4100'
const SESSION_CONTROL_TOKEN_HEADER = 'x-ductum-control-token'

export const DuctumPlugin: PluginFactory = async () => ({
  'tool.execute.before': async (input, output) => {
    const probeTarget = extractHealthProbeTarget(input.tool, output.args)
    const tool = probeTarget == null ? input.tool : DUCTUM_HEALTH_PROBE_TOOL
    const sessionId = probeTarget ?? input.sessionID
    const args = probeTarget == null ? asRecord(output.args) : {}
    const controlToken = getControlToken()

    const result = await authorizeToolCall(getApiUrl(), sessionId, controlToken, tool, args)
    if (!result.allowed) {
      throw new Error(result.reason ?? 'Tool call blocked by Ductum')
    }
    if (probeTarget != null) {
      throw new Error('Ductum plugin health probe completed')
    }
  },
})

export default DuctumPlugin

export async function authorizeToolCall(
  apiUrl: string,
  sessionId: string,
  controlToken: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<AuthorizeToolResponse> {
  if (controlToken === '') {
    return {
      allowed: false,
      reason: 'Ductum control token missing - tool call blocked for safety',
    }
  }

  try {
    const response = await fetch(new URL('/api/internal/authorize-tool', apiUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SESSION_CONTROL_TOKEN_HEADER]: controlToken,
      },
      body: JSON.stringify({
        session_id: sessionId,
        tool,
        args,
      }),
    })
    const payload = await readJson(response)

    if (!response.ok) {
      return {
        allowed: false,
        reason: readReason(payload, response.status),
      }
    }

    return {
      allowed: payload.allowed === true,
      reason: typeof payload.reason === 'string' ? payload.reason : undefined,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Ductum plugin health probe completed') {
      throw error
    }

    return {
      allowed: false,
      reason: 'Ductum enforcement unavailable - tool call blocked for safety',
    }
  }
}

function getApiUrl(): string {
  return process.env.DUCTUM_API_URL ?? DEFAULT_API_URL
}

function getControlToken(): string {
  return process.env.DUCTUM_CONTROL_TOKEN ?? ''
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

function readReason(payload: Record<string, unknown>, status: number): string {
  if (typeof payload.reason === 'string') {
    return payload.reason
  }
  if (typeof payload.error === 'string') {
    return payload.error
  }
  return `HTTP ${status}`
}
