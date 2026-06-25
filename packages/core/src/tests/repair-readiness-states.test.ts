import { afterEach, describe, expect, it } from 'vitest'

import {
  buildRepairReport,
  createId,
  repositoryReadiness,
  type BuildRepairReportInput,
  type Project,
  type RepairCheckStatus,
  type RepairHostChecks,
} from '../index.js'
import type { Repository, RepositorySpec } from '../resource-types.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

let context: RepoContext | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('repair readiness states', () => {
  it('does not label unverified repository config as ready', () => {
    const readiness = repositoryReadiness({
      remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      localPath: '/repo/ductum',
    })

    expect(readiness.local.state).toBe('configured')
    expect(readiness.git.state).toBe('configured')
    expect(readiness.github.state).toBe('configured')
  })

  it('keeps configured and not_checked distinct from ready while unknown remains blocking', () => {
    context = createRepoContext()
    const { project } = seedBase(context)
    const repo = createRepository(context, project, 'ductum', { localPath: '/repo/ductum' })

    const configuredReport = buildRepairReport(inputFor(context, [project], {
      host: {
        ...readyHost(context, [project]),
        git: { state: 'configured', label: 'Git path configured' },
        localApp: { state: 'not_checked', label: 'API port configured but not checked' },
        repositories: { [repo.id]: { localGit: { state: 'not_checked', label: '/repo/ductum' } } },
      },
    }))
    expect(configuredReport.items).toEqual([])

    const unknownReport = buildRepairReport(inputFor(context, [project], {
      host: {
        ...readyHost(context, [project]),
        providerAuth: { anthropic: { state: 'unknown', label: 'Anthropic', detail: 'No auth detector completed.' } },
      },
    }))
    expect(unknownReport.items.find((item) => item.area === 'provider_auth')).toMatchObject({
      status: 'unknown',
      field: { value: 'unknown' },
    })
  })
})

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

function ready(label: string): RepairCheckStatus {
  return { state: 'ready', label }
}
