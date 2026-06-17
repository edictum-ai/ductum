import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId, type RepairHostChecks } from '@ductum/core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildApiRepairReport } from '../lib/repair.js'
import { acceptRun } from '../lib/run-ops/accept.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('repair prerequisite routes', () => {
  it('exposes canonical repair items without secret-looking values', async () => {
    const secret = 'sk-ant-api03-supersecret-token'
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: {
        anthropic: { state: 'missing', label: secret, detail: `Anthropic auth missing for ${secret}` },
      },
      repositories: {},
    }
    fixture = await createFixture({
      repairChecks,
      getDispatcherStatus: dispatcherStatus,
    })
    const { project } = seedBase(fixture)
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = { [repo.id]: { localGit: ready('/repo/ductum') } }

    const result = await requestJson(fixture.app, '/api/repair')
    const body = result.json as { items: Array<{ area: string; field: { value: string }; reason: string }> }
    const provider = body.items.find((item) => item.area === 'provider_auth')

    expect(result.response.status).toBe(200)
    expect(JSON.stringify(result.json)).not.toContain(secret)
    expect(provider?.field.value).toBe('[redacted]')
    expect(provider?.reason).toContain('[redacted]')
  })

  it('reports missing remote and GitHub auth before Attempt start', async () => {
    const dispatchTask = vi.fn(async () => {
      throw new Error('dispatch should be blocked')
    })
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      github: { state: 'missing', label: '(missing)', detail: 'gh auth status failed' },
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: { anthropic: ready('Anthropic auth detected') },
      repositories: {},
    }
    fixture = await createFixture({
      dispatchTask,
      getDispatcherStatus: dispatcherStatus,
      repairChecks,
    })
    const seeded = seedBase(fixture)
    fixture.repos.projects.update(seeded.project.id, {
      config: { ...seeded.project.config, externalReviewRequired: true },
    })
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: seeded.project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = { [repo.id]: { localGit: ready('/repo/ductum') } }

    const result = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      body: { taskId: seeded.task.id, agentId: seeded.builder.id },
    })
    const body = result.json as { details: { items: Array<{ title: string; field: { path: string } }> } }
    const titles = body.details.items.map((item) => item.title)

    expect(result.response.status).toBe(409)
    expect(dispatchTask).not.toHaveBeenCalled()
    expect(titles).toContain('Repository remote is required')
    expect(titles).toContain('GitHub auth is missing')
    expect(body.details.items.map((item) => item.field.path)).toContain('host.github.auth')
  })

  it('rejects legacy accept before Attempt start when prerequisites fail', async () => {
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      github: { state: 'missing', label: '(missing)', detail: 'gh auth status failed' },
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: { anthropic: ready('Anthropic auth detected') },
      repositories: {},
    }
    fixture = await createFixture({
      getDispatcherStatus: dispatcherStatus,
      repairChecks,
    })
    const seeded = seedBase(fixture)
    fixture.repos.projects.update(seeded.project.id, {
      config: { ...seeded.project.config, externalReviewRequired: true },
    })
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: seeded.project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = { [repo.id]: { localGit: ready('/repo/ductum') } }

    const result = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id, agentId: seeded.builder.id },
    })

    expect(result.response.status).toBe(409)
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
    expect(fixture.repos.tasks.get(seeded.task.id)?.status).toBe('ready')
  })

  it('keeps valid Project dispatch usable when another Project has repair items', async () => {
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      github: { state: 'missing', label: '(missing)', detail: 'gh auth status failed' },
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: { anthropic: ready('Anthropic auth detected') },
      repositories: {},
    }
    const dispatchTask = vi.fn(async (taskId: string, agentId: string) =>
      acceptRun(fixture!.context, { taskId, agentId }))
    fixture = await createFixture({
      dispatchTask,
      getDispatcherStatus: dispatcherStatus,
      repairChecks,
    })
    const broken = seedBase(fixture)
    fixture.repos.projects.update(broken.project.id, {
      config: { ...broken.project.config, externalReviewRequired: true },
    })
    const brokenRepo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: broken.project.id,
      name: 'broken',
      spec: { localPath: '/repo/broken' },
    })
    const validProject = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: broken.factory.id,
      name: 'valid',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.projectAgents.assign({ projectId: validProject.id, agentId: broken.builder.id, role: 'builder' })
    const validSpec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: validProject.id,
      name: 'P-valid',
      status: 'approved',
      document: '# P-valid',
    })
    const validRepo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: validProject.id,
      name: 'valid',
      spec: { localPath: '/repo/valid' },
    })
    const validTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: validSpec.id,
      repositoryId: validRepo.id,
      name: 'Valid task',
      prompt: 'implement valid project',
      repos: ['/repo/valid'],
      assignedAgentId: broken.builder.id,
      status: 'ready',
      verification: ['pnpm test'],
    })
    repairChecks.repositories = {
      [brokenRepo.id]: { localGit: ready('/repo/broken') },
      [validRepo.id]: { localGit: ready('/repo/valid') },
    }

    const repair = await requestJson(fixture.app, '/api/repair')
    const dispatch = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      body: { taskId: validTask.id, agentId: broken.builder.id },
    })

    expect(repair.response.status).toBe(200)
    expect((repair.json as { projectDispatch: Array<{ projectId: string; eligible: boolean }> }).projectDispatch)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ projectId: broken.project.id, eligible: false }),
        expect.objectContaining({ projectId: validProject.id, eligible: true }),
      ]))
    expect(dispatch.response.status).toBe(201)
    expect(dispatchTask).toHaveBeenCalledWith(validTask.id, broken.builder.id)
  })

  it('returns the canonical grouped repair contract from the API', async () => {
    fixture = await createFixture({
      getDispatcherStatus: dispatcherStatus,
      repairChecks: {
        git: { state: 'missing', label: '(missing)', detail: 'git --version failed' },
        factoryDataDir: ready('/tmp/ductum'),
        localApp: ready('API reachable on 4100'),
      },
    })
    seedBase(fixture)

    const result = await requestJson(fixture.app, '/api/repair')

    expect(result.response.status).toBe(200)
    expect((result.json as { groups: unknown[] }).groups).toEqual(buildApiRepairReport(fixture.context).groups)
  })

  it('accepts existing Claude credentials as Anthropic provider auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-claude-'))
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'sk-ant-api03-file-token', refreshToken: 'refresh-token' },
    }))
    try {
      const repairChecks: Partial<RepairHostChecks> = {
        git: ready('Git is installed'),
        factoryDataDir: ready('/tmp/ductum'),
        localApp: ready('API reachable on 4100'),
        repositories: {},
      }
      fixture = await createFixture({
        repairChecks,
        getDispatcherStatus: dispatcherStatus,
      })
      const { project } = seedBase(fixture)
      const repo = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>() as never,
        projectId: project.id,
        name: 'ductum',
        spec: { localPath: '/repo/ductum' },
      })
      repairChecks.repositories = { [repo.id]: { localGit: ready('/repo/ductum') } }

      const result = await requestJson(fixture.app, '/api/repair')
      const body = result.json as { items: Array<{ area: string; record: { name: string | null } }> }

      expect(result.response.status).toBe(200)
      expect(body.items.some((item) => item.area === 'provider_auth' && item.record.name === 'Anthropic')).toBe(false)
      expect(JSON.stringify(result.json)).not.toContain('sk-ant-api03-file-token')
    } finally {
      if (previousConfigDir == null) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function dispatcherStatus() {
  return {
    running: true,
    activeRuns: 0,
    maxConcurrentRuns: 3,
    lastCycleAt: '2026-06-09T12:00:00.000Z',
    enabled: true,
    adapterCount: 2,
    adapters: ['claude-agent-sdk', 'codex-sdk'],
    reason: null,
  }
}

function ready(label: string) {
  return { state: 'ready' as const, label }
}
