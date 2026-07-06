import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  createId,
  withTrustedEvidenceProducer,
  type Agent,
  type CICheckResult,
  type Evidence,
  type Repository,
  type Run,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { fetchGitHubPullRequest, type GitHubPullRequestRecord } from './github-client.js'
import { parseGitHubPullRef, parseGitHubRepoRef, toGitHubApiBaseUrl, type GitHubRepoRef } from './github-ref.js'
import { evaluateAdoptionCiGate, fetchReviewThreadGate } from './operator-pr-adoption-gates.js'
import { ensureRecordedAuthorAgent } from './recorded-author-agent.js'
import { resolveGitHubReadAuth } from './github-auth.js'

export interface AdoptOperatorPullRequestInput {
  pr: string
  author?: string | null
  reason?: string | null
}

export interface AdoptOperatorPullRequestResult {
  task: Task
  run: Run
  agent: Agent
  pr: {
    number: number
    url: string
    headBranch: string
    headSha: string
    baseBranch: string
  }
  evidence: Evidence[]
  alreadyAdopted: boolean
}

export async function adoptOperatorPullRequest(
  context: ApiContext,
  taskId: Task['id'],
  input: AdoptOperatorPullRequestInput,
): Promise<AdoptOperatorPullRequestResult> {
  const task = context.repos.tasks.get(taskId)
  if (task == null) throw new NotFoundError(`Task not found: ${taskId}`)
  const repository = requireTaskRepository(context, task)
  const repoRef = parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repoRef == null) throw new ValidationError(`Repository ${repository.name} has no GitHub remote URL`)

  const requestedPr = resolvePullRequestNumber(input.pr, repoRef)
  requireApprovalMergeRepositoryPath(repository, requestedPr)
  const runId = createId<'RunId'>()
  const auth = await resolveGitHubReadAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    secretAccessLog: context.repos.secretAccessLog,
    secretAccessContext: { runId },
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  const pull = await fetchGitHubPullRequest({ repo: repoRef, token: auth.token, pullNumber: requestedPr })
  assertAdoptablePullRequest(pull, requestedPr)
  const headSha = pull.head.sha?.trim()
  const headBranch = pull.head.ref?.trim()
  if (headSha == null || headSha === '') throw new ValidationError(`GitHub PR #${requestedPr} response did not include head SHA`)
  if (headBranch == null || headBranch === '') throw new ValidationError(`GitHub PR #${requestedPr} response did not include head branch`)
  const baseBranch = pull.base.ref?.trim() || repository.spec.defaultBranch?.trim() || context.merge.base || 'main'

  const existing = findExistingAdoption(context, task.id, requestedPr, headSha)
  if (existing != null) {
    return buildResult(context, task, existing, requireAgent(context, existing.agentId), [], true, {
      number: requestedPr,
      url: pull.html_url,
      headBranch,
      headSha,
      baseBranch,
    })
  }
  assertNoConflictingActiveRun(context, task)

  const runRef = { id: runId, taskId: task.id, prNumber: requestedPr, prUrl: pull.html_url, commitSha: headSha }
  const ciDecision = await evaluateAdoptionCiGate(context, runRef, headSha, baseBranch)
  if (!ciDecision.ok) {
    throw new ValidationError(`Cannot adopt PR #${requestedPr}: required CI checks are not green for ${headSha}; ${ciDecision.reasons.join('; ')}`)
  }
  const reviewGate = await fetchReviewThreadGate(repoRef, auth.token, requestedPr)
  if (!reviewGate.ok) {
    throw new ValidationError(`Cannot adopt PR #${requestedPr}: review gate is not passing; ${reviewGate.reasons.join('; ')}`)
  }

  const adoptedAt = context.now().toISOString()
  const author = input.author?.trim() || 'operator'
  const ciEvidenceChecks = selectAdoptionCiEvidenceChecks(ciDecision)
  const result = context.db.transaction(() => {
    const concurrentExisting = findExistingAdoption(context, task.id, requestedPr, headSha)
    if (concurrentExisting != null) {
      return {
        run: concurrentExisting,
        agent: requireAgent(context, concurrentExisting.agentId),
        evidence: [] as Evidence[],
        alreadyAdopted: true,
      }
    }
    assertNoConflictingActiveRun(context, task)
    const agent = ensureRecordedAuthorAgent(context, author)
    const run = context.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: agent.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: 'operator-created PR adopted; waiting for approval',
      pendingApproval: true,
      sessionId: null,
      branch: headBranch,
      commitSha: headSha,
      prNumber: requestedPr,
      prUrl: pull.html_url,
      worktreePaths: null,
      runtimeModel: agent.model,
      runtimeHarness: agent.harness,
      runtimeSandboxProfile: null,
      runtimeWorkflowProfile: null,
      ciStatus: ciEvidenceChecks.length > 0 ? 'pass' : null,
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: adoptedAt,
      heartbeatTimeoutSeconds: context.repos.factory.get()?.config.heartbeatTimeoutSeconds ?? 120,
    })
    if (task.status !== 'active') context.repos.tasks.updateStatus(task.id, 'active')
    context.repos.runUpdates.create(run.id, `operator adopted PR #${requestedPr} at ${headSha.slice(0, 12)}; waiting for approval`)
    const evidence: Evidence[] = [
      context.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'custom',
        payload: {
          kind: 'operator-pr-adoption',
          prNumber: requestedPr,
          prUrl: pull.html_url,
          headBranch,
          headSha,
          baseBranch,
          author,
          reason: input.reason?.trim() || null,
          adoptedAt,
        },
      }),
      context.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'review',
        payload: withTrustedEvidenceProducer({
          passed: true,
          review: {
            reviewer: 'github-pr-adoption-gate',
            status: 'approved',
            findings: [],
          },
          reviewDecision: reviewGate.reviewDecision,
          commitSha: headSha,
          resolvedAt: adoptedAt,
          source: 'github_pr_adoption_gate',
        }, DUCTUM_APPROVAL_EVIDENCE_PRODUCER),
      }),
    ]
    if (ciEvidenceChecks.length > 0) {
      evidence.splice(1, 0, context.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'ci',
        payload: withTrustedEvidenceProducer({
          passed: true,
          checks: ciEvidenceChecks,
          commitSha: headSha,
          resolvedAt: ciDecision.fetchedAt,
          source: 'github_pr_adoption_gate',
          requiredChecksSource: ciDecision.requiredChecksSource,
          resolvedRequiredChecks: ciDecision.resolvedRequiredChecks,
        }, DUCTUM_APPROVAL_EVIDENCE_PRODUCER),
      }))
    }
    return { run, agent, evidence, alreadyAdopted: false }
  })()

  return buildResult(context, context.repos.tasks.get(task.id) ?? task, result.run, result.agent, result.evidence, result.alreadyAdopted, {
    number: requestedPr,
    url: pull.html_url,
    headBranch,
    headSha,
    baseBranch,
  })
}

function requireTaskRepository(context: ApiContext, task: Task): Repository {
  if (task.repositoryId == null) throw new ValidationError(`Task ${task.id} has no repository scope`)
  const repository = context.repos.repositories.get(task.repositoryId as never)
  if (repository == null) throw new NotFoundError(`Repository not found: ${task.repositoryId}`)
  return repository
}

function resolvePullRequestNumber(input: string, repo: GitHubRepoRef): number {
  const trimmed = input.trim()
  if (/^#?\d+$/.test(trimmed)) return Number(trimmed.replace(/^#/, ''))
  const parsed = parseGitHubPullRef(trimmed)
  if (parsed == null) throw new ValidationError(`Unsupported GitHub pull request reference: ${input}`)
  if (
    parsed.host.toLowerCase() !== repo.host.toLowerCase() ||
    parsed.owner.toLowerCase() !== repo.owner.toLowerCase() ||
    parsed.repo.toLowerCase() !== repo.repo.toLowerCase()
  ) {
    throw new ValidationError('PR URL does not match task repository remote')
  }
  return parsed.pullNumber
}

function assertAdoptablePullRequest(pull: Pick<GitHubPullRequestRecord, 'state' | 'merged'>, pullNumber: number): void {
  const state = typeof pull.state === 'string' ? pull.state.trim().toLowerCase() : ''
  if (state === 'open' && pull.merged !== true) return
  const reason = pull.merged === true ? 'merged' : state === '' ? 'missing open state' : state
  throw new ValidationError(`Cannot adopt PR #${pullNumber}: PR is ${reason}; only open, unmerged PRs can be adopted`)
}

function requireApprovalMergeRepositoryPath(repository: Repository, pullNumber: number): void {
  if (repository.spec.localPath?.trim()) return
  throw new ValidationError(`Cannot adopt PR #${pullNumber}: repository ${repository.name} has no local repository path for approval merge verification`)
}

function selectAdoptionCiEvidenceChecks(decision: { observed: CICheckResult[]; resolvedRequiredChecks: string[]; requiredChecksSource: string; policy: { enabled: boolean } }): CICheckResult[] {
  if (!decision.policy.enabled) return []
  if (decision.resolvedRequiredChecks.length === 0) {
    return decision.requiredChecksSource === 'none' ? decision.observed : []
  }
  const required = new Set(decision.resolvedRequiredChecks)
  return decision.observed.filter((check) => required.has(check.name))
}

function findExistingAdoption(context: ApiContext, taskId: Task['id'], prNumber: number, headSha: string): Run | null {
  return context.repos.runs.list(taskId).find((run) =>
    run.prNumber === prNumber &&
    run.commitSha === headSha &&
    run.pendingApproval &&
    run.terminalState == null &&
    run.stage === 'ship') ?? null
}

function assertNoConflictingActiveRun(context: ApiContext, task: Task): void {
  const active = context.repos.runs.list(task.id).find((run) =>
    run.terminalState == null && run.stage !== 'done')
  if (active != null) throw new ConflictError(`Task ${task.id} already has an active run: ${active.id}`)
}

function requireAgent(context: ApiContext, agentId: Run['agentId']): Agent {
  const agent = context.repos.agents.get(agentId)
  if (agent == null) throw new NotFoundError(`Agent not found: ${agentId}`)
  return agent
}

function buildResult(
  context: ApiContext,
  task: Task,
  run: Run,
  agent: Agent,
  evidence: Evidence[],
  alreadyAdopted: boolean,
  pr: AdoptOperatorPullRequestResult['pr'],
): AdoptOperatorPullRequestResult {
  return {
    task: context.repos.tasks.get(task.id) ?? task,
    run,
    agent,
    pr,
    evidence,
    alreadyAdopted,
  }
}
