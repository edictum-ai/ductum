import type { PostCompletionConfig } from './post-completion.js'
import type { EvidenceRepo, ProjectRepo, RunRepo, SpecRepo, TaskRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { DuctumEventEmitter } from './events.js'
import type { RunId, SpecId } from './types.js'

/** Resolved dispatch intent the dispatcher acts on before spawning. */
export interface RouterDispatchIntent {
  parentRunId?: RunId
  reuseWorktreeFromRunId?: RunId
}

export const DEFAULT_MAX_FIX_ITERATIONS = 3

export interface RouterContext {
  runRepo: RunRepo
  taskRepo: TaskRepo
  specRepo: SpecRepo
  projectRepo: ProjectRepo
  evidenceRepo?: EvidenceRepo
  stateMachine: RunStateMachine
  eventEmitter: DuctumEventEmitter
  postCompletion?: PostCompletionConfig
  hasLiveSession?: (runId: RunId) => boolean
  evaluateTaskDAG?: (specId: SpecId) => void
  transaction?: <T>(fn: () => T) => T
}
