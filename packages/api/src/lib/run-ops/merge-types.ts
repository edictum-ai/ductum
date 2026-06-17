import type { Run } from '@ductum/core'
import type { MergeStrategy } from '../deps.js'

export interface MergeResult {
  commitSha?: string
  branch?: string
  pushed: boolean
}

export interface MergeOptions {
  push?: boolean
  base?: string
  strategy?: MergeStrategy
  pushTags?: boolean
}

export interface RunGitContext {
  worktreePath?: string
  upstreamPath?: string
  detectedBranch?: string
}

export interface PullRequestView {
  mergeCommit?: { oid?: string | null } | null
  headRefName?: string | null
  baseRefName?: string | null
}

export type RunPrRef = Pick<Run, 'prNumber' | 'prUrl'>
