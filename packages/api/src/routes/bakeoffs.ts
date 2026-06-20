import type { Hono } from 'hono'
import { createId, type Agent, type BestOfNPolicy, type Task } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { buildBakeoffCompareResponse } from '../lib/bakeoff-compare.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalString, optionalStringArray, readJson, requireString } from '../lib/http.js'
import { resolveCatalogEntry } from '../lib/model-catalog.js'
import { publicOutput } from '../lib/public-output.js'
import { resolveTaskSourceScope } from '../lib/task-source-scope.js'

const DEFAULT_POLICY = 'quality-gated-cost-aware'
const VALID_POLICIES = ['quality-gated-cost-aware', 'cheapest-verified-reviewed'] as const
const MAX_BUILDERS = 5

export function registerBakeoffRoutes(app: Hono, context: ApiContext) {
  app.get('/api/specs/:specId/bakeoff/status', (c) =>
    c.json(publicOutput(buildBakeoffCompareResponse(context, c.req.param('specId')))),
  )

  app.get('/api/specs/:specId/bakeoff/compare', (c) =>
    c.json(publicOutput(buildBakeoffCompareResponse(context, c.req.param('specId')))),
  )

  app.post('/api/projects/:projectId/bakeoffs', async (c) => {
    const projectId = c.req.param('projectId')
    const project = context.repos.projects.get(projectId as never)
    if (project == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }

    const body = await readJson<Record<string, unknown>>(c)
    const name = requireString(body.name, 'name').trim()
    if (name === '') {
      throw new ValidationError('name must not be empty')
    }
    const prompt = requireString(body.prompt, 'prompt').trim()
    if (prompt === '') {
      throw new ValidationError('prompt must not be empty')
    }
    const builderAgentIds = optionalStringArray(body.builderAgentIds, 'builderAgentIds') ?? []
    const verify = optionalStringArray(body.verify, 'verify') ?? []
    const policy = parsePolicy(optionalString(body.policy, 'policy') ?? DEFAULT_POLICY)
    const builders = resolveBuilderAgents(context, project.id, builderAgentIds)
    const reviewer = resolveReviewerAgent(context, project.id, optionalString(body.reviewerAgentId, 'reviewerAgentId'), builders)
    const sourceScope = resolveTaskSourceScope(context, project.id, body)
    const strategyGroup = createId<'TaskId'>()

    const result = context.db.transaction(() => {
      const spec = context.repos.specs.create({
        id: createId<'SpecId'>(),
        projectId: project.id,
        name,
        status: 'approved',
        strategy: 'best_of_n',
        strategyConfig: {
          kind: 'best_of_n',
          policy,
          strategyGroup,
          builderAgentIds,
          reviewerAgentId: reviewer.id,
          verify,
        },
        document: prompt,
        maxFixIterations: null,
      })
      const candidates = builders.map((builder, index) =>
        context.repos.tasks.create({
          id: createId<'TaskId'>(),
          specId: spec.id,
          name: candidateTaskName(index),
          prompt,
          repos: sourceScope.repos,
          repositoryId: sourceScope.repositoryId,
          componentId: sourceScope.componentId,
          assignedAgentId: builder.id,
          requiredRole: 'builder',
          status: 'pending',
          verification: verify,
          strategyRole: 'candidate',
          strategyGroup,
        }),
      )
      const reviewTask = context.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: 'blind-review',
        prompt: buildBlindReviewPrompt(prompt, candidates, policy),
        repos: sourceScope.repos,
        repositoryId: sourceScope.repositoryId,
        componentId: sourceScope.componentId,
        assignedAgentId: reviewer.id,
        requiredRole: 'reviewer',
        status: 'pending',
        verification: [],
        strategyRole: 'blind_review',
        strategyGroup,
      })
      for (const candidate of candidates) {
        context.repos.taskDependencies.add({ taskId: reviewTask.id, dependsOnId: candidate.id })
      }
      return { spec, candidates, reviewTask }
    })()

    context.dag.evaluateTaskDAG(result.spec.id)
    const candidates = result.candidates
      .map((task) => context.repos.tasks.get(task.id) ?? task)
    const reviewTask = context.repos.tasks.get(result.reviewTask.id) ?? result.reviewTask
    return c.json(publicOutput({
      spec: result.spec,
      candidates,
      reviewTask,
      dependencies: candidates.map((candidate) => ({ taskId: reviewTask.id, dependsOnId: candidate.id })),
      policy,
      strategyGroup,
      reviewer,
      builders,
      nextCommands: {
        watch: `ductum task list ${result.spec.id}`,
        compare: `ductum spec bakeoff compare ${result.spec.id}`,
      },
    }), 201)
  })
}

function parsePolicy(value: string): BestOfNPolicy {
  if (!(VALID_POLICIES as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid policy: ${value}. Must be one of: ${VALID_POLICIES.join(', ')}`)
  }
  return value as BestOfNPolicy
}

function resolveBuilderAgents(context: ApiContext, projectId: string, agentIds: string[]): Agent[] {
  const unique = new Set(agentIds)
  if (unique.size !== agentIds.length) {
    throw new ValidationError('builderAgentIds must not contain duplicate agents')
  }
  if (agentIds.length < 2) {
    throw new ValidationError('Best-of-N requires at least two builders')
  }
  if (agentIds.length > MAX_BUILDERS) {
    throw new ValidationError(`Best-of-N supports at most ${MAX_BUILDERS} builders`)
  }
  const assignments = context.repos.projectAgents.list(projectId as never)
  const builderIds = new Set(assignments.filter((item) => item.role === 'builder').map((item) => item.agentId))
  const builders = agentIds.map((agentId) => {
    const agent = context.repos.agents.get(agentId as never)
    if (agent == null) throw new NotFoundError(`Agent not found: ${agentId}`)
    if (!builderIds.has(agent.id)) {
      throw new ValidationError(`Agent ${agent.name} is not assigned to this project as a builder`)
    }
    return agent
  })
  rejectDuplicateBuilderConfigs(builders)
  return builders
}

function resolveReviewerAgent(
  context: ApiContext,
  projectId: string,
  reviewerAgentId: string | undefined,
  builders: Agent[],
): Agent {
  const assignments = context.repos.projectAgents.list(projectId as never)
  const reviewerIds = new Set(assignments.filter((item) => item.role === 'reviewer').map((item) => item.agentId))
  const builderModels = new Set(builders.map(modelKey))
  const builderUsesClaude = builders.some(isClaudeModel)
  const validate = (agent: Agent) => {
    if (!reviewerIds.has(agent.id)) {
      throw new ValidationError(`Agent ${agent.name} is not assigned to this project as a reviewer`)
    }
    if (builders.some((builder) => builder.id === agent.id)) {
      throw new ValidationError('Reviewer agent must be different from all builders')
    }
    if (builderModels.has(modelKey(agent))) {
      throw new ValidationError('Reviewer model must be different from every builder model')
    }
    return agent
  }
  if (reviewerAgentId != null) {
    const explicit = context.repos.agents.get(reviewerAgentId as never)
    if (explicit == null) throw new NotFoundError(`Agent not found: ${reviewerAgentId}`)
    return validate(explicit)
  }
  const reviewers = context.repos.agents
    .list()
    .filter((agent) => reviewerIds.has(agent.id) && !builderModels.has(modelKey(agent)))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  const preferred = builderUsesClaude
    ? reviewers.find(isGpt55Model) ?? reviewers.find((agent) => !isClaudeModel(agent))
    : reviewers.find(isOpus48Model)
  const selected = preferred ?? reviewers[0]
  if (selected == null) {
    throw new ValidationError('reviewerAgentId is required because no different-model project reviewer is configured')
  }
  return validate(selected)
}

function rejectDuplicateBuilderConfigs(builders: Agent[]): void {
  const seen = new Map<string, Agent>()
  for (const builder of builders) {
    const key = JSON.stringify({
      model: modelKey(builder),
      harness: builder.harness,
      effort: builder.effort ?? null,
      resourceRefs: builder.resourceRefs ?? null,
      spawnConfig: builder.spawnConfig ?? {},
    })
    const previous = seen.get(key)
    if (previous != null) {
      throw new ValidationError(`Duplicate builder configuration: ${previous.name} and ${builder.name}`)
    }
    seen.set(key, builder)
  }
}

function candidateTaskName(index: number): string {
  return `candidate-${index + 1}`
}

function buildBlindReviewPrompt(prompt: string, candidates: Task[], policy: string): string {
  const candidateList = candidates.map((task, index) => `Candidate ${index + 1}: task ${task.id}`).join('\n')
  return [
    'Run a blind Best-of-N review.',
    `Policy: ${policy}`,
    '',
    'Review quality, correctness, maintainability, safety, and tests.',
    'Do not use candidate model, provider, token, or cost information.',
    'Your review feedback MUST include one JSON block with this exact structured verdict shape:',
    '```json',
    '{',
    '  "kind": "best-of-n-verdict",',
    '  "winnerTaskId": "<candidate task id>",',
    '  "scores": [{ "taskId": "<candidate task id>", "passed": true, "confidence": 0.86, "notes": "<short notes>" }],',
    `  "policy": "${policy}",`,
    '  "reason": "<why this candidate is best>"',
    '}',
    '```',
    'Do not include model, provider, token, or cost details in the verdict.',
    '',
    'Original prompt:',
    prompt,
    '',
    'Candidates:',
    candidateList,
  ].join('\n')
}

function modelKey(agent: Agent): string {
  return resolveCatalogEntry(agent.model)?.id ?? agent.model.trim().toLowerCase()
}

function isClaudeModel(agent: Agent): boolean {
  return resolveCatalogEntry(agent.model)?.provider === 'anthropic'
}

function isOpus48Model(agent: Agent): boolean {
  return resolveCatalogEntry(agent.model)?.id === 'claude-opus-4-8'
}

function isGpt55Model(agent: Agent): boolean {
  return resolveCatalogEntry(agent.model)?.id === 'gpt-5.5'
}
