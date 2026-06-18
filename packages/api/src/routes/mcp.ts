/**
 * HTTP MCP transport route — replaces the run_id-arg workaround.
 *
 * Each request is per-run (URL path = /api/mcp/:runId), and we
 * instantiate a request-scoped DuctumMcpServer pre-bound to that run
 * before handing the request body off to MCP's
 * WebStandardStreamableHTTPServerTransport. The agent never sees a
 * `run_id` argument; identity comes from the URL.
 *
 * This satisfies decision D22 ("agent never sees run id") for Codex,
 * which previously relied on a global stdio MCP server with run_id
 * baked into every tool argument.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { publicOutput } from '../lib/public-output.js'

export function registerMcpRoutes(app: Hono, context: ApiContext) {
  // The MCP package is optional. Resolve lazily so the API still
  // builds when @ductum/mcp isn't installed.
  let mcpModule: typeof import('@ductum/mcp') | null = null
  const loadMcp = async () => {
    if (mcpModule == null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpModule = (await import('@ductum/mcp' as any)) as typeof import('@ductum/mcp')
    }
    return mcpModule
  }

  /**
   * MCP HTTP transport endpoint. Accepts MCP JSON-RPC POST + GET +
   * DELETE per the StreamableHttp spec. Run id is taken from the URL
   * path; tools never see it as an argument.
   */
  const handler = async (c: import('hono').Context) => {
    const runIdRaw = c.req.param('runId')
    if (runIdRaw == null || runIdRaw === '') {
      return c.json(publicOutput({ error: 'runId is required in URL path' }), 400)
    }
    // Verify the run exists. Otherwise we'd happily handle MCP
    // calls bound to garbage and silently fail later.
    if (context.repos.runs.get(runIdRaw as never) == null) {
      return c.json(publicOutput({ error: `Run not found: ${runIdRaw}` }), 404)
    }

    let mcp
    try {
      mcp = await loadMcp()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return c.json(publicOutput({ error: `MCP module not available: ${msg}` }), 503)
    }

    const apiUrl = `http://localhost:${process.env.DUCTUM_PORT ?? '4100'}`
    const controlToken = c.req.header('x-ductum-control-token') ?? c.req.query('ductum_control_token') ?? null
    const server = mcp.createMcpServer(apiUrl, runIdRaw as never, { controlToken })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode — one request per server
      enableJsonResponse: true,
    })
    await server.connect(transport)

    try {
      // The MCP transport handles the full JSON-RPC request/response.
      const response = await transport.handleRequest(c.req.raw)
      return response
    } finally {
      // Stateless: tear down after each request.
      await server.close().catch(() => undefined)
    }
  }

  app.post('/api/mcp/:runId', handler)
  app.get('/api/mcp/:runId', handler)
  app.delete('/api/mcp/:runId', handler)
}
