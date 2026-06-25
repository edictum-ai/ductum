import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, seedInitialFactoryDatabase } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InitCommandError } from '../../init/errors.js'
import { expandPath, resolveInitPaths, validateProjectName, validateWritableDirectory } from '../../init/paths.js'

const tmpDirs: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('init path validation', () => {
  it('expands home and resolves the project directory under the install dir', () => {
    expect(expandPath('~/ductum', '/tmp/nope', { HOME: '/home/test' })).toBe('/home/test/ductum')
    expect(resolveInitPaths({
      dir: '~/ductum',
      projectName: 'factory',
      env: { HOME: '/home/test' },
    })).toMatchObject({
      installDir: '/home/test/ductum',
      projectDir: '/home/test/ductum/factory',
    })
  })

  it('accepts only slug project names', () => {
    expect(validateProjectName('a')).toBe('a')
    expect(validateProjectName('factory-1')).toBe('factory-1')
    expect(() => validateProjectName('Factory 1')).toThrow(InitCommandError)
    expect(() => validateProjectName('a-')).toThrow(InitCommandError)
    expect(() => validateProjectName('-a')).toThrow(InitCommandError)
    try {
      validateProjectName('Factory 1')
    } catch (error) {
      expect(error).toMatchObject({ initCode: 'init_invalid_project_name' })
    }
  })

  it('rejects existing DB-backed Factory state with a start suggestion', async () => {
    const dir = await tempDir()
    const db = initDb(join(dir, 'ductum.db'))
    seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'existing' })
    db.close()

    await expect(validateWritableDirectory(dir, cleanGit())).rejects.toMatchObject({
      initCode: 'init_already_initialized',
      context: { source: 'database' },
      suggestedActions: [{ cmd: `ductum start --dir ${dir}` }],
    })
  })

  it('keeps DB-backed initialization precedence over a stale ductum.yaml file', async () => {
    const dir = await tempDir()
    const db = initDb(join(dir, 'ductum.db'))
    seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'existing' })
    db.close()
    await writeFile(join(dir, 'ductum.yaml'), 'factory:\n  migratedAt: tampered\n', 'utf8')

    await expect(validateWritableDirectory(dir, cleanGit())).rejects.toMatchObject({
      initCode: 'init_already_initialized',
      context: { source: 'database' },
    })
  })

  it('rejects a git repo with uncommitted changes', async () => {
    const dir = await tempDir()
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'true\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: ' M file.txt\n', stderr: '' })

    await expect(validateWritableDirectory(dir, runProcess)).rejects.toMatchObject({
      initCode: 'init_git_uncommitted',
    })
  })

  it('rejects a non-directory path as unwritable', async () => {
    const dir = await tempDir()
    const file = join(dir, 'not-a-dir')
    await writeFile(file, '', 'utf8')

    await expect(validateWritableDirectory(file, cleanGit())).rejects.toMatchObject({
      initCode: 'init_path_unwritable',
    })
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-paths-'))
  tmpDirs.push(dir)
  await mkdir(dir, { recursive: true })
  return dir
}

function cleanGit() {
  return vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
}
