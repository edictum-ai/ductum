import type { RunActivity } from '@/api/client'
import { redactGenericPublicTokens } from '@ductum/public-redaction'

export interface OperatorLabel {
  title: string
  meta?: string
  raw?: string
  tone?: 'info' | 'ok' | 'warn' | 'err'
}

export function compactActivityText(text: string, max = 110): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '...' : oneLine
}

export function redactSensitiveText(value: string): string {
  const redacted = redactGenericPublicTokens(value)
    .replace(/((?:proxy-)?authorization:\s*(?:[^\s"']+\s+)?)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, '$1[redacted]')
    .replace(/((?:x-)?api-key:\s*)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, '$1[redacted]')
    .replace(/([A-Z0-9_-]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|PAT|SIGNATURE)[A-Z0-9_-]*=)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, '$1[redacted]')
    .replace(/([?&#](?:sig|signature|access|se|token|key|secret|password|passwd|credential|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&#\s"']+/gi, '$1[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[redacted]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|(?:sk|rk)_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[redacted]')
  return redacted.replace(/\[redacted\]/gi, '[hidden]')
}

function looksStructuredPayload(content: string): boolean {
  const trimmed = content.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[{') || trimmed.startsWith('[[') || trimmed === '[]'
}

function parseStructuredRecords(content: string): unknown[] | null {
  const trimmed = content.trim()
  if (trimmed === '') return null
  if (looksStructuredPayload(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      // Fall through so NDJSON can still be summarized line-by-line.
    }
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2 || lines.some((line) => !(line.startsWith('{') || line.startsWith('[')))) return null
  try {
    return lines.map((line) => JSON.parse(line))
  } catch {
    return null
  }
}

function shortenPath(path: string): string {
  const worktreeMatch = path.match(/\/ductum-worktrees\/[^/]+\/ductum(?:\/(.+))?/)
  if (worktreeMatch) return worktreeMatch[1] ?? '.'
  const projectMatch = path.match(/\/project\/[^/]+\/(.+)/)
  if (projectMatch) return projectMatch[1]!
  return path.replace(/.*\/project\//, '')
}

export const INTERNAL_PAYLOAD_KEYS = new Set([
  'callId',
  'completedAtMs',
  'boundRunId',
  'eventId',
  'itemId',
  'payloadId',
  'runId',
  'sessionId',
  'startedAtMs',
  'threadId',
  'toolName',
  'turnId',
])

function isInternalOnlyPayload(value: unknown): value is Record<string, unknown> {
  if (value == null || Array.isArray(value) || typeof value !== 'object') return false
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((key) => INTERNAL_PAYLOAD_KEYS.has(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && !Array.isArray(value) && typeof value === 'object'
}

function hasInternalPayloadKey(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).some((key) => INTERNAL_PAYLOAD_KEYS.has(key))
}

function displayPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  for (const key of ['args', 'arguments', 'input', 'parameters']) {
    const nested = value[key]
    if (isRecord(nested)) return nested
    if (typeof nested === 'string') {
      try {
        const parsed = JSON.parse(nested)
        if (isRecord(parsed)) return parsed
      } catch {
        // Keep the outer record fallback for non-JSON string args.
      }
    }
  }
  return value
}

export function operatorToolName(toolName: string | null): string {
  if (!toolName) return 'Tool'
  const raw = toolName.replace(/^mcp__ductum__(ductum_)?/, 'ductum_').replace(/^mcp__/, '')
  const normalized = raw.replace(/\./g, '_')
  const labels: Record<string, string> = {
    Bash: 'Run command',
    Read: 'Read file',
    Write: 'Edit file',
    Edit: 'Edit file',
    MultiEdit: 'Edit files',
    Grep: 'Search files',
    Glob: 'Find files',
    TodoWrite: 'Update task list',
    McpElicitation: 'Approval prompt',
    ductum_complete: 'Finish attempt',
    ductum_gate_check: 'Check workflow gate',
    ductum_record_evidence: 'Record evidence',
    ductum_update_progress: 'Post progress update',
    ductum_heartbeat: 'Heartbeat',
  }
  return labels[normalized] ?? raw.replace(/^ductum_/, '').replace(/[_-]/g, ' ')
}

export function formatToolArg(content: string): { main: string; detail?: string; full?: string } {
  try {
    const parsed = JSON.parse(content)
    const full = redactSensitiveText(JSON.stringify(parsed, null, 2))
    const payload = displayPayload(parsed)
    if (payload == null) return { main: 'tool args hidden', full }
    if (typeof payload.file_path === 'string') {
      const suffix = typeof payload.old_string === 'string' ? ' (edit)' : typeof payload.content === 'string' ? ' (write)' : ''
      return { main: redactSensitiveText(shortenPath(payload.file_path)) + suffix, full }
    }
    if (typeof payload.pattern === 'string') {
      const path = typeof payload.path === 'string' ? redactSensitiveText(shortenPath(payload.path)) : undefined
      return { main: redactSensitiveText(payload.pattern), detail: path ? `in ${path}` : undefined, full }
    }
    if (typeof payload.command === 'string') {
      const desc = typeof payload.description === 'string' ? redactSensitiveText(payload.description) : undefined
      return { main: redactSensitiveText(payload.command), detail: desc, full }
    }
    if (typeof payload.result === 'string') return { main: 'summary submitted', detail: compactActivityText(redactSensitiveText(payload.result)), full }
    if (typeof payload.query === 'string') return { main: redactSensitiveText(payload.query), full }
    if (typeof payload.target_stage === 'string') return { main: redactSensitiveText(payload.target_stage), full }
    if (typeof payload.message === 'string') return { main: compactActivityText(redactSensitiveText(payload.message)), full }
    if (Array.isArray(payload.todos)) {
      const count = payload.todos.length
      const inProgress = payload.todos.find((t: { status?: string; content?: string }) => t.status === 'in_progress')
      const label = redactSensitiveText(inProgress?.content ?? `${count} todo${count === 1 ? '' : 's'}`)
      return { main: label, detail: `${count} item${count === 1 ? '' : 's'}`, full }
    }
    if (isInternalOnlyPayload(parsed) || isInternalOnlyPayload(payload)) return { main: 'internal tool payload hidden', full }
    return { main: hasInternalPayloadKey(parsed) || hasInternalPayloadKey(payload) ? 'tool args hidden' : 'structured tool args', full }
  } catch {
    if (looksStructuredPayload(content)) return { main: 'tool args hidden', full: redactSensitiveText(content) }
    return { main: shortenPath(redactSensitiveText(content)) }
  }
}

function approvalMeta(payload: string): string {
  const arg = formatToolArg(payload)
  if (arg.main.trim().startsWith('{') || arg.main.trim().startsWith('[')) return 'internal approval payload hidden'
  try {
    if (isInternalOnlyPayload(JSON.parse(payload))) return 'internal approval payload hidden'
  } catch {
    // Non-JSON payloads are handled by formatToolArg.
  }
  return arg.main
}

function redactOperatorLabel(label: OperatorLabel): OperatorLabel {
  return {
    ...label,
    title: redactSensitiveText(label.title),
    meta: label.meta == null ? undefined : redactSensitiveText(label.meta),
    raw: label.raw == null ? undefined : redactSensitiveText(label.raw),
  }
}

export function describeStructuredPayload(content: string, toolName: string | null): OperatorLabel | null {
  const records = parseStructuredRecords(content)
  if (!records) return null
  if (records.length > 1) {
    const kinds = records.flatMap((record) => {
      if (!isRecord(record)) return []
      const value = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : null
      return value ? [value.replace(/[_-]/g, ' ')] : []
    })
    return {
      title: `Structured activity payload (${records.length} events)`,
      meta: kinds.length > 0 ? compactActivityText(kinds.slice(0, 3).join(' · '), 140) : undefined,
      raw: content,
      tone: 'info',
    }
  }
  const record = records[0]
  if (Array.isArray(record)) return { title: `Tool returned ${record.length} record${record.length === 1 ? '' : 's'}`, raw: content, tone: 'info' }
  if (!isRecord(record)) return { title: 'Structured activity payload', raw: content, tone: 'info' }
  const payloadTool = typeof record.toolName === 'string' ? record.toolName : typeof record.name === 'string' ? record.name : toolName
  if (payloadTool) {
    const arg = formatToolArg(JSON.stringify(record))
    return { title: operatorToolName(payloadTool), meta: arg.main, raw: content, tone: 'info' }
  }
  for (const key of ['message', 'content', 'text', 'summary'] as const) {
    if (typeof record[key] === 'string') return { title: compactActivityText(redactSensitiveText(record[key]), 140), raw: content, tone: 'info' }
  }
  if (typeof record.error === 'string') return { title: 'Structured activity error', meta: compactActivityText(redactSensitiveText(record.error)), raw: content, tone: 'err' }
  const kind = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : null
  if (kind) return { title: `Structured activity: ${kind.replace(/[_-]/g, ' ')}`, raw: content, tone: 'info' }
  return { title: 'Structured activity payload', meta: `${Object.keys(record).length} field${Object.keys(record).length === 1 ? '' : 's'}`, raw: content, tone: 'info' }
}

export function describeActivityMessage(content: string, toolName: string | null): OperatorLabel | null {
  const approval = content.match(/^approval requested:\s*(\S+)?\s*([\s\S]*)$/i)
  if (approval) {
    const token = approval[1]
    const tokenIsPayload = token?.startsWith('{') || token?.startsWith('[')
    const tool = toolName ?? (tokenIsPayload ? null : token) ?? null
    const payload = tokenIsPayload ? `${token}${approval[2] ? ` ${approval[2]}` : ''}` : approval[2] ?? ''
    const meta = approvalMeta(payload)
    const title = tool === 'Bash'
      ? 'Approval requested to run command'
      : ['Write', 'Edit', 'MultiEdit'].includes(tool ?? '')
        ? 'Approval requested to edit files'
        : tool == null
          ? 'Approval requested'
          : `Approval requested: ${operatorToolName(tool)}`
    return { title, meta, raw: content, tone: 'warn' }
  }

  const elicitation = content.match(/run tool "([^"]+)"/i)
  if (elicitation && (toolName === 'McpElicitation' || /McpElicitation/i.test(content))) {
    return { title: `Agent asked to ${operatorToolName(elicitation[1]!).toLowerCase()}`, meta: 'MCP approval prompt', raw: content, tone: 'warn' }
  }
  if (/Invalid custom evidence kind/i.test(content)) {
    return { title: 'Custom evidence rejected: unsupported kind', meta: 'Open raw details for the accepted kinds.', raw: content, tone: 'err' }
  }
  if (/CHECK constraint failed/i.test(content)) {
    const title = /type IN/i.test(content) ? 'Evidence rejected: unsupported evidence type' : 'Database validation rejected this request'
    return { title, meta: 'Open raw details for the original database message.', raw: content, tone: 'err' }
  }
  return null
}

export function describeActivityResult(content: string, toolName: string | null): OperatorLabel | null {
  const message = describeActivityMessage(content, toolName)
  if (message) return message
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    const structured = describeStructuredPayload(content, toolName)
    if (structured) return structured
    return toolName == null ? null : {
      title: `${operatorToolName(toolName)} output`,
      meta: compactActivityText(redactSensitiveText(content), 140),
      raw: content,
      tone: 'info',
    }
  }
  if (parsed == null) return null
  if (Array.isArray(parsed)) return { title: `Tool returned ${parsed.length} record${parsed.length === 1 ? '' : 's'}`, raw: content, tone: 'info' }
  if (typeof parsed !== 'object') return { title: 'Tool returned structured data', raw: content, tone: 'info' }
  const record = parsed as Record<string, unknown>
  if (record.ok === true) return { title: `${operatorToolName(toolName)} succeeded`, raw: content, tone: 'ok' }
  if (typeof record.error === 'string') return { title: `${operatorToolName(toolName)} failed`, meta: compactActivityText(redactSensitiveText(record.error)), raw: content, tone: 'err' }
  if (typeof record.boundRunId === 'string') return { title: 'Ductum returned attempt context', raw: content, tone: 'info' }
  return { title: 'Tool returned structured data', raw: content, tone: 'info' }
}

export function operatorActivityLabel(activity: RunActivity): OperatorLabel {
  const resultLike = activity.kind === 'result'
    || activity.kind === 'tool_result'
    || (activity.kind !== 'tool_call' && looksStructuredPayload(activity.content))
  const structured = resultLike
    ? describeActivityResult(activity.content, activity.toolName)
    : describeActivityMessage(activity.content, activity.toolName)
  if (structured) return redactOperatorLabel(structured)
  if (activity.kind === 'tool_call') {
    const arg = formatToolArg(activity.content)
    return redactOperatorLabel({ title: operatorToolName(activity.toolName), meta: arg.main, raw: activity.content, tone: 'info' })
  }
  return redactOperatorLabel({ title: compactActivityText(redactSensitiveText(activity.content), 140), raw: activity.content, tone: activity.kind === 'summary' ? 'ok' : 'info' })
}
