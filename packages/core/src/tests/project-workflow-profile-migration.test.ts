import { describe, expect, it } from 'vitest'

import { initDb, SqliteConfigResourceRepo, SqliteFactoryRepo, SqliteProjectRepo, SqliteRepositoryRepo } from '../index.js'
import { applyMigration, MIGRATIONS } from '../db-migrations.js'
import { createId } from '../types.js'

describe('project workflowProfileRef migration', () => {
  it('backfills an unambiguous legacy workflowProfile path to workflowProfileRef', () => {
    const db = initDb(':memory:')
    const factories = new SqliteFactoryRepo(db)
    const projects = new SqliteProjectRepo(db)
    const repositories = new SqliteRepositoryRepo(db)
    const resources = new SqliteConfigResourceRepo(db)
    const factory = factories.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    const project = projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml', workflowProfile: '/repo/ductum/.edictum/workflow-profile.yaml' },
    })
    repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    const workflow = resources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'ductum',
      spec: { path: '.edictum/workflow-profile.yaml' },
    })

    applyMigration(db, workflowProfileMigration())

    expect(projects.get(project.id)?.config).toMatchObject({
      workflowProfile: '/repo/ductum/.edictum/workflow-profile.yaml',
      workflowProfileRef: workflow.id,
    })
    db.close()
  })

  it('leaves ambiguous legacy workflowProfile names unresolved', () => {
    const db = initDb(':memory:')
    const factories = new SqliteFactoryRepo(db)
    const projects = new SqliteProjectRepo(db)
    const resources = new SqliteConfigResourceRepo(db)
    const factory = factories.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    const project = projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml', workflowProfile: 'coding-guard' },
    })
    resources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'coding-guard',
      spec: { path: '.edictum/workflow-profile.yaml' },
    })
    resources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'coding-guard',
      spec: { path: '/repo/ductum/.edictum/workflow-profile.yaml' },
    })

    applyMigration(db, workflowProfileMigration())

    expect(projects.get(project.id)?.config).toMatchObject({ workflowProfile: 'coding-guard' })
    expect(projects.get(project.id)?.config).not.toHaveProperty('workflowProfileRef')
    db.close()
  })
})

function workflowProfileMigration() {
  const migration = MIGRATIONS.find((item: { id: string }) => item.id === '049_project_workflow_profile_refs')
  if (migration == null) throw new Error('missing project workflow profile ref migration')
  return migration
}
