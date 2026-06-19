import type { RunId } from '@ductum/core'

export function buildCodexMcpServerName(runId: RunId): string {
  return `ductum_run_${runId.slice(0, 6)}`
}

export function buildCodexMcpThreadConfig(
  apiUrl: string,
  runId: RunId,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  return {
    mcp_servers: {
      [buildCodexMcpServerName(runId)]: {
        url: buildCodexMcpUrl(apiUrl, runId, env),
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
    `Use the per-run "${name}" MCP server only. It is pre-bound to this run; do not pass run_id.`,
    `- mcp__${name}__ductum_workflow() - get current workflow state`,
    `- mcp__${name}__ductum_update(message="...") - report progress`,
    `- mcp__${name}__ductum_complete(result="...") - signal implementation done`,
  ].join('\n')
}

function buildCodexMcpUrl(apiUrl: string, runId: RunId, env: NodeJS.ProcessEnv): string {
  const parsed = new URL(`/api/mcp/${encodeURIComponent(runId)}`, apiUrl)
  const controlToken = env.DUCTUM_CONTROL_TOKEN?.trim()
  if (controlToken != null && controlToken !== '') {
    parsed.searchParams.set('ductum_control_token', controlToken)
  }
  return parsed.toString()
}
