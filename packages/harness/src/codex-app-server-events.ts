import { collectWorkflowReadPathCandidates, extractWorkflowReadPath } from '@ductum/core'

import type { HarnessEvent } from './types.js'

export interface PendingCodexToolApproval {
  toolName: string
  args: Record<string, unknown>
  workflowEvidence?: ReadonlyArray<{ toolName: string; args: Record<string, unknown> }>
}

type ToolResultEvent = Extract<HarnessEvent, { type: 'tool.result' }>

export function getCodexItemId(params: unknown): string | null {
  const item = asRecord(asRecord(params)?.item)
  const itemId = asString(item?.id)
  if (itemId != null) return itemId
  return asString(asRecord(params)?.itemId)
}

export function resolveCodexCompletedToolResult(
  params: unknown,
  approved: PendingCodexToolApproval | null | undefined,
): ToolResultEvent | null {
  return resolveCodexCompletedToolResults(params, approved)[0] ?? null
}

export function resolveCodexCompletedToolResults(
  params: unknown,
  approved: PendingCodexToolApproval | null | undefined,
): ToolResultEvent[] {
  const item = asRecord(asRecord(params)?.item)
  if (item == null) return []

  if (item.type === 'commandExecution') {
    const command = asString(item.command) ?? asString(approved?.args.command)
    if (approved == null) {
      const inferred = command == null ? null : resolveCodexCommandApproval(command)
      if (inferred?.toolName !== 'Read') return []
      return resolveCommandExecutionResults(item, inferred)
    }
    return resolveCommandExecutionResults(item, approved)
  }
  if (item.type === 'fileChange') {
    if (approved == null) return []
    return [resolveFileChangeResult(item, approved)]
  }
  if (item.type === 'mcpToolCall') {
    return [resolveMcpToolCallResult(item)]
  }
  return []
}

export function resolveCodexCommandApproval(command: string): PendingCodexToolApproval {
  const filePath = extractWorkflowReadPath(command)
  if (filePath != null) {
    const readPaths = collectReadPathsWithPrimaryFirst(command, filePath)
    return {
      toolName: 'Read',
      args: { file_path: filePath },
      ...(readPaths.length > 1
        ? { workflowEvidence: readPaths.map((path) => ({ toolName: 'Read', args: { file_path: path } })) }
        : {}),
    }
  }
  return { toolName: 'Bash', args: { command } }
}

function resolveCommandExecutionResults(
  item: Record<string, unknown>,
  approved: PendingCodexToolApproval,
): ToolResultEvent[] {
  const command = asString(item.command) ?? asString(approved.args.command)
  if (command == null || command.trim() === '') return []
  const exitCode = asNumber(item.exitCode)
  const success = item.status === 'completed' && exitCode === 0
  const primary: ToolResultEvent = {
    type: 'tool.result',
    toolName: approved.toolName,
    args: approved.toolName === 'Read' ? approved.args : { command },
    content: asString(item.aggregatedOutput) ?? '',
    success,
  }
  if (!success || approved.workflowEvidence == null || approved.workflowEvidence.length < 2) {
    return [primary]
  }
  return [
    primary,
    ...approved.workflowEvidence.slice(1).map((event) => ({
      type: 'tool.result' as const,
      toolName: event.toolName,
      args: event.args,
      content: '',
      success: true,
    })),
  ]
}

function resolveFileChangeResult(
  item: Record<string, unknown>,
  approved: PendingCodexToolApproval,
): ToolResultEvent {
  const changes = Array.isArray(item.changes) ? item.changes : null
  return {
    type: 'tool.result',
    toolName: approved.toolName,
    args: changes == null ? approved.args : { changes },
    content: '',
    success: item.status === 'completed',
  }
}

function resolveMcpToolCallResult(item: Record<string, unknown>): ToolResultEvent {
  const server = asString(item.server)
  const tool = asString(item.tool) ?? 'mcp.tool'
  const error = item.error == null ? null : item.error
  return {
    type: 'tool.result',
    toolName: server == null ? tool : `${server}.${tool}`,
    args: asRecord(item.arguments) ?? {},
    content: JSON.stringify(error ?? item.result ?? {}),
    success: undefined,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value == null || typeof value !== 'object' || Array.isArray(value)
    ? null
    : value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function collectReadPathsWithPrimaryFirst(command: string, primary: string): string[] {
  const ordered = [primary]
  for (const candidate of collectWorkflowReadPathCandidates(command)) {
    if (!ordered.includes(candidate)) ordered.push(candidate)
  }
  return ordered
}
