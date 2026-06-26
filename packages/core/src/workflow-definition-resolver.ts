import { loadWorkflow, loadWorkflowString, type WorkflowDefinition } from '@edictum/core'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveProjectWorkflowProfileResource } from './project-workflow-profile.js'
import { loadRenderedWorkflow } from './workflow-renderer.js'
import { requireMaterializedWorkflowProfile } from './workflow-profile-runtime.js'
import type { ConfigResourceRepo, ProjectRepo, RepositoryRepo, RunRepo, SpecRepo, TaskRepo } from './repos/interfaces.js'
import type { RepositoryId } from './resource-types.js'
import type { Project, Run, RunId, RunWorkflowProfileSnapshot } from './types.js'

export interface WorkflowDefinitionResolverOptions {
  fallbackWorkflowPath: string
  templateWorkflowPath: string
  workflowDefsByProjectName?: ReadonlyMap<string, WorkflowDefinition>
  runRepo: RunRepo
  taskRepo: TaskRepo
  specRepo: SpecRepo
  projectRepo: ProjectRepo
  configResourceRepo?: ConfigResourceRepo
  repositoryRepo?: RepositoryRepo
}

export class WorkflowDefinitionResolver {
  private fallbackDefinition: WorkflowDefinition | null = null
  private readonly definitionsByProfilePath = new Map<string, WorkflowDefinition>()

  constructor(private readonly options: WorkflowDefinitionResolverOptions) {}

  initialize(): void {
    this.fallbackDefinition = loadWorkflow(this.options.fallbackWorkflowPath)
  }

  getForRun(runId: RunId): WorkflowDefinition {
    const run = this.options.runRepo.get(runId)
    if (run == null) {
      return this.requireFallback()
    }
    if (run.runtimeWorkflowProfile != null) {
      return this.getRunProfileDefinition(run.runtimeWorkflowProfile)
    }
    const project = this.resolveProject(run)
    if (project == null) {
      return this.requireFallback()
    }

    const preloaded = this.options.workflowDefsByProjectName?.get(project.name)
    if (preloaded != null) {
      return preloaded
    }

    const workflowProfileRef = project.config.workflowProfileRef?.trim()
    if (workflowProfileRef != null && workflowProfileRef !== '') {
      const resourceRepo = this.options.configResourceRepo
      if (resourceRepo == null) {
        throw new Error(`Project ${project.name} workflowProfileRef "${workflowProfileRef}" cannot resolve without config resources`)
      }
      const resource = resolveProjectWorkflowProfileResource(
        resourceRepo.list({ kind: 'WorkflowProfile' }),
        project.id,
        project.config,
        this.projectRepoRoots(project),
      ).resource
      if (resource == null) {
        throw new Error(`Project ${project.name} workflowProfileRef "${workflowProfileRef}" does not reference an existing WorkflowProfile`)
      }
      return this.getProfileDefinition(this.requireResourcePath(project.name, workflowProfileRef, resource))
    }
    if (project.config.workflowProfile == null) return this.getFallbackForRun(run, project)
    const resolution = resolveProjectWorkflowProfileResource(
      this.options.configResourceRepo?.list({ kind: 'WorkflowProfile' }) ?? [],
      project.id,
      project.config,
      this.projectRepoRoots(project),
    )
    if (resolution.resource == null) {
      if (resolution.issue === 'workflow_profile_legacy_ambiguous') {
        throw new Error(`Project ${project.name} workflowProfile "${project.config.workflowProfile}" matches multiple WorkflowProfile records`)
      }
      if (this.options.configResourceRepo != null) {
        throw new Error(`Project ${project.name} workflowProfile "${project.config.workflowProfile}" does not resolve to exactly one WorkflowProfile record`)
      }
      return this.getProfileDefinition(project.config.workflowProfile)
    }
    return this.getProfileDefinition(this.requireResourcePath(project.name, project.config.workflowProfile, resolution.resource))
  }

  private resolveProject(run: Run): Project | null {
    const task = this.options.taskRepo.get(run.taskId)
    if (task == null) return null
    const spec = this.options.specRepo.get(task.specId)
    if (spec == null) return null
    return this.options.projectRepo.get(spec.projectId)
  }

  private getProfileDefinition(profilePath: string): WorkflowDefinition {
    let definition = this.definitionsByProfilePath.get(profilePath)
    if (definition == null) {
      try {
        definition = loadRenderedWorkflow(this.options.templateWorkflowPath, profilePath)
      } catch (error) {
        throw new Error(`WorkflowProfile ${profilePath} could not render: ${toErrorMessage(error)}`)
      }
      this.definitionsByProfilePath.set(profilePath, definition)
    }
    return definition
  }

  private getRunProfileDefinition(profile: RunWorkflowProfileSnapshot): WorkflowDefinition {
    const materialized = requireMaterializedWorkflowProfile(profile)
    const cacheKey = `${materialized.path}\0${materialized.renderedWorkflow}`
    let definition = this.definitionsByProfilePath.get(cacheKey)
    if (definition == null) {
      try {
        definition = loadWorkflowString(materialized.renderedWorkflow)
      } catch (error) {
        throw new Error(`WorkflowProfile ${profile.name} (${profile.path}) snapshot could not load: ${toErrorMessage(error)}`)
      }
      this.definitionsByProfilePath.set(cacheKey, definition)
    }
    return definition
  }

  private requireFallback(): WorkflowDefinition {
    if (this.fallbackDefinition == null) {
      throw new Error('WorkflowDefinitionResolver is not initialized')
    }
    return this.fallbackDefinition
  }

  private getFallbackForRun(run: Run, project: Project): WorkflowDefinition {
    const fallback = this.requireFallback()
    const guidanceFile = this.resolveRepositoryGuidanceFile(run, project)
    if (guidanceFile == null || guidanceFile === 'README.md') return fallback
    return withUnderstandGuidanceGate(fallback, guidanceFile)
  }

  private resolveRepositoryGuidanceFile(run: Run, project: Project): string | null {
    const repositoryRepo = this.options.repositoryRepo
    if (repositoryRepo == null) return null
    const task = this.options.taskRepo.get(run.taskId)
    if (task == null) return null
    const projectRepositories = repositoryRepo.list(project.id)
    const repository =
      task.repositoryId != null
        ? repositoryRepo.get(task.repositoryId as RepositoryId)
        : task.repos.length === 1
          ? repositoryRepo.getByName(project.id, task.repos[0]!) ?? (projectRepositories.length === 1 ? projectRepositories[0]! : null)
          : projectRepositories[0] ?? null
    const localPath = repository?.spec.localPath
    if (localPath == null || localPath.trim() === '') return null

    for (const file of ['README.md', 'AGENTS.md', 'CLAUDE.md']) {
      if (existsSync(resolve(localPath, file))) return file
    }
    return null
  }

  private projectRepoRoots(project: Project): string[] {
    const repositoryRepo = this.options.repositoryRepo
    if (repositoryRepo == null) return []
    return repositoryRepo
      .list(project.id)
      .map((repository) => repository.spec.localPath)
      .filter((path): path is string => typeof path === 'string' && path.trim() !== '')
  }

  private requireResourcePath(projectName: string, ref: string, resource: { name: string; spec: unknown }): string {
    const path = (resource.spec as { path?: unknown }).path
    if (typeof path === 'string' && path.trim() !== '') return path.trim()
    throw new Error(`Project ${projectName} workflowProfile "${ref}" resolved to WorkflowProfile ${resource.name} without spec.path`)
  }
}

function withUnderstandGuidanceGate(definition: WorkflowDefinition, file: string): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) => {
      if (stage.id !== 'understand') return stage
      return {
        ...stage,
        exit: stage.exit.map((gate) => {
          if (gate.condition !== 'file_read("README.md")') return gate
          return {
            ...gate,
            condition: `file_read("${file}")`,
            message: `Read ${file} before editing`,
          }
        }),
      }
    }),
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
