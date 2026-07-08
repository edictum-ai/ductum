import type { PrerequisiteIssue } from './repair-types.js'
import type { Task } from './types.js'

/**
 * Configurable workspace hydration preflight (issue #281).
 *
 * A workflow profile may declare a `preflight` block. When present, the
 * dispatcher runs every configured check before the implementation prompt
 * reaches the harness. Missing
 * prerequisites fail fast with exact repair text via the existing
 * Needs-Attention path; no builder time is spent. Successful preflights
 * record evidence on the attempt.
 *
 * The shape is intentionally declarative — Ductum never runs install or
 * cleanup commands on the agent's behalf. Each check is a read-only probe
 * of host/worktree/sandbox state.
 */
export interface WorkspacePreflightConfig {
  /** Master switch. When false the entire block is ignored. Default true. */
  enabled?: boolean
  /** Expected package manager (pnpm, npm, yarn, bun). When set, the binary must be on PATH. */
  packageManager?: string
  /** Runtime version requirements (e.g. node >= 20). */
  runtime?: WorkspacePreflightRuntime
  /** Dependency install state. */
  dependencies?: WorkspacePreflightDependencies
  /** Worktree expectations. */
  worktree?: WorkspacePreflightWorktree
  /** Env var names that must be resolvable for this workflow. Values are never printed. */
  env?: string[]
  /** Native binaries that must be on PATH (e.g. git, pnpm, node). */
  nativeTools?: string[]
  /** Sandbox mode requirement. */
  sandbox?: WorkspacePreflightSandbox
}

export interface WorkspacePreflightRuntime {
  /** Runtime name to verify, e.g. 'node'. */
  name: string
  /** Minimum version (semver-ish, compared numerically by major.minor). */
  minVersion?: string
}

export interface WorkspacePreflightDependencies {
  /** Lockfile basename to look for, e.g. 'pnpm-lock.yaml'. */
  lockfile?: string
  /** Install directory basename, e.g. 'node_modules'. */
  installDir?: string
  /** Package manager whose presence implies deps were installed. */
  packageManager?: string
}

export interface WorkspacePreflightWorktree {
  /** Path must be writable by the current process. Default true. */
  writable?: boolean
  /** Required worktree state. */
  expect?: 'clean' | 'inherited' | 'any'
}

export interface WorkspacePreflightSandbox {
  /** Required sandbox mode. */
  mode?: 'host' | 'container' | 'any'
}

export type WorkspacePreflightCheckStatus = 'pass' | 'fail' | 'skipped'

export interface WorkspacePreflightCheckOutcome {
  id: string
  label: string
  status: WorkspacePreflightCheckStatus
  /** Redacted, operator-readable explanation. Never contains secret values. */
  detail: string | null
}

export interface WorkspacePreflightSuccess {
  ok: true
  checks: WorkspacePreflightCheckOutcome[]
}

export interface WorkspacePreflightFailure {
  ok: false
  checks: WorkspacePreflightCheckOutcome[]
  issues: PrerequisiteIssue[]
}

export type WorkspacePreflightResult = WorkspacePreflightSuccess | WorkspacePreflightFailure

export interface DispatcherWorkspacePreflightInput {
  task: Task
  workingDir: string | undefined
  scope?: 'setup' | 'full'
  sandboxMode: 'host' | 'container' | undefined
  hasSandboxProfile: boolean
  hasInheritedWorktree: boolean
  config: WorkspacePreflightConfig | undefined
  now: Date
}

export type DispatcherWorkspacePreflightOverride = (input: DispatcherWorkspacePreflightInput) => WorkspacePreflightResult

/**
 * Probes the runner uses to inspect host state. Injectable so tests do
 * not spawn real processes or touch the real filesystem. The default
 * implementation lives in workspace-preflight.ts and shells out via
 * `node:child_process` / reads `node:fs`.
 */
export interface WorkspacePreflightProbes {
  hasBinary(name: string): boolean
  binaryVersion(name: string): string | null
  exists(path: string): boolean
  isWritable(path: string): boolean
  worktreeStatus(path: string): { clean: boolean; error: string | null }
  envValue(name: string): string | undefined
}
