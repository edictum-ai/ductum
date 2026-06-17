import { afterEach, describe, expect, it } from 'vitest'

import {
  buildRepairReport,
  buildTaskPrerequisiteIssues,
  createId,
  type Agent,
  type BuildRepairReportInput,
  type Factory,
  type Project,
  type RepairCheckStatus,
  type RepairHostChecks,
  type Spec,
  type Task,
} from '../index.js'
import type { Repository, RepositorySpec } from '../resource-types.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

let context: RepoContext | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('workflow validity repair blockers', () => {
  it('targets the validity blocker at the referencing project and keeps siblings eligible', () => {
    context = createRepoContext()
    const { factory, builder } = seedBase(context)
    const workflow = context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>() as never,
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'broken-workflow',
      spec: { path: 'workflows/bad.yaml' },
    })

    const broken = makeProject(context, factory.id, builder, 'broken', {
      mergeMode: 'auto',
      workflowPath: 'workflows/coding-guard.yaml',
      workflowProfile: 'broken-workflow',
    })
    const brokenTask = createTask(context, broken.spec, createRepository(context, broken.project, 'broken', { localPath: '/repo/broken' }))

    const sibling = makeProject(context, factory.id, builder, 'sibling', {
      mergeMode: 'auto',
      workflowPath: 'workflows/coding-guard.yaml',
    })
    createTask(context, sibling.spec, createRepository(context, sibling.project, 'sibling', { localPath: '/repo/sibling' }))

    const input = inputFor(context, [broken.project, sibling.project], {
      host: {
        ...readyHost(context, [broken.project, sibling.project]),
        workflows: { [workflow.id]: missing('Workflow parse failed') },
      },
    })
    const report = buildRepairReport(input)
    const eligibility = new Map(report.projectDispatch.map((item) => [item.projectId, item] as const))

    expect(eligibility.get(broken.project.id)).toMatchObject({
      eligible: false,
      blockerIds: [`workflow:${workflow.id}:validation:missing`],
    })
    expect(eligibility.get(sibling.project.id)).toMatchObject({ eligible: true, blockerIds: [] })
    expect(buildTaskPrerequisiteIssues({ ...input, task: brokenTask, agent: builder }).map((item) => item.id))
      .toContain(`workflow:${workflow.id}:validation:missing`)
  })

  it('resolves a path-based workflowProfile to the WorkflowProfile record via the repo root', () => {
    context = createRepoContext()
    const { factory, builder } = seedBase(context)
    const repoRoot = '/repo/ductum'
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>() as never,
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'ductum',
      // Records keep a relative path; the project field is the API-normalized absolute path.
      spec: { path: '.edictum/workflow-profile.yaml' },
    })
    const { project, spec } = makeProject(context, factory.id, builder, 'ductum', {
      mergeMode: 'auto',
      workflowPath: 'workflows/coding-guard.yaml',
      workflowProfile: `${repoRoot}/.edictum/workflow-profile.yaml`,
    })
    createTask(context, spec, createRepository(context, project, 'ductum', { localPath: repoRoot }))

    const report = buildRepairReport(inputFor(context, [project], { host: readyHost(context, [project]) }))

    expect(report.items.some((item) => item.id === `project:${project.id}:workflowProfile:missing`)).toBe(false)
    expect(report.projectDispatch.find((entry) => entry.projectId === project.id))
      .toMatchObject({ eligible: true, blockerIds: [] })
  })
})

function makeProject(
  ctx: RepoContext,
  factoryId: Factory['id'],
  builder: Agent,
  name: string,
  config: Project['config'],
): { project: Project; spec: Spec } {
  const project = ctx.projectRepo.create({
    id: createId<'ProjectId'>(),
    factoryId,
    name,
    repos: [],
    config,
  })
  ctx.projectAgentRepo.assign({ projectId: project.id, agentId: builder.id, role: 'builder' })
  const spec = ctx.specRepo.create({
    id: createId<'SpecId'>(),
    projectId: project.id,
    name: `P-${name}`,
    status: 'approved',
    document: `# P-${name}`,
  })
  return { project, spec }
}

function inputFor(ctx: RepoContext, projects: Project[], overrides: Partial<BuildRepairReportInput> = {}): BuildRepairReportInput {
  return {
    generatedAt: '2026-06-09T12:00:00.000Z',
    projects,
    repositoriesByProjectId: new Map(projects.map((project) => [project.id, ctx.repositoryRepo.list(project.id)] as const)),
    projectAgents: projects.flatMap((project) => ctx.projectAgentRepo.list(project.id)),
    agents: ctx.agentRepo.list(),
    configResources: ctx.configResourceRepo.list(),
    specs: projects.flatMap((project) => ctx.specRepo.list(project.id)),
    tasks: ctx.taskRepo.listBySpecIds(projects.flatMap((project) => ctx.specRepo.list(project.id).map((spec) => spec.id))),
    host: readyHost(ctx, projects),
    requirements: { remoteProjectIds: new Set(), githubProjectIds: new Set(), adapterNames: new Set(['claude-agent-sdk', 'vercel-ai']) },
    ...overrides,
  }
}

function readyHost(ctx: RepoContext, projects: Project[]): RepairHostChecks {
  const repositories = projects.flatMap((project) => ctx.repositoryRepo.list(project.id))
  return {
    git: ready('Git is installed'),
    github: { state: 'not_applicable', label: 'No GitHub workflow selected' },
    providerAuth: { anthropic: ready('Anthropic auth detected'), openai: ready('OpenAI auth detected') },
    factoryDataDir: ready('/tmp/ductum'),
    localApp: ready('API reachable on 4100'),
    repositories: Object.fromEntries(repositories.map((repo) => [repo.id, { localGit: ready(repo.spec.localPath ?? repo.name) }])),
  }
}

function createRepository(ctx: RepoContext, project: Project, name: string, spec: RepositorySpec): Repository {
  return ctx.repositoryRepo.create({ id: createId<'RepositoryId'>() as never, projectId: project.id, name, spec })
}

function createTask(ctx: RepoContext, spec: Spec, repository: Repository): Task {
  return ctx.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: repository.id,
    name: `Task ${repository.name}`,
    prompt: 'implement',
    repos: [repository.spec.localPath ?? repository.name],
    assignedAgentId: null,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

function ready(label: string): RepairCheckStatus {
  return { state: 'ready', label }
}

function missing(detail: string): RepairCheckStatus {
  return { state: 'missing', label: '(missing)', detail }
}
