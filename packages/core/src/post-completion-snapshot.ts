import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { DUCTUM_RUNTIME_EVIDENCE_PRODUCER, withTrustedEvidenceProducer } from './evidence-provenance.js'
import type { WorktreeSnapshotEvidence } from './evidence-kinds.js'
import type { VerifyResult } from './post-completion.js'
import type { Run } from './types.js'

const execFileAsync = promisify(execFile)

export async function buildWorktreeSnapshotEvidence(input: {
  run: Run
  worktreePath: string
  baseBranch?: string | null
  verifyCommands: string[]
  verifyResult?: VerifyResult | null
  now?: () => Date
}): Promise<WorktreeSnapshotEvidence | null> {
  if (!await isGitWorktree(input.worktreePath)) return null
  const branch = await gitOutput(input.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    ?? input.run.branch
    ?? 'unknown'
  const commitSha = await gitOutput(input.worktreePath, ['rev-parse', 'HEAD'])
    ?? input.run.commitSha
    ?? 'unknown'

  return withTrustedEvidenceProducer({
    kind: 'worktree.snapshot',
    branch,
    commitSha,
    diffStat: await collectDiffStat(input.worktreePath, input.baseBranch),
    verifyOutput: {
      command: input.verifyCommands.length > 0 ? input.verifyCommands.join(' && ') : '(none)',
      exitCode: input.verifyResult?.passed === false ? 1 : 0,
      tail: tail(input.verifyResult?.output ?? '(no verify commands configured)'),
    },
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
  }, DUCTUM_RUNTIME_EVIDENCE_PRODUCER) as unknown as WorktreeSnapshotEvidence
}

async function isGitWorktree(worktreePath: string): Promise<boolean> {
  const value = await gitOutput(worktreePath, ['rev-parse', '--is-inside-work-tree'])
  return value === 'true'
}

async function collectDiffStat(
  worktreePath: string,
  baseBranch: string | null | undefined,
): Promise<WorktreeSnapshotEvidence['diffStat']> {
  const base = baseBranch?.trim()
  if (base != null && base !== '') {
    const mergeBase = await gitOutput(worktreePath, ['merge-base', 'HEAD', base])
    if (mergeBase != null && mergeBase !== '') {
      return parseShortStat(await gitOutput(worktreePath, ['diff', '--shortstat', `${mergeBase}..HEAD`]))
    }
  }

  const parent = await gitOutput(worktreePath, ['rev-parse', 'HEAD~1'])
  if (parent != null && parent !== '') {
    return parseShortStat(await gitOutput(worktreePath, ['diff', '--shortstat', `${parent}..HEAD`]))
  }
  return parseShortStat(await gitOutput(worktreePath, ['diff-tree', '--shortstat', '--root', 'HEAD']))
}

function parseShortStat(value: string | null): WorktreeSnapshotEvidence['diffStat'] {
  const text = value ?? ''
  return {
    filesChanged: numberBefore(text, /(\d+)\s+files?\s+changed/),
    insertions: numberBefore(text, /(\d+)\s+insertions?\(\+\)/),
    deletions: numberBefore(text, /(\d+)\s+deletions?\(-\)/),
  }
}

function numberBefore(text: string, pattern: RegExp): number {
  const match = pattern.exec(text)
  return match?.[1] == null ? 0 : Number(match[1])
}

function tail(output: string): string {
  const lines = output.trim().split(/\r?\n/).slice(-40).join('\n')
  return lines.length <= 4_000 ? lines : lines.slice(-4_000)
}

async function gitOutput(worktreePath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
    })
    const trimmed = stdout.trim()
    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}
