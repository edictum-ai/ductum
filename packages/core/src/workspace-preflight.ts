import { join } from 'node:path'

import { publicOutputValue, redactPublicText } from './public-redaction.js'
import { createHostPreflightProbes } from './workspace-preflight-probes.js'
import type {
  WorkspacePreflightCheckOutcome,
  WorkspacePreflightConfig,
  WorkspacePreflightProbes,
  WorkspacePreflightResult,
} from './workspace-preflight-types.js'
import type { PrerequisiteIssue } from './repair-types.js'
import type { Task } from './types.js'

export { createHostPreflightProbes } from './workspace-preflight-probes.js'

export function runWorkspacePreflight(input: {
  config: WorkspacePreflightConfig | undefined | null
  workingDir: string | undefined
  scope?: 'setup' | 'full'
  /** 'host' for host dispatch, 'container' for container dispatch. */
  sandboxMode: 'host' | 'container' | undefined
  /** True when the agent's sandboxRef resolved to a sandbox profile. */
  hasSandboxProfile: boolean
  /** True when reusing a preserved worktree from another run (inherited). */
  hasInheritedWorktree: boolean
  hostEnv?: NodeJS.ProcessEnv
  probes?: WorkspacePreflightProbes
  task: Task
  now: Date
}): WorkspacePreflightResult {
  if (input.config == null || input.config.enabled === false) {
    return { ok: true, checks: [{ id: 'preflight.disabled', label: 'Preflight disabled', status: 'skipped', detail: null }] }
  }
  const probes = input.probes ?? createHostPreflightProbes(input.hostEnv)
  const outcomes: WorkspacePreflightCheckOutcome[] = []
  const issues: PrerequisiteIssue[] = []

  const config = input.config
  const ctx: PreflightContext = {
    config,
    workingDir: input.workingDir,
    scope: input.scope ?? 'full',
    sandboxMode: input.sandboxMode,
    hasSandboxProfile: input.hasSandboxProfile,
    hasInheritedWorktree: input.hasInheritedWorktree,
    probes,
    task: input.task,
    now: input.now,
  }

  runCheck(ctx, 'package-manager', 'Package manager available', () => checkPackageManager(ctx), outcomes, issues)
  runCheck(ctx, 'runtime-version', 'Runtime version satisfies requirement', () => checkRuntime(ctx), outcomes, issues)
  runCheck(ctx, 'dependencies', 'Dependencies installed', () => checkDependencies(ctx), outcomes, issues)
  if (input.scope !== 'setup') {
    runCheck(ctx, 'worktree-writable', 'Worktree path is writable', () => checkWorktreeWritable(ctx), outcomes, issues)
    runCheck(ctx, 'worktree-state', 'Worktree state matches expectation', () => checkWorktreeState(ctx), outcomes, issues)
  }
  runCheck(ctx, 'env-refs', 'Required env refs are resolvable', () => checkEnvRefs(ctx), outcomes, issues)
  runCheck(ctx, 'native-tools', 'Native tools on PATH', () => checkNativeTools(ctx), outcomes, issues)
  runCheck(ctx, 'sandbox-mode', 'Sandbox mode matches requirement', () => checkSandboxMode(ctx), outcomes, issues)

  if (issues.length > 0) return { ok: false, checks: outcomes, issues }
  return { ok: true, checks: outcomes }
}

interface PreflightContext {
  config: WorkspacePreflightConfig
  workingDir: string | undefined
  scope: 'setup' | 'full'
  sandboxMode: 'host' | 'container' | undefined
  hasSandboxProfile: boolean
  hasInheritedWorktree: boolean
  probes: WorkspacePreflightProbes
  task: Task
  now: Date
}

type CheckResult = { status: 'pass' | 'skipped'; detail: string | null } | { status: 'fail'; detail: string; issue: PrerequisiteIssue }

function runCheck(
  ctx: PreflightContext,
  id: string,
  label: string,
  run: () => CheckResult,
  outcomes: WorkspacePreflightCheckOutcome[],
  issues: PrerequisiteIssue[],
): void {
  let result: CheckResult
  try {
    result = run()
  } catch (error) {
    const detail = redactPublicText(error instanceof Error ? error.message : String(error))
    result = { status: 'fail', detail, issue: preflightIssue(ctx, id, label, detail) }
  }
  outcomes.push({ id, label, status: result.status, detail: result.detail })
  if (result.status === 'fail') issues.push(result.issue)
}

function checkPackageManager(ctx: PreflightContext): CheckResult {
  const expected = ctx.config.packageManager
  if (expected == null || expected.trim() === '') return skipped('No package manager configured')
  if (ctx.sandboxMode === 'container') return fail(ctx, 'package-manager', 'Package manager available', 'Cannot verify package manager inside container sandbox without sandbox probes.', 'Remove preflight.packageManager for container workflows until sandbox probes are supported, or run this workflow on host.')
  if (!ctx.probes.hasBinary(expected)) {
    return fail(ctx, 'package-manager', 'Package manager available', `Package manager "${expected}" was not found on PATH.`, `Install ${expected} on the dispatcher host or change the workflow profile preflight.packageManager.`)
  }
  return pass(`Found ${expected} on PATH`)
}

function checkRuntime(ctx: PreflightContext): CheckResult {
  const runtime = ctx.config.runtime
  if (runtime == null) return skipped('No runtime configured')
  if (ctx.sandboxMode === 'container') return fail(ctx, 'runtime-version', 'Runtime version satisfies requirement', 'Cannot verify runtime inside container sandbox without sandbox probes.', 'Remove preflight.runtime for container workflows until sandbox probes are supported, or run this workflow on host.')
  if (!ctx.probes.hasBinary(runtime.name)) {
    return fail(ctx, 'runtime-version', 'Runtime version satisfies requirement', `Runtime "${runtime.name}" was not found on PATH.`, `Install ${runtime.name} on the dispatcher host.`)
  }
  if (runtime.minVersion == null || runtime.minVersion.trim() === '') return pass(`Found ${runtime.name}`)
  const actual = ctx.probes.binaryVersion(runtime.name)
  if (actual == null) {
    return fail(ctx, 'runtime-version', 'Runtime version satisfies requirement', `Could not determine ${runtime.name} version (expected >= ${runtime.minVersion}).`, `Ensure ${runtime.name} --version works on the dispatcher host.`)
  }
  if (!satisfiesMinVersion(actual, runtime.minVersion)) {
    return fail(ctx, 'runtime-version', 'Runtime version satisfies requirement', `${runtime.name} ${actual} is older than required ${runtime.minVersion}.`, `Upgrade ${runtime.name} to at least ${runtime.minVersion}.`)
  }
  return pass(`${runtime.name} ${actual} satisfies >= ${runtime.minVersion}`)
}

function checkDependencies(ctx: PreflightContext): CheckResult {
  const deps = ctx.config.dependencies
  if (deps == null) return skipped('No dependency state configured')
  if (deps.packageManager != null && ctx.sandboxMode === 'container') return fail(ctx, 'dependencies', 'Dependencies installed', 'Cannot verify dependency package manager inside container sandbox without sandbox probes.', 'Remove preflight.dependencies.packageManager for container workflows until sandbox probes are supported, or run this workflow on host.')
  if (deps.packageManager != null && !ctx.probes.hasBinary(deps.packageManager)) {
    return fail(ctx, 'dependencies', 'Dependencies installed', `Declared dependency package manager "${deps.packageManager}" was not found on PATH.`, `Install ${deps.packageManager} on the dispatcher host.`)
  }
  if (deps.lockfile == null && (ctx.scope === 'setup' || deps.installDir == null)) return deps.packageManager == null ? skipped('Dependency state deferred until worktree hydration') : pass('Dependency package manager available')
  if (ctx.workingDir == null) {
    return fail(ctx, 'dependencies', 'Dependencies installed', 'Cannot verify dependency state without a working directory.', 'Resolve the worktree path before retrying.')
  }
  if (deps.lockfile != null && !ctx.probes.exists(join(ctx.workingDir, deps.lockfile))) {
    return fail(ctx, 'dependencies', 'Dependencies installed', `Lockfile "${deps.lockfile}" is missing under the worktree.`, `Run the project's install command to materialise ${deps.lockfile}.`)
  }
  if (ctx.scope === 'setup') return pass(deps.packageManager == null ? 'Dependency lockfile present' : 'Dependency package manager and lockfile available')
  if (deps.installDir != null && !ctx.probes.exists(join(ctx.workingDir, deps.installDir))) {
    return fail(ctx, 'dependencies', 'Dependencies installed', `Install directory "${deps.installDir}" is missing under the worktree.`, `Run the project's install command (e.g. pnpm install --frozen-lockfile) in the worktree.`)
  }
  return pass('Dependencies present')
}

function checkWorktreeWritable(ctx: PreflightContext): CheckResult {
  const wt = ctx.config.worktree
  if (wt?.writable === false) return pass('Writability check disabled by config')
  if (ctx.workingDir == null) {
    return fail(ctx, 'worktree-writable', 'Worktree path is writable', 'No working directory was resolved for the dispatch.', 'Ensure task.repos or the project repository provides a local path.')
  }
  if (!ctx.probes.exists(ctx.workingDir)) {
    return fail(ctx, 'worktree-writable', 'Worktree path is writable', `Worktree path does not exist: ${ctx.workingDir}`, 'Restore or recreate the worktree before retrying.')
  }
  if (!ctx.probes.isWritable(ctx.workingDir)) {
    return fail(ctx, 'worktree-writable', 'Worktree path is writable', `Worktree path is not writable by the dispatcher: ${ctx.workingDir}`, 'Fix filesystem permissions or move the worktree to a writable location.')
  }
  return pass('Worktree is writable')
}

function checkWorktreeState(ctx: PreflightContext): CheckResult {
  const expect = ctx.config.worktree?.expect
  if (expect == null) return skipped('No worktree state expectation configured')
  if (ctx.workingDir == null) {
    return fail(ctx, 'worktree-state', 'Worktree state matches expectation', 'Cannot verify worktree state without a working directory.', 'Resolve the worktree path before retrying.')
  }
  if (expect === 'inherited') {
    if (!ctx.hasInheritedWorktree) {
      return fail(ctx, 'worktree-state', 'Worktree state matches expectation', 'Workflow expects an inherited worktree but none was provided.', 'Retry from a parent run that preserves its worktree, or relax preflight.worktree.expect.')
    }
    return pass('Inherited worktree reused')
  }
  if (expect === 'clean') {
    if (ctx.hasInheritedWorktree) {
      return pass('Inherited worktree is exempt from the clean-state check')
    }
    if (!ctx.probes.exists(ctx.workingDir)) {
      return fail(ctx, 'worktree-state', 'Worktree state matches expectation', `Worktree path does not exist: ${ctx.workingDir}`, 'Recreate the worktree before retrying.')
    }
    const status = ctx.probes.worktreeStatus(ctx.workingDir)
    if (status.error != null) {
      return fail(ctx, 'worktree-state', 'Worktree state matches expectation', `Could not inspect worktree cleanliness: ${redactPublicText(status.error)}`, 'Ensure git is available and the worktree path is a git repo.')
    }
    if (!status.clean) {
      return fail(ctx, 'worktree-state', 'Worktree state matches expectation', 'Worktree has modifications or untracked files; preflight expects a clean checkout.', 'Commit, stash, or remove local changes, or relax preflight.worktree.expect.')
    }
    return pass('Worktree is clean')
  }
  return skipped('No worktree state expectation configured')
}

function checkEnvRefs(ctx: PreflightContext): CheckResult {
  const refs = ctx.config.env
  if (refs == null || refs.length === 0) return skipped('No env refs configured')
  const missing: string[] = []
  for (const ref of refs) {
    if (ctx.probes.envValue(ref) == null) missing.push(ref)
  }
  if (missing.length > 0) {
    return fail(ctx, 'env-refs', 'Required env refs are resolvable', `Required env var(s) not set: ${missing.join(', ')}.`, `Set the listed env var(s) on the dispatcher host (or via a factory secret reference).`)
  }
  return pass(`All ${refs.length} env ref(s) resolvable`)
}

function checkNativeTools(ctx: PreflightContext): CheckResult {
  const tools = ctx.config.nativeTools
  if (tools == null || tools.length === 0) return skipped('No native tools configured')
  if (ctx.sandboxMode === 'container') return fail(ctx, 'native-tools', 'Native tools on PATH', 'Cannot verify native tools inside container sandbox without sandbox probes.', 'Remove preflight.nativeTools for container workflows until sandbox probes are supported, or run this workflow on host.')
  const missing: string[] = []
  for (const tool of tools) {
    if (!ctx.probes.hasBinary(tool)) missing.push(tool)
  }
  if (missing.length > 0) {
    return fail(ctx, 'native-tools', 'Native tools on PATH', `Required native tool(s) missing from PATH: ${missing.join(', ')}.`, `Install the listed tool(s) on the dispatcher host.`)
  }
  return pass(`All ${tools.length} native tool(s) on PATH`)
}

function checkSandboxMode(ctx: PreflightContext): CheckResult {
  const mode = ctx.config.sandbox?.mode
  if (mode == null || mode === 'any') return skipped('No sandbox mode requirement configured')
  if (mode === 'container') {
    if (ctx.sandboxMode !== 'container') return fail(ctx, 'sandbox-mode', 'Sandbox mode matches requirement', 'Workflow requires container sandbox but the agent is not running in a container sandbox.', 'Assign a container SandboxProfile to the agent or relax preflight.sandbox.mode.')
    return pass('Container sandbox profile attached')
  }
  if (mode === 'host') {
    if (ctx.sandboxMode === 'container') return fail(ctx, 'sandbox-mode', 'Sandbox mode matches requirement', 'Workflow requires host sandbox but the agent is running in a container sandbox.', 'Reassign the agent to host mode or relax preflight.sandbox.mode.')
    return pass('Host sandbox in use')
  }
  return skipped('No sandbox mode requirement configured')
}

function pass(detail: string | null = null): CheckResult {
  return { status: 'pass', detail }
}

function skipped(detail: string | null = null): CheckResult {
  return { status: 'skipped', detail }
}

function fail(ctx: PreflightContext, id: string, label: string, detail: string, suggestedAction: string): CheckResult {
  return { status: 'fail', detail, issue: preflightIssueWithAction(ctx, id, label, detail, suggestedAction) }
}

function preflightIssue(ctx: PreflightContext, id: string, label: string, detail: string): PrerequisiteIssue {
  return preflightIssueWithAction(ctx, id, label, detail, 'Resolve the preflight blocker for this task before re-enabling dispatch.')
}

function preflightIssueWithAction(ctx: PreflightContext, id: string, label: string, detail: string, suggestedAction: string): PrerequisiteIssue {
  const value = publicOutputValue(`preflight.${id}`, detail)
  return {
    id: `preflight:${ctx.task.id}:${id}`,
    area: 'repository_readiness',
    severity: 'blocker',
    title: label,
    reason: detail,
    suggestedAction,
    record: { type: 'Task', id: ctx.task.id, name: ctx.task.name },
    field: { path: `task.preflight.${id}`, label, value },
    blocks: 'Blocks dispatch until the configured preflight check passes.',
    status: 'missing',
    issueCode: `preflight_${id.replace(/-/g, '_')}`,
    target: { taskId: ctx.task.id, taskName: ctx.task.name },
    href: null,
    linkLabel: null,
  }
}

/**
 * Compare two dotted version strings. Returns true when `actual` is >=
 * `required` (numeric component-wise; non-numeric prefixes like `v` stripped).
 */
export function satisfiesMinVersion(actual: string, required: string): boolean {
  const a = toVersionTuple(actual)
  const r = toVersionTuple(required)
  for (let i = 0; i < Math.max(a.length, r.length); i++) {
    const ai = a[i] ?? 0
    const ri = r[i] ?? 0
    if (ai > ri) return true
    if (ai < ri) return false
  }
  return true
}

function toVersionTuple(value: string): number[] {
  const cleaned = value.replace(/^[^0-9]+/, '').trim()
  return cleaned.split('.').map((segment) => {
    const numeric = parseInt(segment, 10)
    return Number.isFinite(numeric) ? numeric : 0
  })
}
