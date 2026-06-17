import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { DuctumEventEmitter } from './events.js'
import type { EvidenceRepo, RunRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { AgentId, RunId } from './types.js'

const execFileAsync = promisify(execFile)

export type WatcherType = 'ci' | 'review'

export interface WatcherConfig {
  type: WatcherType
  parentRunId: RunId
  commitSha: string
  pollIntervalMs: number
  timeoutMs: number
  prUrl: string
}

export interface CICheckResult {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'neutral' | 'skipped' | 'timed_out' | null
}

export interface ReviewResult {
  reviewer: string
  status: 'approved' | 'changes_requested' | 'commented' | 'pending'
  findings: string[]
}

export interface WatcherDependencies {
  runRepo: RunRepo
  evidenceRepo: EvidenceRepo
  stateMachine: RunStateMachine
  eventEmitter: DuctumEventEmitter
  /** Called when a watcher resolves — handles workflow reset on failure */
  onWatcherResolved?: (runId: RunId, type: WatcherType, passed: boolean) => Promise<void>
}

export type WatcherCommandRunner = (args: readonly string[]) => Promise<string>

export interface WatcherOptions {
  childAgentId?: AgentId
  commandRunner?: WatcherCommandRunner
  now?: () => number
}

export const DEFAULT_CI_POLL_INTERVAL_MS = 30_000
export const DEFAULT_REVIEW_POLL_INTERVAL_MS = 60_000
export const DEFAULT_CI_TIMEOUT_MS = 1_800_000
export const DEFAULT_REVIEW_TIMEOUT_MS = 3_600_000

export async function runGhCommand(args: readonly string[]): Promise<string> {
  const result = await execFileAsync('gh', [...args], { encoding: 'utf8' })
  return result.stdout
}
