import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Spec, Target, Task } from '@ductum/core'

import { spec } from './helpers.js'

export function makeSpec(id: string, name: string): Spec {
  return { ...spec, id: id as Spec['id'], name }
}

export function makeTask(
  id: string,
  specId: Spec['id'],
  name: string,
  targetId: Target['id'] | null = null,
): Task {
  return {
    id: id as Task['id'],
    specId,
    targetId,
    name,
    prompt: name,
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'pending',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-04-05T00:00:00Z',
    updatedAt: '2026-04-05T00:00:00Z',
  }
}

export async function writeTempManifest(lines: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-resource-spec-'))
  const file = join(dir, 'resources.yaml')
  await writeFile(file, lines.join('\n'), 'utf8')
  return file
}
