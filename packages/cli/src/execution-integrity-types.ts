import type { ExecutionIssue, ExecutionMode } from '@ductum/core'

export interface ExecutionIntegrityFields {
  executionMode: ExecutionMode
  executionIssues: ExecutionIssue[]
  hasDuctumLineage: boolean
  hasExternalOutcome: boolean
  externalOutcome: string | null
  bakeoffOutcome: string | null
}

export interface ExecutionIntegrityReport {
  generatedAt: string
  summary: {
    taskCount: number
    runCount: number
    issueCount: number
    taskIssueCount?: number
    runIssueCount?: number
    taskModes: Record<ExecutionMode, number>
    runModes: Record<ExecutionMode, number>
    issues?: ExecutionIntegrityIssueSample[]
    issuesTruncated?: boolean
  }
  tasks: Array<ExecutionIntegrityFields & {
    taskId: string
    taskName: string
    taskStatus: string
    specId: string
    specName: string
    projectName: string
    runIds: string[]
  }>
  runs: Array<ExecutionIntegrityFields & {
    runId: string
    taskId: string
    taskName: string
    specName: string
    projectName: string
    stage: string
    terminalState: string | null
    sessionId: string | null
    commitSha: string | null
    worktreePaths: string[] | null
  }>
}

export interface ExecutionIntegrityIssueSample {
  scope: 'task' | 'run'
  id: string
  projectName: string
  specName: string
  taskName: string
  runId: string | null
  executionMode: ExecutionMode
  issueCode: string
  issueMessage: string
  status: string
}
