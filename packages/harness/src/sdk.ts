import { query, type HookCallback, type Options, type Query, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { DispatcherMcpServer } from '@ductum/core'

export type ClaudeHookCallback = HookCallback
export type ClaudeQuery = Query
export type ClaudeQueryMessage = SDKMessage
export type ClaudeResultMessage = SDKResultMessage
export type ClaudeQueryOptions = Options

export function startClaudeQuery(prompt: string, options: Options): Query {
  return query({ prompt, options })
}

/**
 * Build the `mcpServers` entry the Claude Agent SDK expects when a
 * caller wants to register an in-process `McpServer` instance.
 *
 * D163 §6 + the P4 spec call out SDK-specific unsafe typing as a thing
 * that must not leak through the rest of the codebase. The Claude SDK
 * exports `McpSdkServerConfigWithInstance`, but in this monorepo the
 * `McpServer` instance attached to `DuctumMcpServer.mcp` comes from a
 * different `@modelcontextprotocol/sdk` resolution than the one the
 * Claude SDK's `.d.ts` ships with, so TypeScript treats the two
 * `McpServer` types as nominally distinct. The cast lives here so the
 * spawn path does not need to repeat it. The helper accepts the
 * canonical `DispatcherMcpServer` from core and reads the `.mcp`
 * instance opaquely — the runtime contract is that the dispatcher
 * always passes a `DuctumMcpServer`.
 */
export function buildClaudeMcpServers(
  name: string,
  mcpServer: DispatcherMcpServer,
): NonNullable<ClaudeQueryOptions['mcpServers']> {
  const instance = (mcpServer as { mcp?: unknown }).mcp
  return {
    [name]: { type: 'sdk', name, instance },
  } as unknown as NonNullable<ClaudeQueryOptions['mcpServers']>
}

/**
 * Claude SDK permission-mode literal used when Ductum's workflow
 * runtime is the sole authority on tool gating. Isolated here so the
 * spawn path does not need to know the SDK-specific string set.
 */
export const CLAUDE_BYPASS_PERMISSION_MODE: NonNullable<ClaudeQueryOptions['permissionMode']> = 'bypassPermissions'
