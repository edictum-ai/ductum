import { createFixture, createId, createTask, describe, expect, it, vi } from './shared.js'
import { buildTaskPrerequisiteIssues, PrerequisiteCheckError } from '../../index.js'
import type { PrerequisiteIssue } from '../../repair-types.js'
import type { Task } from '../../types.js'

describe('dispatcher prerequisite gating', () => {
  it('manual dispatch rejects blockers before an Attempt row is created', async () => {
    const fixture = createFixture({
      preDispatchCheck: (task) => [prerequisiteIssue(task)],
    })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await expect(fixture.dispatcher.manualDispatch(task.id, fixture.builder.id))
      .rejects.toThrow('Attempt start blocked by prerequisite checks.')

    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('ready')
    expect(fixture.builderHarness.adapter.spawn).not.toHaveBeenCalled()
  })

  it('auto-dispatch rejects blockers before an Attempt row is created', async () => {
    const preDispatchCheck = vi.fn((task: Task) => [prerequisiteIssue(task)])
    const fixture = createFixture({ preDispatchCheck })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycleOnce()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors).toEqual([{
      taskId: task.id,
      error: expect.stringContaining('Attempt start blocked by prerequisite checks.'),
    }])
    expect(preDispatchCheck).toHaveBeenCalledWith(task, fixture.builder)
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('ready')
    expect(fixture.builderHarness.adapter.spawn).not.toHaveBeenCalled()
  })

  it('rejects invalid workflow content before an Attempt row is created', async () => {
    let fixture!: ReturnType<typeof createFixture>
    fixture = createFixture({
      preDispatchCheck: (task, agent) => buildTaskPrerequisiteIssues({
        generatedAt: '2026-06-09T12:00:00.000Z',
        projects: [fixture.project],
        repositoriesByProjectId: new Map([[fixture.project.id, fixture.context.repositoryRepo.list(fixture.project.id)]]),
        projectAgents: fixture.context.projectAgentRepo.list(fixture.project.id),
        agents: fixture.context.agentRepo.list(),
        configResources: fixture.context.configResourceRepo.list(),
        specs: [fixture.spec],
        tasks: [task],
        host: {
          git: { state: 'ready', label: 'Git is installed' },
          factoryDataDir: { state: 'ready', label: '/tmp/ductum' },
          localApp: { state: 'ready', label: 'API reachable on 4100' },
          providerAuth: { anthropic: { state: 'ready', label: 'Anthropic auth detected' } },
          repositories: Object.fromEntries(fixture.context.repositoryRepo.list(fixture.project.id).map((repo) => [
            repo.id,
            { localGit: { state: 'ready' as const, label: repo.spec.localPath ?? repo.name } },
          ])),
          workflows: { [workflow.id]: { state: 'missing', label: 'workflows/bad.yaml', detail: 'Workflow parse failed' } },
        },
        requirements: {
          remoteProjectIds: new Set(),
          githubProjectIds: new Set(),
          adapterNames: new Set(['claude-agent-sdk', 'vercel-ai']),
        },
        task,
        agent,
      }),
    })
    fixture.context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: fixture.project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    const workflow = fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>() as never,
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'broken-workflow',
      spec: { path: 'workflows/bad.yaml' },
    })
    // The project must reference the invalid workflow (by record name) for the
    // targeted validity blocker to apply to it.
    fixture.project.config.workflowProfile = 'broken-workflow'
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await expect(fixture.dispatcher.manualDispatch(task.id, fixture.builder.id))
      .rejects.toBeInstanceOf(PrerequisiteCheckError)

    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('ready')
    expect(fixture.builderHarness.adapter.spawn).not.toHaveBeenCalled()
  })
})

function prerequisiteIssue(task: Task): PrerequisiteIssue {
  return {
    id: `spec-start:${task.id}:provider-auth`,
    area: 'provider_auth',
    severity: 'blocker',
    title: 'Provider auth is missing',
    reason: 'Fake provider auth is missing for the selected agent.',
    suggestedAction: 'Configure provider authentication, then retry.',
    record: { type: 'Provider', id: 'provider:fake', name: 'Fake' },
    field: { path: 'providers.fake.auth', label: 'Fake auth', value: '(missing)' },
    blocks: 'Blocks agents whose provider is not authenticated.',
    status: 'missing',
    issueCode: 'provider_auth_missing',
    target: { providerId: 'fake', taskId: task.id, taskName: task.name },
    href: null,
    linkLabel: null,
  }
}
