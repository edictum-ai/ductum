import type { Evidence, RepairItem, Run } from '@ductum/core'

export interface DirtyWorktreeEvidence {
  kind: 'worktree.dirty_partial'
  terminalState: string
  failReason: string | null
  worktreePath: string | null
  paths: string[]
  trackedPaths: string[]
  untrackedPaths: string[]
  recovery: {
    statusCommand: string
    logsCommand: string
    resumeCommand: string | null
    retryBlocked: boolean
    patchCommand: string | null
    cleanupNote: string
  }
}

export function findDirtyWorktreeEvidence(evidence: readonly Evidence[]): DirtyWorktreeEvidence | null {
  for (const item of evidence) {
    if (item.type !== 'custom' || item.payload.kind !== 'worktree.dirty_partial') continue
    return item.payload as unknown as DirtyWorktreeEvidence
  }
  return null
}

export function renderDirtyWorktreeSection(evidence: DirtyWorktreeEvidence): string {
  return [
    'Dirty Partial Worktree',
    `files: ${evidence.paths.join(', ')}`,
    `tracked: ${evidence.trackedPaths.join(', ') || '-'}`,
    `untracked: ${evidence.untrackedPaths.join(', ') || '-'}`,
    `next: ${buildDirtyWorktreeNextLine(evidence)}`,
    `note: ${evidence.recovery.cleanupNote}`,
  ].join('\n')
}

export function buildDirtyWorktreeNextLine(
  evidence: Pick<DirtyWorktreeEvidence, 'recovery'>,
): string {
  return [
    evidence.recovery.statusCommand,
    evidence.recovery.logsCommand,
    evidence.recovery.resumeCommand,
    evidence.recovery.patchCommand,
  ].filter((value): value is string => value != null && value.trim() !== '').join(' | ')
}

export function runHasDirtyWorktreeRepairItem(
  run: Pick<Run, 'id'>,
  items: readonly RepairItem[],
): boolean {
  return items.some((item) => item.issueCode === 'dirty_partial_worktree' && item.target?.attemptId === run.id)
}
