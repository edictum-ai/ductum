import { afterEach, describe, expect, it } from 'vitest'

import {
  buildRepairReport,
  buildTaskPrerequisiteIssues,
  createId,
  type BuildRepairReportInput,
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

describe('repair prerequisite contract', () => {
  it('groups repair items by blocked area and carries exact fields and actions', () => {
    context = createRepoContext()
    const { project, spec } = seedBase(context)
    const repo = createRepository(context, project, 'ductum', { localPath: '/repo/ductum' })
    const task = createTask(context, spec, repo)

    const report = buildRepairReport(inputFor(context, [project], {
      host: {
        ...readyHost(context, [project]),
        github: missing('gh auth status failed'),
        providerAuth: {
          anthropic: {
            state: 'missing',
            label: 'sk-ant-api03-supersecret-token',
            detail: 'Anthropic auth missing for sk-ant-api03-supersecret-token',
          },
        },
      },
      requirements: {
        remoteProjectIds: new Set([project.id]),
        githubProjectIds: new Set([project.id]),
        adapterNames: new Set(['claude-agent-sdk', 'vercel-ai']),
      },
    }))

    expect(report.groups.map((group) => group.label)).toEqual([
      'Repository readiness',
      'Provider auth',
      'Spec start',
    ])

    const remote = report.items.find((item) => item.id === `repository:${repo.id}:remoteUrl:missing`)
    expect(remote).toMatchObject({
      area: 'repository_readiness',
      record: { type: 'Repository', id: repo.id, name: 'ductum' },
      field: {
        path: 'projects.edictum.repositories.ductum.remoteUrl',
        label: 'Repository remote URL',
        value: '(missing)',
      },
      suggestedAction: 'Add a remote URL through Project Repository settings.',
      target: { projectId: project.id, repositoryId: repo.id },
    })

    const provider = report.items.find((item) => item.area === 'provider_auth')
    expect(provider?.field).toMatchObject({
      path: 'providers.anthropic.auth',
      label: 'Anthropic auth',
      value: 'missing',
    })
    expect(JSON.stringify(provider)).not.toContain('sk-ant-api03-supersecret-token')

    const specStart = report.items.find((item) => item.area === 'spec_start')
    expect(specStart).toMatchObject({
      record: { type: 'Task', id: task.id, name: task.name },
      field: { path: `tasks.${task.id}.repository`, label: 'Task Repository' },
      suggestedAction: 'Open Repair for the Repository readiness items, fix them, then start the task again.',
    })
  })

  it('does not require GitHub auth for local-only workflows', () => {
    context = createRepoContext()
    const { project } = seedBase(context)
    createRepository(context, project, 'ductum', { localPath: '/repo/ductum' })

    const report = buildRepairReport(inputFor(context, [project], {
      host: { ...readyHost(context, [project]), github: missing('gh auth status failed') },
    }))

    expect(report.items.some((item) => item.title.includes('GitHub'))).toBe(false)
  })

  it('blocks only the broken project and keeps valid project attempts eligible', () => {
    context = createRepoContext()
    const { factory, project: broken, builder, spec: brokenSpec } = seedBase(context)
    const brokenRepo = createRepository(context, broken, 'broken', { localPath: '/repo/broken' })
    const brokenTask = createTask(context, brokenSpec, brokenRepo)
    const valid = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'valid',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    context.projectAgentRepo.assign({ projectId: valid.id, agentId: builder.id, role: 'builder' })
    const validSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: valid.id,
      name: 'P-valid',
      status: 'approved',
      document: '# P-valid',
    })
    const validRepo = createRepository(context, valid, 'valid', { localPath: '/repo/valid' })
    const validTask = createTask(context, validSpec, validRepo)
    const input = inputFor(context, [broken, valid], {
      requirements: {
        remoteProjectIds: new Set([broken.id]),
        githubProjectIds: new Set(),
        adapterNames: new Set(['claude-agent-sdk', 'vercel-ai']),
      },
    })

    const report = buildRepairReport(input)

    expect(report.projectDispatch).toEqual([
      expect.objectContaining({ projectId: broken.id, eligible: false }),
      expect.objectContaining({ projectId: valid.id, eligible: true, blockerIds: [] }),
    ])
    expect(buildTaskPrerequisiteIssues({ ...input, task: brokenTask, agent: builder }).length).toBeGreaterThan(0)
    expect(buildTaskPrerequisiteIssues({ ...input, task: validTask, agent: builder })).toEqual([])
  })

  it('marks every project ineligible when an untargeted host prerequisite blocks dispatch', () => {
    context = createRepoContext()
    const { factory, project, builder, spec } = seedBase(context)
    createTask(context, spec, createRepository(context, project, 'ductum', { localPath: '/repo/ductum' }))
    const valid = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'valid',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    context.projectAgentRepo.assign({ projectId: valid.id, agentId: builder.id, role: 'builder' })
    const validSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: valid.id,
      name: 'P-valid',
      status: 'approved',
      document: '# P-valid',
    })
    createTask(context, validSpec, createRepository(context, valid, 'valid', { localPath: '/repo/valid' }))

    const report = buildRepairReport(inputFor(context, [project, valid], {
      host: { ...readyHost(context, [project, valid]), git: missing('git is not on PATH') },
    }))

    for (const eligibility of report.projectDispatch) {
      expect(eligibility).toMatchObject({
        eligible: false,
        blockerIds: expect.arrayContaining(['host:git:missing']),
      })
    }
  })

  it('scopes provider auth blockers to projects using that provider', () => {
    context = createRepoContext()
    const { factory, project: anthropicProject, builder, reviewer, spec: anthropicSpec } = seedBase(context)
    const anthropicTask = createTask(
      context,
      anthropicSpec,
      createRepository(context, anthropicProject, 'anthropic', { localPath: '/repo/anthropic' }),
    )
    const openaiProject = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'openai-only',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    context.projectAgentRepo.assign({ projectId: openaiProject.id, agentId: reviewer.id, role: 'builder' })
    const openaiSpec = context.specRepo.create({
      id: createId<'SpecId'>(),
      projectId: openaiProject.id,
      name: 'P-openai',
      status: 'approved',
      document: '# P-openai',
    })
    const openaiTask = createTask(
      context,
      openaiSpec,
      createRepository(context, openaiProject, 'openai', { localPath: '/repo/openai' }),
    )
    const input = inputFor(context, [anthropicProject, openaiProject], {
      host: {
        ...readyHost(context, [anthropicProject, openaiProject]),
        providerAuth: {
          anthropic: missing('Anthropic auth was not detected'),
          openai: ready('OpenAI auth detected'),
        },
      },
    })

    const eligibility = new Map(reportByProject(buildRepairReport(input)))

    expect(eligibility.get(anthropicProject.id)).toMatchObject({ eligible: false })
    expect(eligibility.get(openaiProject.id)).toMatchObject({ eligible: true, blockerIds: [] })
    expect(buildTaskPrerequisiteIssues({ ...input, task: anthropicTask, agent: builder })
      .some((item) => item.area === 'provider_auth')).toBe(true)
    expect(buildTaskPrerequisiteIssues({ ...input, task: openaiTask, agent: reviewer })).toEqual([])
  })
})

function reportByProject(report: ReturnType<typeof buildRepairReport>) {
  return report.projectDispatch.map((item) => [item.projectId, item] as const)
}

function inputFor(
  ctx: RepoContext,
  projects: Project[],
  overrides: Partial<BuildRepairReportInput> = {},
): BuildRepairReportInput {
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
    requirements: {
      remoteProjectIds: new Set(),
      githubProjectIds: new Set(),
      adapterNames: new Set(['claude-agent-sdk', 'vercel-ai']),
    },
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
  return ctx.repositoryRepo.create({
    id: createId<'RepositoryId'>() as never,
    projectId: project.id,
    name,
    spec,
  })
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
