import type { RunId } from '@ductum/core'

export function buildCodexMcpServerName(runId: RunId): string {
  return `ductum_run_${runId.slice(0, 6)}`
}

export function buildCodexMcpThreadConfig(
  apiUrl: string,
  runId: RunId,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const url = buildCodexMcpUrl(apiUrl, runId, env)
  return {
    mcp_servers: {
      [buildCodexMcpServerName(runId)]: {
        url,
      },
    },
    sandbox_workspace_write: {
      network_access: true,
    },
  }
}

export function buildCodexAppServerEnv(
  apiUrl: string,
  runId: RunId,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    DUCTUM_API_URL: apiUrl,
    DUCTUM_RUN_ID: runId,
  }
}

export function buildCodexMcpToolHint(runId: RunId): string {
  const name = buildCodexMcpServerName(runId)
  return [
    '',
    '## Ductum MCP Tools',
    `Use only the per-run "${name}" MCP server. It is pre-bound to this run; do not pass run_id.`,
    'Ignore any generic "ductum" MCP wording from earlier instructions in Codex sessions.',
    `- mcp__${name}__ductum_workflow() - get current workflow state`,
    `- mcp__${name}__ductum_update(message="...") - report progress`,
    `- mcp__${name}__ductum_complete(result="...") - signal implementation done`,
  ].join('\n')
}

function buildCodexMcpUrl(apiUrl: string, runId: RunId, env: NodeJS.ProcessEnv): string {
  const parsed = new URL(`/api/mcp/${encodeURIComponent(runId)}`, apiUrl)
  if (env.DUCTUM_CODEX_CONTAINERIZED === '1' && isLoopbackHost(parsed.hostname)) {
    parsed.hostname = env.DUCTUM_CONTAINER_HOST_ALIAS?.trim() || 'host.containers.internal'
  }
  const controlToken = env.DUCTUM_CONTROL_TOKEN?.trim()
  if (controlToken != null && controlToken !== '') {
    parsed.searchParams.set('ductum_control_token', controlToken)
  }
  return parsed.toString()
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}
