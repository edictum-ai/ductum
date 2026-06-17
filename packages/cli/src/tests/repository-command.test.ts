import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockApi, emptyRepairReport, project, repository, runCommand } from './helpers.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ductum repository commands', () => {
  it('creates a Project with a redesigned Repository from the taught --repo path', async () => {
    const repoPath = gitRepo()
    const api = createMockApi({
      createProject: vi.fn().mockResolvedValue({ ...project, name: 'my-project', repos: [repoPath], config: { ...project.config, mergeMode: 'human' } }),
      getRepairReport: vi.fn().mockResolvedValue(emptyRepairReport()),
    })

    const created = await runCommand(['project', 'create', 'my-project', '--repo', repoPath], api)
    const repair = await runCommand(['repair', 'list'], api)

    expect(created.code).toBe(0)
    expect(api.createProject).toHaveBeenCalledWith({
      name: 'my-project',
      repositories: [{ localPath: repoPath }],
      config: { mergeMode: 'human' },
    })
    expect(repair.text).toContain('No setup, readiness, or Attempt recovery items found.')
    expect(repair.text).not.toContain('No repositories are configured')
  })

  it('rejects non-Git project --repo paths before calling the API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-not-git-'))
    tempDirs.push(dir)
    const api = createMockApi()

    const result = await runCommand(['project', 'create', 'bad', '--repo', dir], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--repo must be an existing Git repository path')
    expect(api.createProject).not.toHaveBeenCalled()
  })

  it('adds and lists Project repositories', async () => {
    const repoPath = gitRepo()
    const api = createMockApi({
      createRepository: vi.fn().mockResolvedValue({ ...repository, spec: { localPath: repoPath } }),
      listRepositories: vi.fn().mockResolvedValue([{ ...repository, spec: { localPath: repoPath } }]),
    })

    const added = await runCommand(['repository', 'add', project.name, '--repo', repoPath], api)
    const listed = await runCommand(['repository', 'list', project.name], api)

    expect(added.code).toBe(0)
    expect(api.createRepository).toHaveBeenCalledWith(project.id, { localPath: repoPath })
    expect(listed.text).toContain(repository.name)
    expect(listed.text).toContain(repoPath)
  })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-git-repo-'))
  tempDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}
