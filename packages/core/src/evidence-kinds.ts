export type EvidenceKind =
  | 'worktree.snapshot'
  | 'harness.failure'
  | 'operator.cancel'
  | 'operator.note'
  | 'exit_demo.run'

export interface WorktreeSnapshotEvidence {
  kind: 'worktree.snapshot'
  ductumEvidenceProducer?: string
  branch: string
  commitSha: string
  diffStat: { filesChanged: number; insertions: number; deletions: number }
  verifyOutput: { command: string; exitCode: number; tail: string }
  timestamp: string
}

export interface HarnessFailureEvidence {
  kind: 'harness.failure'
  reason: string
  exitReason: 'failed'
  evidence: unknown
}

export interface OperatorCancelEvidence {
  kind: 'operator.cancel'
  reason: string
  worktreePreserved: boolean
  dirtyWorktree?: boolean
  cleanupAt: string | null
  timestamp: string
}

export interface OperatorNoteEvidence {
  kind: 'operator.note'
  note: string
  source?: string
  timestamp?: string
}

export type ExitDemoPhase =
  | 'install_g'
  | 'init_anthropic_auth'
  | 'serve_ready'
  | 'spec_imported'
  | 'run_awaiting_approval'
  | 'approve_clicked'
  | 'merged'

export interface ExitDemoRunEvidence {
  kind: 'exit_demo.run'
  schemaVersion: 1
  data: {
    demoName: 'bootstrap-redesign-p5'
    machineSignature: { osHash: string; osPlatform: string; hostnameHash: string }
    timeline: Array<{ phase: ExitDemoPhase; t: number }>
    totalSeconds: number
    mergedCommitSha: string
    mergedBranch: string
    agentName: string
    promptText: string
    operatorActions: ['browser_auth', 'approve_click']
  }
}

export type TypedEvidencePayload =
  | WorktreeSnapshotEvidence
  | HarnessFailureEvidence
  | OperatorCancelEvidence
  | OperatorNoteEvidence
  | ExitDemoRunEvidence

export interface EvidenceKindDefinition<K extends EvidenceKind, T extends TypedEvidencePayload> {
  kind: K
  validate: (value: unknown) => value is T
}

export const EVIDENCE_KINDS = {
  'worktree.snapshot': definition('worktree.snapshot', isWorktreeSnapshotEvidence),
  'harness.failure': definition('harness.failure', isHarnessFailureEvidence),
  'operator.cancel': definition('operator.cancel', isOperatorCancelEvidence),
  'operator.note': definition('operator.note', isOperatorNoteEvidence),
  'exit_demo.run': definition('exit_demo.run', isExitDemoRunEvidence),
} satisfies Record<EvidenceKind, EvidenceKindDefinition<EvidenceKind, TypedEvidencePayload>>

export function getEvidenceKind(value: unknown): EvidenceKind | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  return typeof kind === 'string' && kind in EVIDENCE_KINDS
    ? kind as EvidenceKind
    : null
}

export function validateEvidencePayload(value: unknown): value is TypedEvidencePayload {
  const kind = getEvidenceKind(value)
  return kind == null ? false : EVIDENCE_KINDS[kind].validate(value)
}

function definition<K extends EvidenceKind, T extends TypedEvidencePayload>(
  kind: K,
  validate: (value: unknown) => value is T,
): EvidenceKindDefinition<K, T> {
  return { kind, validate }
}

function isWorktreeSnapshotEvidence(value: unknown): value is WorktreeSnapshotEvidence {
  if (!hasKind(value, 'worktree.snapshot')) return false
  return isString(value.branch)
    && isString(value.commitSha)
    && isDiffStat(value.diffStat)
    && isVerifyOutput(value.verifyOutput)
    && isString(value.timestamp)
}

function isHarnessFailureEvidence(value: unknown): value is HarnessFailureEvidence {
  return hasKind(value, 'harness.failure')
    && isString(value.reason)
    && value.exitReason === 'failed'
}

function isOperatorCancelEvidence(value: unknown): value is OperatorCancelEvidence {
  return hasKind(value, 'operator.cancel')
    && isString(value.reason)
    && typeof value.worktreePreserved === 'boolean'
    && (value.dirtyWorktree === undefined || typeof value.dirtyWorktree === 'boolean')
    && (value.cleanupAt === null || isString(value.cleanupAt))
    && isString(value.timestamp)
}

function isOperatorNoteEvidence(value: unknown): value is OperatorNoteEvidence {
  return hasKind(value, 'operator.note') && isString(value.note)
}

function isExitDemoRunEvidence(value: unknown): value is ExitDemoRunEvidence {
  if (!hasKind(value, 'exit_demo.run') || value.schemaVersion !== 1 || !isRecord(value.data)) return false
  const data = value.data
  return data.demoName === 'bootstrap-redesign-p5'
    && isMachineSignature(data.machineSignature)
    && isExitDemoTimeline(data.timeline)
    && isNonNegativeNumber(data.totalSeconds)
    && isString(data.mergedCommitSha)
    && isString(data.mergedBranch)
    && isString(data.agentName)
    && isString(data.promptText)
    && Array.isArray(data.operatorActions)
    && data.operatorActions.length === 2
    && data.operatorActions[0] === 'browser_auth'
    && data.operatorActions[1] === 'approve_click'
}

function isDiffStat(value: unknown): value is WorktreeSnapshotEvidence['diffStat'] {
  return isRecord(value)
    && isNonNegativeNumber(value.filesChanged)
    && isNonNegativeNumber(value.insertions)
    && isNonNegativeNumber(value.deletions)
}

function isVerifyOutput(value: unknown): value is WorktreeSnapshotEvidence['verifyOutput'] {
  return isRecord(value)
    && isString(value.command)
    && Number.isInteger(value.exitCode)
    && isString(value.tail)
}

function isMachineSignature(value: unknown): value is ExitDemoRunEvidence['data']['machineSignature'] {
  return isRecord(value) && isString(value.osHash) && isString(value.osPlatform) && isString(value.hostnameHash)
}

function isExitDemoTimeline(value: unknown): value is ExitDemoRunEvidence['data']['timeline'] {
  const phases: ExitDemoPhase[] = [
    'install_g',
    'init_anthropic_auth',
    'serve_ready',
    'spec_imported',
    'run_awaiting_approval',
    'approve_clicked',
    'merged',
  ]
  return Array.isArray(value)
    && value.length === phases.length
    && value.every((item, index) =>
      isRecord(item) && item.phase === phases[index] && isNonNegativeNumber(item.t),
    )
}

function hasKind<K extends EvidenceKind>(value: unknown, kind: K): value is Record<string, unknown> & { kind: K } {
  return isRecord(value) && value.kind === kind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
