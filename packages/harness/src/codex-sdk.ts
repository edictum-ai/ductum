/**
 * Compatibility wrapper for the legacy `codex-sdk` harness id.
 *
 * Ductum's default local config still references `codex-sdk`, but the old SDK
 * path relied on post-hoc observation plus `danger-full-access`, which let
 * absolute writes escape the assigned worktree before Ductum could block them.
 *
 * Keep the public harness id for backwards compatibility, but run the session
 * through the approval-enforced app-server adapter instead.
 */

import type { RunId } from '@ductum/core'

import { CodexAppServerHarnessAdapter } from './codex-app-server.js'
import type { HarnessAdapter, HarnessSession } from './types.js'

export class CodexSDKHarnessAdapter implements HarnessAdapter {
  private readonly delegate: CodexAppServerHarnessAdapter

  constructor(
    apiUrl: string,
    options?: {
      evaluateApproval?: (runId: RunId, toolName: string, toolArgs: Record<string, unknown>) => Promise<boolean>
    },
  ) {
    this.delegate = new CodexAppServerHarnessAdapter(apiUrl, {
      evaluateApproval: options?.evaluateApproval,
    })
  }

  async spawn(...args: Parameters<HarnessAdapter['spawn']>): Promise<HarnessSession> {
    return await this.delegate.spawn(...args)
  }

  async kill(...args: Parameters<HarnessAdapter['kill']>): Promise<void> {
    await this.delegate.kill(...args)
  }

  async isAlive(...args: Parameters<HarnessAdapter['isAlive']>): Promise<boolean> {
    return await this.delegate.isAlive(...args)
  }
}
