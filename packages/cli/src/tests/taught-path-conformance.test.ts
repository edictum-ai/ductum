import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRepairReport,
  createId,
  materializeRepository,
  type Agent,
  type Factory,
  type Project,
  type ProjectAgent,
  type RepairCheckStatus,
  type Repository,
} from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CreateProjectInput } from '../types.js'
import { createMockApi, runCommand } from './helpers.js'

const tempDirs: string[] = []
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const taughtProjectCreate = 'ductum project create ductum --repo "$PWD" --merge-mode human'
const taughtAgentAssign = 'ductum project agent assign ductum <agentName> --role builder'
const taughtSurfaces = [
  'docs/CLI_ONBOARDING.md',
  'docs/alpha-dogfood/cli-onboarding.md',
  'README.md',
  'docs/SETUP.md',
  'docs/openclaw-factory.md',
  '.agents/skills/ductum-cli/SKILL.md',
  '.agents/skills/ductum-onboard/SKILL.md',
]

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('taught path conformance', () => {
  it('keeps taught onboarding commands documented in help, docs, and the CLI skill', async () => {
    const help = await runCommand(['--help'])
    const docs = taughtSurfaces.map((path) => readFileSync(resolve(repoRoot, path), 'utf8')).join('\n')

    expect(help.text).toContain('ductum project create <name> --repo <path> --merge-mode human')
    expect(help.text).toContain('ductum project agent assign <name> <agent> --role builder')
    expect(docs).toContain(taughtProjectCreate)
    expect(docs).toContain(taughtAgentAssign)
    for (const path of taughtSurfaces) {
      const text = readFileSync(resolve(repoRoot, path), 'utf8')
      if (!text.includes('ductum project create')) continue
      expect(text, path).toContain('project agent assign')
    }
  })

  it('executes the taught boring path against a fixture factory and ends repair-clean', async () => {
    const repoPath = gitRepo()
    const api = createTaughtPathApi()

    const created = await runCommand(['project', 'create', 'ductum', '--repo', repoPath, '--merge-mode', 'human'], api)
    const assigned = await runCommand(['project', 'agent', 'assign', 'ductum', 'mimi', '--role', 'builder'], api)
    const repair = await runCommand(['--human', 'repair', 'list'], api)
    const status = await runCommand(['--human', 'status'], api)

    expect(created.code).toBe(0)
    expect(assigned.code).toBe(0)
    expect(repair.text).toContain('No setup, readiness, or Attempt recovery items found.')
    expect(status.text).toContain('The Factory is idle and ready for real work.')
  })
})

function createTaughtPathApi() {
  const now = '2026-06-26T12:00:00.000Z'
  const factory: Factory = {
    id: createId<'FactoryId'>(),
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    createdAt: now,
  }
  const builder: Agent = {
    id: createId<'AgentId'>(),
    name: 'mimi',
    model: 'gpt-5.4',
    harness: 'codex-sdk',
    capabilities: ['build', 'test'],
    costTier: 80,
    spawnConfig: {},
    createdAt: now,
  }
  const projects: Project[] = []
  const repositories = new Map<string, Repository[]>()
  const assignments: ProjectAgent[] = []

  return createMockApi({
    listProjects: vi.fn(async () => projects),
    listAgents: vi.fn(async () => [builder]),
    listRepositories: vi.fn(async (projectId: string) => repositories.get(projectId) ?? []),
    listProjectAgents: vi.fn(async (projectId: string) =>
      assignments.filter((assignment) => assignment.projectId === projectId)),
    listSpecs: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    listTaskDependencies: vi.fn(async () => []),
    listTaskRuns: vi.fn(async () => []),
    createProject: vi.fn(async (input: CreateProjectInput) => {
      const project: Project = {
        id: createId<'ProjectId'>(),
        factoryId: factory.id,
        name: input.name,
        repos: [],
        config: {
          mergeMode: input.config?.mergeMode === 'auto' ? 'auto' : 'human',
          workflowPath: 'workflows/coding-guard.yaml',
        },
        createdAt: now,
        updatedAt: now,
      }
      const projectRepositories = (input.repositories ?? []).map((repoInput) =>
        materializeRepository({
          id: createId<'RepositoryId'>() as never,
          projectId: project.id,
          name: repoInput.name ?? basename(repoInput.localPath ?? repoInput.remoteUrl ?? input.name),
          spec: repoInput,
          createdAt: now,
          updatedAt: now,
        }))
      project.repos = projectRepositories.map((repo) => repo.spec.localPath ?? repo.spec.remoteUrl ?? repo.name)
      projects.push(project)
      repositories.set(project.id, projectRepositories)
      return project
    }),
    assignProjectAgent: vi.fn(async (projectId: string, agentId: string, role: string) => {
      const assignment = { projectId: projectId as never, agentId: agentId as never, role: role as never }
      assignments.push(assignment)
      return assignment
    }),
    getRepairReport: vi.fn(async () => buildRepairReport({
      generatedAt: now,
      projects,
      repositoriesByProjectId: new Map(projects.map((project) => [project.id, repositories.get(project.id) ?? []])),
      projectAgents: assignments,
      agents: [builder],
      configResources: [],
      specs: [],
      tasks: [],
      requirements: {
        remoteProjectIds: new Set(),
        githubProjectIds: new Set(),
        adapterNames: new Set([builder.harness]),
      },
      host: {
        git: ready('Git is installed'),
        github: { state: 'not_applicable', label: 'No GitHub workflow selected' },
        providerAuth: { openai: ready('OpenAI auth detected') },
        factoryDataDir: ready('/tmp/ductum'),
        localApp: ready('API reachable on 4100'),
        repositories: Object.fromEntries([...repositories.values()].flat().map((repo) => [
          repo.id,
          { localGit: ready(repo.spec.localPath ?? repo.name) },
        ])),
      },
    })),
  })
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-taught-path-'))
  tempDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  mkdirSync(join(dir, '.edictum'), { recursive: true })
  return dir
}

function ready(label: string): RepairCheckStatus {
  return { state: 'ready', label }
}
