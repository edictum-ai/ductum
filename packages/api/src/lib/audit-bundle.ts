import { createHash } from 'node:crypto'
import {
  redactPublicOutput,
  redactPublicText,
  type Decision,
  type Evidence,
  type Run,
  type RunId,
  type Spec,
  type SpecId,
  type Task,
  type TaskId,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'

export interface AuditBundleScope {
  runId?: string
}

export interface AuditBundle {
  schemaVersion: 1
  kind: 'ductum.audit_bundle.v1'
  scope: {
    type: 'run'
    runId: string
    taskId: string | null
    specId: string | null
    projectId: string | null
  }
  generatedAt: string
  context: {
    project: { id: string; name: string } | null
    spec: { id: string; name: string; status: string } | null
    task: { id: string; name: string; status: string } | null
    run: Pick<Run, 'id' | 'stage' | 'terminalState' | 'branch' | 'commitSha' | 'prNumber' | 'prUrl' | 'ciStatus' | 'reviewStatus'>
  }
  records: {
    decisions: BundledDecision[]
    evidence: BundledEvidence[]
  }
  manifest: {
    algorithm: 'sha256'
    contextHash: string
    recordHashes: Array<{ section: 'decisions' | 'evidence'; id: string; sha256: string }>
    manifestHash: string
    excludes: ['generatedAt']
  }
}

export interface BundledDecision {
  id: string
  specId: string | null
  taskId: string | null
  runId: string | null
  decision: string
  context: string
  alternatives: string[] | null
  decidedBy: string
  supersedesId: string | null
  createdAt: string
  contentHash: string
}

export interface BundledEvidence {
  id: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
  contentHash: string
}

export function buildAuditBundle(context: ApiContext, scope: AuditBundleScope): AuditBundle {
  const runId = scope.runId?.trim()
  if (runId == null || runId === '') throw new ValidationError('runId is required')

  const run = context.repos.runs.get(runId as RunId)
  if (run == null) throw new NotFoundError(`Run not found: ${runId}`)

  const task = context.repos.tasks.get(run.taskId)
  const spec = task == null ? null : context.repos.specs.get(task.specId)
  const project = spec == null ? null : context.repos.projects.get(spec.projectId)
  const bundleScope = {
    type: 'run' as const,
    runId: run.id,
    taskId: task?.id ?? null,
    specId: spec?.id ?? null,
    projectId: project?.id ?? null,
  }
  const bundleContext = {
    project: project == null ? null : { id: project.id, name: project.name },
    spec: spec == null ? null : specContext(spec),
    task: task == null ? null : taskContext(task),
    run: runContext(run),
  }
  const decisions = relevantDecisions(context, bundleScope)
    .sort(compareCreatedThenId)
    .map(bundleDecision)
  const evidence = context.repos.evidence
    .list(run.id)
    .sort(compareCreatedThenId)
    .map(bundleEvidence)
  const contextHash = sha256(bundleContext)
  const recordHashes = [
    ...decisions.map((item) => ({ section: 'decisions' as const, id: item.id, sha256: item.contentHash })),
    ...evidence.map((item) => ({ section: 'evidence' as const, id: item.id, sha256: item.contentHash })),
  ]
  const manifestHash = sha256({ scope: bundleScope, contextHash, recordHashes })

  return {
    schemaVersion: 1,
    kind: 'ductum.audit_bundle.v1',
    scope: bundleScope,
    generatedAt: context.now().toISOString(),
    context: bundleContext,
    records: { decisions, evidence },
    manifest: {
      algorithm: 'sha256',
      contextHash,
      recordHashes,
      manifestHash,
      excludes: ['generatedAt'],
    },
  }
}

function bundleDecision(decision: Decision): BundledDecision {
  const record = scrubBundleValue({
    id: decision.id,
    specId: decision.specId,
    taskId: decision.taskId,
    runId: decision.runId,
    decision: decision.decision,
    context: decision.context,
    alternatives: decision.alternatives,
    decidedBy: decision.decidedBy,
    supersedesId: decision.supersedesId,
    createdAt: decision.createdAt,
  }) as Omit<BundledDecision, 'contentHash'>
  return { ...record, contentHash: sha256(record) }
}

function relevantDecisions(context: ApiContext, scope: AuditBundle['scope']): Decision[] {
  const keyed = new Map<string, Decision>()
  for (const filters of [
    { runId: scope.runId as RunId },
    scope.taskId == null ? null : { taskId: scope.taskId as TaskId },
    scope.specId == null ? null : { specId: scope.specId as SpecId },
  ]) {
    if (filters == null) continue
    for (const decision of context.repos.decisions.list(filters)) keyed.set(decision.id, decision)
  }
  return Array.from(keyed.values())
}

function bundleEvidence(evidence: Evidence): BundledEvidence {
  const payload = scrubBundleValue(redactPublicOutput(evidence.payload)) as Record<string, unknown>
  const record = {
    id: evidence.id,
    type: evidence.type,
    payload,
    createdAt: evidence.createdAt,
  } satisfies Omit<BundledEvidence, 'contentHash'>
  return { ...record, contentHash: sha256(record) }
}

function runContext(run: Run): AuditBundle['context']['run'] {
  return {
    id: run.id,
    stage: run.stage,
    terminalState: run.terminalState,
    branch: run.branch,
    commitSha: run.commitSha,
    prNumber: run.prNumber,
    prUrl: run.prUrl,
    ciStatus: run.ciStatus,
    reviewStatus: run.reviewStatus,
  }
}

function specContext(spec: Spec): NonNullable<AuditBundle['context']['spec']> {
  return { id: spec.id, name: spec.name, status: spec.status }
}

function taskContext(task: Task): NonNullable<AuditBundle['context']['task']> {
  return { id: task.id, name: task.name, status: task.status }
}

function compareCreatedThenId<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value != null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, sortKeys(obj[key])]))
  }
  return value
}

function scrubBundleValue(value: unknown): unknown {
  if (typeof value === 'string') return shortenHostPaths(redactPublicText(value))
  if (Array.isArray(value)) return value.map(scrubBundleValue)
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(redactPublicOutput(value as Record<string, unknown>))
        .map(([key, entry]) => [key, scrubBundleValue(entry)]),
    )
  }
  return value
}

function shortenHostPaths(value: string): string {
  return value.replace(
    /(^|[\s"'=:([{])\/(?:Users|home|private|var|tmp|Volumes)\/[^\s"'<>)]*/g,
    (match, prefix: string) => {
      const path = match.slice(prefix.length)
      const parts = path.split('/').filter(Boolean)
      const projectIndex = parts.indexOf('project')
      if (projectIndex >= 0) return `${prefix}${parts.slice(projectIndex + 1).join('/')}`
      const worktreeIndex = parts.lastIndexOf('worktrees')
      if (worktreeIndex >= 0) return `${prefix}${parts.slice(worktreeIndex + 1).join('/')}`
      if ((parts[0] === 'Users' || parts[0] === 'home') && parts.length > 2) {
        return `${prefix}host-path/${parts.slice(2).join('/')}`
      }
      const tail = parts.slice(-3).join('/')
      return `${prefix}host-path/${tail}`
    },
  )
}
