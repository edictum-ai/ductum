import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMockApi, runCommand } from './helpers.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ductum project repository onboarding', () => {
  it('starts project onboarding from a local path', async () => {
    const repoPath = gitRepo()
    const api = createMockApi()
    const result = await runCommand([
      'project',
      'create',
      'local-project',
      '--local-path',
      repoPath,
    ], api)

    expect(result.code).toBe(0)
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'local-project',
      repositories: [{ localPath: repoPath }],
      config: { mergeMode: 'human' },
    }))
  })

  it('starts project onboarding from a remote repository', async () => {
    const api = createMockApi()
    const result = await runCommand([
      'project',
      'create',
      'remote-project',
      '--remote-url',
      'https://github.com/edictum-ai/remote-project.git',
    ], api)

    expect(result.code).toBe(0)
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'remote-project',
      repositories: [{ remoteUrl: 'https://github.com/edictum-ai/remote-project.git' }],
      config: { mergeMode: 'human' },
    }))
  })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-project-git-repo-'))
  tempDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}
