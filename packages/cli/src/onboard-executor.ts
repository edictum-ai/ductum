import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project } from '@ductum/core'

import type { DuctumApi } from './api-client.js'
import type { ImportSpecInput, ImportSpecResult } from './types.js'
import { formatSummaryRows } from './format.js'
import { detectOnboardProject } from './onboard-detect.js'

export interface ExecuteOnboardInput {
  repoPath: string
  profilePath: string
  profile: string
  detection: ReturnType<typeof detectOnboardProject>
  mergeMode: 'auto' | 'human'
  force: boolean
  dryRun: boolean
  starterSpec: ImportSpecInput | null
}

export interface OnboardExecution {
  project: Project | null
  importedSpec: ImportSpecResult | null
  workflowProfileAction: 'write'
  projectAction: 'create' | 'attach-repository'
  starterSpecAction: 'import' | 'skip'
  starterSpecTaskCount: number
  dryRun: boolean
}

export async function executeOnboard(api: DuctumApi, input: ExecuteOnboardInput): Promise<OnboardExecution> {
  writeWorkflowProfile(input.profilePath, input.profile, input.force, input.dryRun)
  const existing = await findProject(api, input.detection.projectName)
  const projectAction: OnboardExecution['projectAction'] = existing == null ? 'create' : 'attach-repository'
  const project = existing ?? await createProject(api, input)
  if (existing != null) {
    await createRepository(api, project.id, input.repoPath, input.dryRun)
  }
  const importedSpec = input.starterSpec == null
    ? null
    : await importStarterSpec(api, project.id, input.starterSpec, input.dryRun)
  return {
    project: input.dryRun ? null : project,
    importedSpec,
    workflowProfileAction: 'write',
    projectAction,
    starterSpecAction: input.starterSpec == null ? 'skip' : 'import',
    starterSpecTaskCount: input.starterSpec?.tasks.length ?? 0,
    dryRun: input.dryRun,
  }
}

export function renderOnboardPlan(input: ExecuteOnboardInput, execution: OnboardExecution): string {
  const summaryInput: Record<string, string> = {
    project: input.detection.projectName,
    stack: input.detection.stack,
    repo: input.repoPath,
    workflowProfile: input.profilePath,
    verify: input.detection.verifyCommands.join(', '),
    workflowProfileAction: execution.workflowProfileAction,
    projectAction: execution.projectAction,
    starterSpecAction: execution.starterSpecAction,
  }
  if (input.starterSpec != null) {
    summaryInput.starterSpec = input.starterSpec.spec.name
    summaryInput.starterSpecTasks = String(execution.starterSpecTaskCount)
  }
  const summary = formatSummaryRows(summaryInput)
  const suffix = execution.dryRun
    ? 'dry-run: writes stubbed; no files or API writes were performed'
    : execution.importedSpec != null
      ? `next: ductum task list ${execution.importedSpec.spec.id}`
      : 'next: ductum doctor --json'
  return `${summary}\n${suffix}`
}

function writeWorkflowProfile(path: string, content: string, force: boolean, dryRun: boolean): void {
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists; pass --force to overwrite`)
  }
  if (dryRun) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

async function createProject(api: DuctumApi, input: ExecuteOnboardInput): Promise<Project> {
  if (input.dryRun) {
    return {
      id: 'dry-run-project' as Project['id'],
      factoryId: 'dry-run-factory' as Project['factoryId'],
      name: input.detection.projectName,
      repos: [],
      config: { mergeMode: input.mergeMode, workflowPath: input.profilePath },
      createdAt: 'dry-run',
      updatedAt: 'dry-run',
    }
  }
  return api.createProject({
    name: input.detection.projectName,
    repositories: [{ localPath: input.repoPath }],
    config: { mergeMode: input.mergeMode, workflowProfile: input.profilePath },
  })
}

async function createRepository(api: DuctumApi, projectId: Project['id'], repoPath: string, dryRun: boolean): Promise<void> {
  if (dryRun) return
  await api.createRepository(projectId, { localPath: repoPath })
}

async function importStarterSpec(
  api: DuctumApi,
  projectId: Project['id'],
  starterSpec: ImportSpecInput,
  dryRun: boolean,
): Promise<ImportSpecResult> {
  if (dryRun) {
    return {
      spec: {
        id: 'dry-run-spec' as ImportSpecResult['spec']['id'],
        projectId,
        name: starterSpec.spec.name,
        status: starterSpec.spec.status ?? 'approved',
        strategy: 'normal',
        strategyConfig: null,
        document: starterSpec.spec.document ?? '',
        maxFixIterations: null,
        createdAt: 'dry-run',
        updatedAt: 'dry-run',
      },
      taskCount: starterSpec.tasks.length,
    }
  }
  return api.importSpec(projectId, starterSpec)
}

async function findProject(api: DuctumApi, name: string) {
  const projects = await api.listProjects()
  return projects.find((project) => project.name === name) ?? null
}
