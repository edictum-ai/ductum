import type { RepairCheckStatus } from '@ductum/core'

import type { ApiRuntimeObservation } from './deps.js'

const LOCAL_APP_PROBE_TIMEOUT_MS = 500

interface ProbeInput {
  runtime: ApiRuntimeObservation
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

interface HealthResponse {
  ok?: unknown
  operatorTokenProtected?: unknown
}

export async function probeLocalAppReadiness(input: ProbeInput): Promise<RepairCheckStatus> {
  const target = resolveLocalHealthTarget(input.runtime, input.env)
  if (target == null) {
    return {
      state: 'missing',
      label: '(missing)',
      detail: 'Local app probe is unavailable because no local API port or loopback base URL is configured.',
    }
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(target.healthUrl, {
      signal: AbortSignal.timeout(LOCAL_APP_PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return {
        state: 'missing',
        label: target.label,
        detail: `Local app health check returned HTTP ${response.status}.`,
      }
    }
    const body = await response.json() as HealthResponse
    if (body.ok !== true || typeof body.operatorTokenProtected !== 'boolean') {
      return {
        state: 'missing',
        label: target.label,
        detail: 'Local app health check returned an invalid response payload.',
      }
    }
    return { state: 'ready', label: target.label }
  } catch (error) {
    return {
      state: 'missing',
      label: target.label,
      detail: probeFailureDetail(error),
    }
  }
}

export function unprobedLocalAppStatus(runtime: ApiRuntimeObservation, env?: NodeJS.ProcessEnv): RepairCheckStatus {
  const target = resolveLocalHealthTarget(runtime, env)
  if (target == null) {
    return {
      state: 'not_checked',
      label: 'Local app probe unavailable',
      detail: 'Local app readiness was not checked because no local API port or loopback base URL is configured.',
    }
  }
  return {
    state: 'not_checked',
    label: target.label,
    detail: 'Local app readiness was not checked in this code path.',
  }
}

function resolveLocalHealthTarget(runtime: ApiRuntimeObservation, env: NodeJS.ProcessEnv = process.env) {
  const port = runtime.apiPort ?? parsePort(env.DUCTUM_PORT)
  if (port != null) {
    return {
      label: `API reachable on 127.0.0.1:${port}`,
      healthUrl: `http://127.0.0.1:${port}/api/health`,
    }
  }

  const publicApiUrl = runtime.publicApiUrl?.trim()
  if (publicApiUrl == null || publicApiUrl === '') return null

  try {
    const url = new URL(publicApiUrl)
    if (!isLoopbackHost(url.hostname)) return null
    return {
      label: `API reachable on ${url.origin}`,
      healthUrl: new URL('/api/health', `${url.origin}/`).toString(),
    }
  } catch {
    return null
  }
}

function parsePort(value: string | undefined): number | null {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 65535 ? numeric : null
}

function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host)
}

function probeFailureDetail(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `Local app health check timed out after ${LOCAL_APP_PROBE_TIMEOUT_MS}ms.`
  }
  return 'Local app health check failed because the API was unreachable.'
}
