import type { EvidenceRepo } from './repos/interfaces.js'
import { createId, type Run } from './types.js'
import type { FencingToken } from './attempt-lease.js'
import {
  hasRelevantDirtyWorktree,
  inspectDirtyWorktrees,
  type DirtyWorktreeSnapshot,
} from './worktree-dirty.js'

export interface DirtyPartialWorktreeEvidence extends Record<string, unknown> {
  kind: 'worktree.dirty_partial'
  terminalState: NonNullable<Run['terminalState']>
  failReason: string | null
  worktreePath: string | null
  paths: string[]
  trackedPaths: string[]
  untrackedPaths: string[]
  ignoredPaths: string[]
  recovery: {
    statusCommand: string
    logsCommand: string
    resumeCommand: string | null
    retryBlocked: boolean
    patchCommand: string | null
    cleanupNote: string
  }
}

export async function recordDirtyPartialWorktreeEvidence(
  evidenceRepo: EvidenceRepo | undefined,
  run: Run,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): Promise<void> {
  if (evidenceRepo == null || run.terminalState == null) return
  const worktreePaths = run.worktreePaths ?? []
  if (worktreePaths.length === 0) return
  const snapshots = await inspectDirtyWorktrees(worktreePaths)
  if (!hasRelevantDirtyWorktree(snapshots)) return
  const primary = snapshots.find((snapshot) => snapshot.relevantPaths.length > 0) ?? snapshots[0]!
  const payload = buildDirtyPartialWorktreeEvidence(run, primary)
  const evidence = {
    id: createId<'EvidenceId'>(),
    runId: run.id,
    type: 'custom',
    payload,
  } as const
  if (fenceToken != null && evidenceRepo.createFenced != null) evidenceRepo.createFenced(evidence, fenceToken, fenceNow)
  else evidenceRepo.create(evidence)
}

export function buildDirtyPartialWorktreeEvidence(
  run: Pick<Run, 'id' | 'terminalState' | 'failReason'>,
  snapshot: DirtyWorktreeSnapshot,
): DirtyPartialWorktreeEvidence {
  return {
    kind: 'worktree.dirty_partial',
    terminalState: run.terminalState!,
    failReason: run.failReason,
    worktreePath: snapshot.worktreePath,
    paths: snapshot.relevantPaths,
    trackedPaths: snapshot.trackedPaths.filter((path) => snapshot.relevantPaths.includes(path)),
    untrackedPaths: snapshot.untrackedPaths.filter((path) => snapshot.relevantPaths.includes(path)),
    ignoredPaths: snapshot.ignoredPaths,
    recovery: {
      statusCommand: `ductum status ${run.id}`,
      logsCommand: `ductum logs ${run.id} --limit 80`,
      resumeCommand: isResumableTerminalState(run.terminalState) ? `ductum attempt resume ${run.id} --reason "continue preserved worktree"` : null,
      retryBlocked: true,
      patchCommand: buildPatchCommand(run.id, snapshot),
      cleanupNote: 'Ductum does not yet ship a terminal failed-worktree cleanup command; save a patch or branch first, then remove the preserved worktree manually.',
    },
  }
}

function isResumableTerminalState(state: Run['terminalState'] | null): boolean {
  return state === 'paused'
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function buildPatchCommand(runId: Run['id'], snapshot: DirtyWorktreeSnapshot): string | null {
  if (snapshot.worktreePath.trim() === '') return null
  const quotedWorktree = quoteShellArg(snapshot.worktreePath)
  const patchFile = quoteShellArg(`attempt-${runId.slice(0, 8)}-partial.patch`)
  const commands = [
    `git -C ${quotedWorktree} diff --binary --cached > ${patchFile}`,
    `git -C ${quotedWorktree} diff --binary >> ${patchFile}`,
  ]
  const relevantUntracked = snapshot.untrackedPaths.filter((path) => snapshot.relevantPaths.includes(path))
  for (const path of relevantUntracked) {
    commands.push(`git -C ${quotedWorktree} diff --binary --no-index -- /dev/null ${quoteShellArg(path)} >> ${patchFile} || test $? -eq 1`)
  }
  return commands.join(' && ')
}
