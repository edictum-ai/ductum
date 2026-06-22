import { describe, expect, it } from 'vitest'

import {
  buildCodexAppServerEnv,
  buildCodexMcpServerName,
  buildCodexMcpThreadConfig,
  buildCodexMcpToolHint,
} from '../codex-mcp-config.js'

describe('codex mcp config', () => {
  it('builds a per-run HTTP MCP config with run-scoped control token auth', () => {
    const env = {
      DUCTUM_OPERATOR_TOKEN: 'operator-secret',
      DUCTUM_CONTROL_TOKEN: 'control-secret',
    } as NodeJS.ProcessEnv
    expect(buildCodexMcpServerName('abcdef123456' as never)).toBe('ductum_run_abcdef')
    const config = buildCodexMcpThreadConfig('http://localhost:4100', 'abcdef123456' as never, env)
    expect(config).toMatchObject({
      mcp_servers: {
        ductum_run_abcdef: {
          url: 'http://localhost:4100/api/mcp/abcdef123456?ductum_control_token=control-secret',
        },
      },
      sandbox_workspace_write: {
        network_access: true,
      },
    })
    expect((config.mcp_servers as Record<string, unknown>).ductum).toBeUndefined()
  })

  it('does not put the wider operator token in the HTTP MCP URL', () => {
    const env = { DUCTUM_OPERATOR_TOKEN: 'operator-secret' } as NodeJS.ProcessEnv
    const config = buildCodexMcpThreadConfig('http://localhost:4100', 'abcdef123456' as never, env)
    const servers = config.mcp_servers as Record<string, { url?: string }>
    expect(servers.ductum_run_abcdef?.url).toBe('http://localhost:4100/api/mcp/abcdef123456')
  })

  it('names the MCP tools with Codex namespaced tool ids', () => {
    expect(buildCodexMcpToolHint('abcdef123456' as never)).toContain('mcp__ductum_run_abcdef__ductum_complete')
    expect(buildCodexMcpToolHint('abcdef123456' as never)).toContain('do not pass run_id')
    expect(buildCodexMcpToolHint('abcdef123456' as never)).toContain('Ignore any generic "ductum" MCP wording')
  })

  it('binds inherited stdio MCP servers to the run environment', () => {
    expect(buildCodexAppServerEnv('http://localhost:4100', 'run-1' as never, {
      DUCTUM_OPERATOR_TOKEN: 'secret',
    } as NodeJS.ProcessEnv)).toMatchObject({
      DUCTUM_API_URL: 'http://localhost:4100',
      DUCTUM_RUN_ID: 'run-1',
      DUCTUM_OPERATOR_TOKEN: 'secret',
    })
  })
})
