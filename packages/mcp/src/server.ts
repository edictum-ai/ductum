import type { RunId } from '@ductum/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { DuctumApi } from './api-client.js'
import { registerEvidenceTools } from './tools/evidence.js'
import { registerEnforcementTools } from './tools/enforcement.js'
import { registerLifecycleTools } from './tools/lifecycle.js'
import { registerProgressTools } from './tools/progress.js'
import { registerRecoveryTools } from './tools/recovery.js'

export class DuctumMcpServer {
  readonly mcp: McpServer
  private currentRunId: RunId | null

  constructor(
    readonly client: DuctumApi,
    preBindRunId?: RunId,
  ) {
    this.currentRunId = preBindRunId ?? null
    this.mcp = new McpServer({
      name: 'ductum',
      version: '0.1.0',
    })

    registerLifecycleTools(this)
    registerProgressTools(this)
    registerEnforcementTools(this)
    registerEvidenceTools(this)
    registerRecoveryTools(this)
  }

  bindToRun(runId: RunId): void {
    this.currentRunId = runId
  }

  setControlToken(controlToken: string | null): void {
    this.client.setControlToken?.(controlToken)
  }

  getBoundRunId(): RunId | null {
    return this.currentRunId
  }

  requireBoundRun(): RunId {
    if (this.currentRunId == null) {
      throw new Error('No run is currently bound to this MCP session.')
    }

    return this.currentRunId
  }

  /**
   * Resolve run ID from the pre-bound session.
   *
   * Both Claude/GLM (in-process per-dispatch MCP server) and Codex
   * (HTTP MCP route at /api/mcp/{runId}) pre-bind the run id when the
   * server is constructed. Tools no longer accept `run_id` as an
   * argument — decision D22, "the agent never sees the run id".
   *
   */
  resolveRunId(): RunId {
    return this.requireBoundRun()
  }

  async connect(transport: Transport): Promise<void> {
    await this.mcp.connect(transport)
  }

  async close(): Promise<void> {
    await this.mcp.close()
  }
}
