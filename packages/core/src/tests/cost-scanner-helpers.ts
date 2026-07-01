import fs from 'node:fs'
import path from 'node:path'

/**
 * Shared fixtures for cost-scanner tests: synthetic Codex and Claude
 * Code session-log files written under a caller-supplied `homeDir` (a
 * tmp dir), so the scanner's `discoverFiles` walk finds them exactly as
 * it would a real `~/.codex` / `~/.claude` tree. Extracted here so the
 * measured-marker tests and the parser tests share one source of truth
 * for the on-disk jsonl shape.
 */

export interface CodexTurnTotals {
  input: number
  cached: number
  output: number
}

export interface ClaudeMessageTokens {
  input: number
  cacheRead: number
  cacheCreation: number
  output: number
}

export function writeCodexSession(
  homeDir: string,
  sessionId: string,
  cwd: string,
  model: string,
  totals: CodexTurnTotals[],
  options: { archived?: boolean; date?: string } = {},
): string {
  const date = options.date ?? '2026-04-07'
  const [yyyy, mm, dd] = date.split('-')
  const dir = options.archived === true
    ? path.join(homeDir, '.codex', 'archived_sessions')
    : path.join(homeDir, '.codex', 'sessions', yyyy ?? '', mm ?? '', dd ?? '')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `rollout-${date}T12-00-00-${sessionId}.jsonl`)

  const lines: string[] = []
  lines.push(JSON.stringify({
    timestamp: `${date}T12:00:00.000Z`,
    type: 'session_meta',
    payload: { id: sessionId, cwd, originator: 'codex_exec' },
  }))
  lines.push(JSON.stringify({
    timestamp: `${date}T12:00:00.500Z`,
    type: 'turn_context',
    payload: { model, cwd },
  }))
  for (const [i, total] of totals.entries()) {
    lines.push(JSON.stringify({
      timestamp: `${date}T12:00:0${i}.000Z`,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: total.input,
            cached_input_tokens: total.cached,
            output_tokens: total.output,
            reasoning_output_tokens: 0,
            total_tokens: total.input + total.output,
          },
          last_token_usage: {
            input_tokens: total.input,
            cached_input_tokens: total.cached,
            output_tokens: total.output,
          },
        },
      },
    }))
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
  return filePath
}

export function writeClaudeSession(
  homeDir: string,
  sessionId: string,
  cwd: string,
  model: string,
  messages: ClaudeMessageTokens[],
  options: { date?: string } = {},
): string {
  const date = options.date ?? '2026-04-07'
  // Encode cwd the way claude-agent-sdk does: replace path separators
  // and unsafe chars with dashes.
  const encoded = `-${cwd.replaceAll('/', '-')}`
  const dir = path.join(homeDir, '.claude', 'projects', encoded)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const lines: string[] = []
  for (const [i, m] of messages.entries()) {
    lines.push(JSON.stringify({
      sessionId,
      cwd,
      type: 'assistant',
      timestamp: `${date}T12:00:0${i}.000Z`,
      message: {
        model,
        type: 'message',
        usage: {
          input_tokens: m.input,
          cache_read_input_tokens: m.cacheRead,
          cache_creation_input_tokens: m.cacheCreation,
          output_tokens: m.output,
        },
      },
    }))
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
  return filePath
}
