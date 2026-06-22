import { classifyTask, log, type DispatcherMcpServer, type Run, type SpawnOptions, type Task } from '@ductum/core'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { emitHarnessEvent } from './canonical-events.js'
import { postActivity } from './rest.js'
import type { HarnessAdapter, HarnessSession, HarnessSessionResult } from './types.js'

const MOCK_COMPLETION_DELAY_MS = 50
const DEFAULT_MUTATION_DELAY_MS = 0
const MOCK_POISON_MARKER = 'DUCTUM_MOCK_POISON:'

interface ActiveMockSession {
  sessionId: string
  runId: Run['id']
  completed: boolean
  killRequested: boolean
  timer: NodeJS.Timeout | null
  resolve(result: HarnessSessionResult): void
}

export class MockAgentCallHarnessAdapter implements HarnessAdapter {
  private readonly sessions = new Map<string, ActiveMockSession>()

  constructor(
    private readonly apiUrl: string,
    private readonly harnessId: string,
  ) {}

  async spawn(
    run: Run,
    task: Task,
    _systemPrompt: string,
    _mcpServer: DispatcherMcpServer,
    options?: SpawnOptions,
  ): Promise<HarnessSession> {
    const sessionId = `mock-${this.harnessId}-${run.id}`
    let resolveCompletion!: (result: HarnessSessionResult) => void
    const completion = new Promise<HarnessSessionResult>((resolve) => {
      resolveCompletion = resolve
    })
    const active: ActiveMockSession = {
      sessionId,
      runId: run.id,
      completed: false,
      killRequested: false,
      timer: null,
      resolve: resolveCompletion,
    }
    this.sessions.set(sessionId, active)
    active.timer = setTimeout(() => {
      void this.executeScenario(active, run, task, options?.workingDir)
    }, MOCK_COMPLETION_DELAY_MS)

    return {
      sessionId,
      runId: run.id,
      waitForCompletion: async () => await completion,
    }
  }

  async kill(sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.sessions.get(sessionId)
    if (active == null || active.completed) return
    active.killRequested = true
    if (active.timer != null) clearTimeout(active.timer)
    this.finish(active, {
      exitReason: reason === 'completed' ? 'completed' : 'killed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const active = this.sessions.get(sessionId)
    return active != null && !active.completed && !active.killRequested
  }

  private async executeScenario(
    active: ActiveMockSession,
    run: Run,
    task: Task,
    workingDir: string | undefined,
  ): Promise<void> {
    if (active.killRequested) return
    try {
      const poisonReason = extractMockPoisonReason(task.prompt)
      if (poisonReason != null) {
        await postActivity(this.apiUrl, run.id, 'result', `Mock deterministic poison: ${poisonReason}`)
        this.finish(active, { exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0, failReason: poisonReason })
        return
      }

      const taskKind = classifyTask(task).kind
      if (taskKind === 'review') {
        await this.recordCompletion(
          run.id,
          [
            'Mock review passed.',
            '',
            '## Final verdict',
            '',
            'PASS: README bootstrap diff matches the requested one-line change.',
          ].join('\n'),
        )
      } else {
        const mutated = await this.applyPromptMutation(active, run.id, task, workingDir)
        if (!mutated || active.killRequested) return
        await this.recordCompletion(
          run.id,
          'Appended the requested README line and verified the diff in the worktree.',
        )
      }
      this.finish(active, { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await postActivity(this.apiUrl, run.id, 'result', `Mock harness failed: ${message}`)
      log.error('mock-harness', `[${run.id.slice(0, 8)}] ${message}`)
      this.finish(active, { exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    }
  }

  private async applyPromptMutation(
    active: ActiveMockSession,
    runId: Run['id'],
    task: Task,
    workingDir: string | undefined,
  ): Promise<boolean> {
    if (workingDir == null || workingDir.trim() === '') {
      throw new Error('mock harness missing working directory')
    }
    const instruction = extractAppendInstruction(task.prompt)
    if (instruction == null) {
      throw new Error(
        'mock harness only supports prompts that say `Append the line `...` to README.md`',
      )
    }
    const filePath = join(workingDir, instruction.filePath)
    if (!existsSync(filePath)) {
      throw new Error(`target file not found: ${instruction.filePath}`)
    }
    const current = readFileSync(filePath, 'utf-8')
    await emitHarnessEvent(this.apiUrl, runId, {
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: instruction.filePath },
      content: instruction.filePath,
      success: true,
    })
    await sleep(resolveMutationDelayMs())
    if (active.killRequested || active.completed) return false
    if (current.includes(instruction.line)) {
      throw new Error(`requested line already exists in ${instruction.filePath}`)
    }
    const next = current.endsWith('\n')
      ? `${current}${instruction.line}\n`
      : `${current}\n${instruction.line}\n`
    writeFileSync(filePath, next)
    await postActivity(this.apiUrl, runId, 'text', `mock ${this.harnessId}: appended line to ${instruction.filePath}`)
    return true
  }

  private async recordCompletion(runId: Run['id'], result: string): Promise<void> {
    await postActivity(this.apiUrl, runId, 'tool_call', JSON.stringify({ result }), 'ductum.complete')
  }

  private finish(active: ActiveMockSession, result: HarnessSessionResult) {
    if (active.completed) return
    active.completed = true
    if (active.timer != null) clearTimeout(active.timer)
    this.sessions.delete(active.sessionId)
    active.resolve(result)
  }
}

function extractAppendInstruction(prompt: string): { filePath: string; line: string } | null {
  const match = /Append the line `([^`]+)` to `?(README\.md)`?/i.exec(prompt)
  if (match?.[1] == null || match[2] == null) return null
  return { line: match[1], filePath: match[2] }
}

function extractMockPoisonReason(prompt: string): string | null {
  for (const line of prompt.split(/\r?\n/)) {
    const index = line.indexOf(MOCK_POISON_MARKER)
    if (index < 0) continue
    const reason = line.slice(index + MOCK_POISON_MARKER.length).trim()
    return reason === '' ? 'deterministic poison fixture' : reason
  }
  return null
}

function resolveMutationDelayMs(): number {
  const raw = process.env.DUCTUM_MOCK_AGENT_DELAY_MS
  if (raw == null || raw.trim() === '') return DEFAULT_MUTATION_DELAY_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MUTATION_DELAY_MS
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
