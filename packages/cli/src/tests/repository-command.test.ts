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

  it('updates remoteUrl while preserving localPath', async () => {
    const repoPath = gitRepo()
    const existing = {
      ...repository,
      spec: { localPath: repoPath },
      readiness: { ...repository.readiness, supportsRemoteWorkflow: false, git: { state: 'missing' as const } },
    }
    const updated = {
      ...existing,
      spec: { localPath: repoPath, remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    }
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([existing]),
      updateRepository: vi.fn().mockResolvedValue(updated),
    })

    const result = await runCommand([
      'repository',
      'update',
      project.name,
      existing.name,
      '--remote-url',
      'https://github.com/edictum-ai/ductum.git',
    ], api)

    expect(result.code).toBe(0)
    expect(api.updateRepository).toHaveBeenCalledWith(existing.id, {
      spec: {
        localPath: repoPath,
        remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      },
    })
    expect(result.text).toContain(repoPath)
    expect(result.text).toContain('https://github.com/edictum-ai/ductum.git')
  })

  it('updates authRef while preserving remoteUrl and localPath', async () => {
    const localPath = '/repo/ductum'
    const existing = {
      ...repository,
      spec: {
        localPath,
        remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      },
    }
    const updated = {
      ...existing,
      spec: {
        ...existing.spec,
        authRef: 'secret:github-app',
      },
    }
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([existing]),
      updateRepository: vi.fn().mockResolvedValue(updated),
    })

    const result = await runCommand([
      'repository',
      'update',
      project.name,
      existing.name,
      '--auth-ref',
      'secret:github-app',
    ], api)

    expect(result.code).toBe(0)
    expect(api.updateRepository).toHaveBeenCalledWith(existing.id, {
      spec: {
        localPath,
        remoteUrl: 'https://github.com/edictum-ai/ductum.git',
        authRef: 'secret:github-app',
      },
    })
  })

  it('fails when the repository name or id is unknown', async () => {
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([repository]),
    })

    const result = await runCommand([
      'repository',
      'update',
      project.name,
      'missing-repository',
      '--remote-url',
      'https://github.com/edictum-ai/ductum.git',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain(`Repository not found in project ${project.name}: missing-repository`)
    expect(api.updateRepository).not.toHaveBeenCalled()
  })

  it('fails when the repository name is ambiguous', async () => {
    const duplicates = [
      repository,
      { ...repository, id: 'repository-2' as typeof repository.id },
    ]
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue(duplicates),
    })

    const result = await runCommand([
      'repository',
      'update',
      project.name,
      repository.name,
      '--remote-url',
      'https://github.com/edictum-ai/ductum.git',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain(`Ambiguous repository "${repository.name}" in project ${project.name}`)
    expect(result.errorText).toContain(repository.id)
    expect(result.errorText).toContain('repository-2')
    expect(api.updateRepository).not.toHaveBeenCalled()
  })

  it('fails when no update flags are provided', async () => {
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([repository]),
    })

    const result = await runCommand(['repository', 'update', project.name, repository.name], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('repository update requires at least one of --remote-url, --local-path, --default-branch, --branch-prefix, or --auth-ref')
    expect(api.updateRepository).not.toHaveBeenCalled()
  })

  it('rejects empty update values instead of clearing fields', async () => {
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([repository]),
    })

    const result = await runCommand([
      'repository',
      'update',
      project.name,
      repository.name,
      '--remote-url',
      '   ',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--remote-url must not be empty')
    expect(api.updateRepository).not.toHaveBeenCalled()
  })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-git-repo-'))
  tempDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}
