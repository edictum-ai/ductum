import { describe, expect, it } from 'vitest'

import { buildFactorySettingsCatalogs, type ConfigResource } from '../index.js'

const now = '2026-05-25T00:00:00.000Z'

describe('Factory Settings workflow shadowing', () => {
  it('shadows the built-in coding-guard preset when a saved record replaces it', () => {
    const catalogs = buildFactorySettingsCatalogs({
      configResources: [{
        id: 'workflow-seeded' as ConfigResource['id'],
        kind: 'WorkflowProfile',
        projectId: 'project-1' as NonNullable<ConfigResource['projectId']>,
        name: 'coding-guard',
        spec: {
          path: '/tmp/factory/.edictum/workflow-profile.yaml',
          description: 'Fresh factory guarded workflow profile',
        },
        createdAt: now,
        updatedAt: now,
      }],
      agents: [],
    })

    expect(catalogs.workflows).toEqual([
      expect.objectContaining({
        id: 'workflow-seeded',
        workflowId: 'coding-guard',
        presetId: 'coding-guard',
        source: 'saved',
        projectId: 'project-1',
        path: '/tmp/factory/.edictum/workflow-profile.yaml',
      }),
    ])
  })
})
