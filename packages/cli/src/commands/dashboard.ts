import { Command } from 'commander'

import { operatorTokenHeaders } from '../api-request.js'
import { createAction, type CliProgramDeps } from '../runtime.js'

interface ApiEnvelope<D> {
  data?: D
}

interface PairingResponse {
  handoffToken?: unknown
  expiresAt?: unknown
  ttlSeconds?: unknown
  welcomePath?: unknown
}

interface ParsedPairingResponse {
  handoffToken: string
  expiresAt: string
  ttlSeconds: number
  welcomePath: string
}

interface DashboardPairing {
  dashboardUrl: string
  pairingUrl: string
  expiresAt: string
  ttlSeconds: number
}

export function registerDashboardCommands(program: Command, deps: CliProgramDeps) {
  const dashboard = program.command('dashboard').description('Manage dashboard browser access')
  dashboard
    .command('pair')
    .description('Create a one-time dashboard pairing link')
    .action(createAction(deps, async (ctx) => {
      const pairing = await createDashboardPairing(ctx.apiUrl, ctx.env)
      ctx.writeEnvelope('dashboard.pairing_created', pairing, renderDashboardPairing(pairing))
    }))
}

async function createDashboardPairing(
  apiUrl: string,
  env: Record<string, string | undefined>,
): Promise<DashboardPairing> {
  const base = apiUrl.replace(/\/+$/, '')
  const response = await fetch(`${base}/api/welcome/handoff`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...operatorTokenHeaders(env),
    },
    body: '{}',
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`API POST /api/welcome/handoff failed with ${response.status}`)
  const parsed = parsePairingEnvelope(text)
  const welcomePath = parsed.welcomePath.trim()
  if (!welcomePath.startsWith('/')) throw new Error('API pairing response used a non-local welcome path')
  const dashboardUrl = `${base}${welcomePath}`
  return {
    dashboardUrl,
    pairingUrl: `${dashboardUrl}?pair=${encodeURIComponent(parsed.handoffToken.trim())}`,
    expiresAt: parsed.expiresAt,
    ttlSeconds: parsed.ttlSeconds,
  }
}

function parsePairingEnvelope(text: string): ParsedPairingResponse {
  let parsed: ApiEnvelope<PairingResponse>
  try {
    parsed = JSON.parse(text) as ApiEnvelope<PairingResponse>
  } catch {
    throw new Error('API pairing response was not valid JSON')
  }
  const data = parsed.data
  if (
    data == null ||
    typeof data.handoffToken !== 'string' ||
    typeof data.expiresAt !== 'string' ||
    typeof data.ttlSeconds !== 'number' ||
    typeof data.welcomePath !== 'string'
  ) {
    throw new Error('API pairing response was missing required fields')
  }
  return {
    handoffToken: data.handoffToken,
    expiresAt: data.expiresAt,
    ttlSeconds: data.ttlSeconds,
    welcomePath: data.welcomePath,
  }
}

function renderDashboardPairing(pairing: DashboardPairing): string {
  return [
    'Dashboard pairing',
    `open: ${pairing.pairingUrl}`,
    `expires: ${pairing.expiresAt}`,
  ].join('\n')
}
