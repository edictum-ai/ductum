import { Command } from 'commander'
import type { Agent } from '@ductum/core'

import { formatStatusBadge, formatSummaryRows, formatTable } from '../format.js'
import { createAction, readPromptInput, splitCsv } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import type { BakeoffCandidateCompare, BakeoffCompareResponse, BakeoffPolicy, CreateBakeoffResult, DuctumApi } from '../types.js'
import { displayName, formatCurrency, renderSections, requireAgentByName, requireProjectByName } from './common.js'

const MAX_BUILDERS = 5
const POLICIES = ['quality-gated-cost-aware', 'cheapest-verified-reviewed'] as const

interface BakeoffCreateOptions {
  promptFile: string
  builders?: string[]
  agents?: string[]
  reviewer?: string
  policy?: string
  repositoryId?: string
  componentId?: string
  verify: string[]
  doctorBlockedModels?: string[]
}

export function registerSpecBakeoffCommands(spec: Command, deps: CliProgramDeps) {
  const bakeoff = spec.command('bakeoff').description('Manage Best-of-N bakeoffs')
  bakeoff
    .command('create <projectName> <name>')
    .requiredOption('--prompt-file <path>', 'Prompt file')
    .option('--builders <a,b,c>', 'Comma-separated builder agent names', splitCsv)
    .option('--agents <a,b,c>', 'Alias for --builders', splitCsv)
    .option('--reviewer <name>', 'Reviewer agent name')
    .option('--policy <policy>', `Policy (${POLICIES.join('|')})`)
    .option('--repository-id <id>', 'Repository scope id')
    .option('--component-id <id>', 'Component scope id')
    .option('--verify <cmd>', 'Verification command', splitCsv, [])
    .option('--doctor-blocked-models <models>', 'Comma-separated required model IDs omitted because doctor reports them blocked', splitCsv)
    .description('Create a Best-of-N bakeoff spec')
    .action(createAction(deps, async (
      ctx,
      projectName: string,
      name: string,
      options: BakeoffCreateOptions,
    ) => {
      const builderNames = selectBuilderNames(options)
      validateBuilderNames(builderNames)
      const policy = parsePolicy(options.policy)
      const prompt = (await readPromptInput(ctx.stdin, options.promptFile)).trim()
      if (prompt === '') {
        throw new Error('Bakeoff prompt cannot be empty')
      }

      const project = await requireProjectByName(ctx.api, projectName)
      const builders = await resolveAgents(ctx.api, builderNames)
      validateBuilderAgents(builders)
      const reviewer = options.reviewer == null ? null : await requireAgentByName(ctx.api, options.reviewer)
      if (reviewer != null) {
        rejectSameModelReviewer(reviewer, builders)
      }

      const created = await ctx.api.createBakeoff(project.id, {
        name,
        prompt,
        builderAgentIds: builders.map((builder) => builder.id),
        ...(reviewer == null ? {} : { reviewerAgentId: reviewer.id }),
        ...(options.repositoryId == null ? {} : { repositoryId: options.repositoryId }),
        ...(options.componentId == null ? {} : { componentId: options.componentId }),
        ...(options.verify.length === 0 ? {} : { verify: options.verify }),
        ...(options.doctorBlockedModels == null || options.doctorBlockedModels.length === 0 ? {} : { doctorBlockedModels: options.doctorBlockedModels }),
        ...(policy == null ? {} : { policy }),
      })

      ctx.write(created, renderBakeoffSummary(created))
    }))

  bakeoff
    .command('compare <specId>')
    .description('Show Best-of-N candidate scores, cost, verdict, and next actions')
    .action(createAction(deps, async (ctx, specId: string) => {
      const result = await ctx.api.getBakeoffCompare(specId)
      ctx.write(result, renderBakeoffCompare(result))
    }))
}

function selectBuilderNames(options: BakeoffCreateOptions): string[] {
  const builders = options.builders
  const agents = options.agents
  if (builders != null && agents != null && !sameList(builders, agents)) {
    throw new Error('--builders and --agents disagree; use one option or pass identical agent lists')
  }
  return builders ?? agents ?? []
}

function validateBuilderNames(names: string[]) {
  if (names.length < 2) {
    throw new Error('Best-of-N requires at least two builders')
  }
  if (names.length > MAX_BUILDERS) {
    throw new Error(`Best-of-N supports at most ${MAX_BUILDERS} builders`)
  }
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Duplicate builder agent: ${name}`)
    }
    seen.add(name)
  }
}

async function resolveAgents(api: DuctumApi, names: string[]) {
  const agents: Agent[] = []
  for (const name of names) {
    agents.push(await requireAgentByName(api, name))
  }
  return agents
}

function validateBuilderAgents(agents: Agent[]) {
  const seen = new Set<string>()
  for (const agent of agents) {
    if (seen.has(agent.id)) {
      throw new Error(`Duplicate builder agent: ${agent.name}`)
    }
    seen.add(agent.id)
  }
}

function rejectSameModelReviewer(reviewer: Agent, builders: Agent[]) {
  const matchingBuilder = builders.find((builder) => builder.model === reviewer.model)
  if (matchingBuilder == null) return
  throw new Error(
    `Reviewer model must differ from every builder model: ${reviewer.name} and ${matchingBuilder.name} both use ${reviewer.model}`,
  )
}

function parsePolicy(value: string | undefined): BakeoffPolicy | undefined {
  if (value == null) return undefined
  if ((POLICIES as readonly string[]).includes(value)) return value as BakeoffPolicy
  throw new Error(`Invalid policy: ${value}. Must be one of: ${POLICIES.join(', ')}`)
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function renderBakeoffSummary(result: CreateBakeoffResult) {
  return renderSections(
    'Bakeoff created',
    formatSummaryRows({
      specId: result.spec.id,
      specName: result.spec.name,
      strategyGroup: result.strategyGroup,
      policy: result.policy,
      reviewer: `${result.reviewer.name} (${result.reviewer.model})`,
    }),
    `Candidates\n${formatTable([
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'NAME' },
      { key: 'status', label: 'STATUS' },
      { key: 'agent', label: 'AGENT' },
    ], result.candidates.map((task) => ({
      id: task.id,
      name: task.name,
      status: formatStatusBadge(task.status),
      agent: displayName(result.builders, task.assignedAgentId),
    })))}`,
    `Review\n${formatSummaryRows({
      id: result.reviewTask.id,
      status: formatStatusBadge(result.reviewTask.status),
      agent: result.reviewer.name,
    })}`,
    `Next commands\n${formatSummaryRows(result.nextCommands)}`,
  )
}

function renderBakeoffCompare(result: BakeoffCompareResponse) {
  const winnerCandidate = result.candidates.find((candidate) => candidate.winner) ?? null
  const winnerRunId = result.winner?.eligible === true && winnerCandidate?.task.pendingApproval === true ? result.winner.runId : null
  return renderSections(
    'Bakeoff compare',
    formatSummaryRows({
      specId: result.spec.id,
      specName: result.spec.name,
      status: result.status,
      strategyGroup: result.strategyGroup,
      policy: result.policy,
      winnerTaskId: result.winner?.taskId ?? '-',
      eligible: `${result.eligibility.eligibleCount}/${result.candidates.length}`,
      malformedReviews: result.malformed.reviewCount,
      recoveryState: result.malformed.recoveryState ?? '-',
    }),
    `Candidates\n${formatTable([
      { key: 'winner', label: 'WIN' },
      { key: 'task', label: 'TASK' },
      { key: 'status', label: 'STATUS' },
      { key: 'agent', label: 'AGENT' },
      { key: 'model', label: 'MODEL' },
      { key: 'tokens', label: 'TOKENS', align: 'right' },
      { key: 'cost', label: 'COST', align: 'right' },
      { key: 'overall', label: 'SCORE', align: 'right' },
      { key: 'verifyFailures', label: 'VERIFY!', align: 'right' },
      { key: 'reviewPasses', label: 'REVIEWS', align: 'right' },
      { key: 'fixRounds', label: 'FIXES', align: 'right' },
      { key: 'eligible', label: 'ELIGIBLE' },
      { key: 'outcome', label: 'OUTCOME' },
    ], result.candidates.map(compareRow))}`,
    `Stats\n${formatTable([
      { key: 'role', label: 'ROLE' },
      { key: 'agent', label: 'AGENT' },
      { key: 'model', label: 'MODEL' },
      { key: 'attempts', label: 'ATT', align: 'right' },
      { key: 'passFail', label: 'PASS' },
      { key: 'malformed', label: 'BAD%', align: 'right' },
      { key: 'reviewRate', label: 'REV%', align: 'right' },
      { key: 'cost', label: 'COST', align: 'right' },
      { key: 'tokens', label: 'TOKENS', align: 'right' },
      { key: 'winner', label: 'WIN' },
      { key: 'override', label: 'HUMAN' },
      { key: 'failure', label: 'FAILURE' },
    ], [...result.stats.perModel, ...result.stats.perJudge, result.stats.totals].map(statsRow))}`,
    result.verdict == null
      ? 'Verdict\npending'
      : `Verdict\n${formatSummaryRows({
          winnerTaskId: result.verdict.winnerTaskId,
          policy: result.verdict.policy,
          reason: result.verdict.reason,
        })}`,
    `Next actions\n${formatSummaryRows({
      approveWinner: winnerRunId == null ? '-' : `ductum approve ${winnerRunId}`,
      ...Object.fromEntries(result.nextActions.map((action, index) => [`hint${index + 1}`, action])),
    })}`,
  )
}

function compareRow(candidate: BakeoffCandidateCompare) {
  return {
    winner: candidate.winner ? '*' : '',
    task: candidate.task.taskName,
    status: formatStatusBadge(candidate.task.pendingApproval ? 'awaiting_approval' : candidate.task.latestRunStage ?? candidate.task.taskStatus),
    agent: candidate.agent?.name ?? '-',
    model: candidate.agent?.model ?? '-',
    tokens: candidate.metrics.totalTokens,
    cost: formatCurrency(candidate.metrics.costUsd),
    overall: candidate.scores.overall.toFixed(1),
    verifyFailures: candidate.metrics.verificationFailures,
    reviewPasses: candidate.metrics.reviewPasses,
    fixRounds: candidate.metrics.fixRounds,
    eligible: candidate.eligibility.eligible ? 'yes' : 'no',
    outcome: candidate.outcome ?? '-',
  }
}

function statsRow(row: BakeoffCompareResponse['stats']['totals']) {
  return {
    role: row.role,
    agent: row.agentName ?? '-',
    model: row.model,
    attempts: row.attempts,
    passFail: row.passed ? 'pass' : row.failed ? 'fail' : '-',
    malformed: `${Math.round(row.malformedRate * 100)}%`,
    reviewRate: `${Math.round(row.reviewPassRate * 100)}%`,
    cost: formatCurrency(row.costUsd),
    tokens: row.totalTokens,
    winner: row.winner ? 'yes' : '-',
    override: row.humanOverride ? 'yes' : '-',
    failure: row.failureCategory ?? '-',
  }
}
