import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initDb,
  SqliteAgentRepo,
  SqliteConfigResourceRepo,
  SqliteFactoryRepo,
  SqliteProjectAgentRepo,
  SqliteProjectRepo,
  SqliteRepositoryRepo,
  SqliteComponentRepo,
  SqliteFactoryRuntimeSettingsRepo,
  type SqliteDatabase,
} from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultRunProcess, initGit } from '../../init/scaffolders/git-init.js'
import { scaffoldFactory } from '../../init/steps/scaffold.js'
import type { RunProcess } from '../../runtime.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('init scaffolder', () => {
  it('writes the DB-only factory skeleton and initializes git', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const runProcess = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    const result = await scaffoldFactory({ projectDir, projectName: 'factory', git: true, runProcess })
    expect(result).toMatchObject({
      projectDir,
      dbPath: join(projectDir, 'ductum.db'),
      files: ['ductum.db', '.gitignore', '.edictum/workflow-profile.yaml', '.ductum/'],
      git: { initialized: true, committed: true },
    })
    expect(existsSync(join(projectDir, 'ductum.yaml'))).toBe(false)
    expect(readFileSync(join(projectDir, '.edictum', 'workflow-profile.yaml'), 'utf8')).toContain('test -f ductum.db')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf8')).toContain('.env.local')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf8')).toContain('ductum.db')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf8')).toContain('ductum.db-*')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf8')).toContain('.ductum/')
    expect(existsSync(join(projectDir, '.ductum'))).toBe(true)
    expect(statSync(join(projectDir, '.ductum', 'secrets.key')).size).toBe(32)
    expect(statSync(join(projectDir, '.ductum', 'secrets.key')).mode & 0o777).toBe(0o600)
    withDb(projectDir, (db) => {
      const factory = new SqliteFactoryRepo(db).get()
      const project = new SqliteProjectRepo(db).list(factory!.id)[0]
      expect(factory).toMatchObject({ name: 'factory' })
      expect(new SqliteProjectRepo(db).list(factory!.id)).toEqual([
        expect.objectContaining({
          name: 'factory',
          repos: ['.'],
          config: expect.objectContaining({ workflowProfileRef: expect.any(String) }),
        }),
      ])
      expect(new SqliteConfigResourceRepo(db).getByName('WorkflowProfile', 'coding-guard', project!.id)).toMatchObject({
        spec: { path: join(projectDir, '.edictum', 'workflow-profile.yaml') },
      })
      expect(new SqliteConfigResourceRepo(db).getByName('WorkflowProfile', 'coding-guard')).toMatchObject({
        spec: { path: 'workflows/coding-guard-profile.yaml' },
      })
      expect(new SqliteFactoryRuntimeSettingsRepo(db).get(factory!.id)).toMatchObject({
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
      })
    })
    expect(runProcess).toHaveBeenCalledWith('git', ['-C', projectDir, 'init'])
    expect(runProcess).toHaveBeenCalledWith('git', ['-C', projectDir, 'add', '.gitignore'])
  })

  it('seeds a verify command that passes for a fresh factory and would fail under the old default', async () => {
    const projectDir = join(await tempDir(), 'factory')
    await scaffoldFactory({ projectDir, projectName: 'factory', git: false, runProcess: vi.fn() })
    const seededVerify = spawnSync('sh', ['-lc', 'test -f ductum.db'], { cwd: projectDir, encoding: 'utf8' })
    const oldDefaultVerify = spawnSync('sh', ['-lc', 'pnpm build'], { cwd: projectDir, encoding: 'utf8' })
    expect(seededVerify.status).toBe(0)
    expect(oldDefaultVerify.status).not.toBe(0)
  })

  it('uses the operator git author when one is configured', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const runProcess = vi.fn().mockImplementation(async (_command: string, args: string[] = []) => {
      if (args.at(-1) === 'user.name') return { code: 0, stdout: 'Ada\n', stderr: '' }
      if (args.at(-1) === 'user.email') return { code: 0, stdout: 'ada@example.test\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    })
    await scaffoldFactory({ projectDir, projectName: 'factory', git: true, runProcess })
    expect(runProcess).toHaveBeenCalledWith('git', [
      '-C',
      projectDir,
      'commit',
      '-m',
      'chore: initialize ductum factory',
    ])
  })

  it('skips git when requested', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const runProcess = vi.fn()
    const result = await scaffoldFactory({ projectDir, projectName: 'factory', git: false, runProcess })
    expect(result.git).toEqual({ initialized: false, committed: false })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('seeds separate Claude builder and reviewer resources after Anthropic auth', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const runProcess = vi.fn()
    await scaffoldFactory({ projectDir, projectName: 'factory', git: false, runProcess, claudeAgent: true })
    withDb(projectDir, (db) => {
      expect(new SqliteAgentRepo(db).list()).toEqual([
        expect.objectContaining({
          name: 'claude-builder',
          model: 'claude-sonnet-5',
          harness: 'claude-agent-sdk',
          resourceRefs: expect.objectContaining({
            modelRef: 'claude-sonnet-5',
            harnessRef: 'claude-agent-sdk',
          }),
        }),
        expect.objectContaining({
          name: 'claude-reviewer',
          model: 'claude-opus-4-8',
          harness: 'claude-agent-sdk',
          resourceRefs: expect.objectContaining({
            modelRef: 'claude-opus-4-8',
            harnessRef: 'claude-agent-sdk',
          }),
        }),
      ])
      expect(new SqliteConfigResourceRepo(db).getByName('Harness', 'claude-agent-sdk')).toMatchObject({
        spec: { type: 'claude-agent-sdk' },
      })
      const factory = new SqliteFactoryRepo(db).get()
      const project = new SqliteProjectRepo(db).list(factory!.id)[0]!
      const assignments = new SqliteProjectAgentRepo(db).list(project.id)
      const agents = new SqliteAgentRepo(db)
      expect(assignments.map((assignment) => [assignment.role, agents.get(assignment.agentId)?.model]).sort())
        .toEqual([['builder', 'claude-sonnet-5'], ['reviewer', 'claude-opus-4-8']])
    })
  })

  it('seeds every selected provider agent resource', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const runProcess = vi.fn()
    await scaffoldFactory({
      projectDir,
      projectName: 'factory',
      git: false,
      runProcess,
      agents: ['anthropic', 'codex', 'copilot'],
    })
    withDb(projectDir, (db) => {
      expect(new SqliteAgentRepo(db).list().map((agent) => agent.name).sort()).toEqual([
        'claude-builder',
        'claude-reviewer',
        'codex-builder',
        'copilot-builder',
      ])
      expect(new SqliteConfigResourceRepo(db).getByName('Harness', 'codex-sdk')).toMatchObject({
        spec: { type: 'codex-sdk' },
      })
      expect(new SqliteConfigResourceRepo(db).getByName('Model', 'github-copilot-gpt-5-4')).toMatchObject({
        spec: { provider: 'github-copilot', modelId: 'gpt-5.4' },
      })
      const factory = new SqliteFactoryRepo(db).get()
      const project = new SqliteProjectRepo(db).list(factory!.id)[0]!
      expect(new SqliteProjectAgentRepo(db).list(project.id)).toHaveLength(4)
      expect(new SqliteProjectAgentRepo(db).getByRole(project.id, 'reviewer').map((assignment) => {
        return new SqliteAgentRepo(db).get(assignment.agentId)?.name
      })).toEqual(['claude-reviewer'])
      const repository = new SqliteRepositoryRepo(db).list(project.id)[0]!
      expect(new SqliteComponentRepo(db).list(repository.id)).toEqual([
        expect.objectContaining({ name: 'root', spec: { path: '.' } }),
      ])
    })
  })

  it('uses the consolidated target validator when called directly', async () => {
    const projectDir = join(await tempDir(), 'factory')
    await mkdir(projectDir)
    const runProcess = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })

    await scaffoldFactory({ projectDir, projectName: 'factory', git: false, runProcess })

    expect(runProcess).toHaveBeenCalledTimes(1)
    expect(runProcess).toHaveBeenCalledWith('git', [
      '-C',
      projectDir,
      'rev-parse',
      '--is-inside-work-tree',
    ], undefined)
  })

  it('rolls back a newly-created project dir when cancelled during scaffolding', async () => {
    const projectDir = join(await tempDir(), 'factory')
    const controller = new AbortController()

    await expect(scaffoldFactory({
      projectDir,
      projectName: 'factory',
      git: false,
      runProcess: vi.fn(),
      signal: controller.signal,
      hooks: { afterMkdir: () => controller.abort() },
    })).rejects.toMatchObject({ initCode: 'init_cancelled' })
    expect(existsSync(projectDir)).toBe(false)
  })

  it('kills git config probes when init is cancelled', async () => {
    const root = await tempDir()
    const projectDir = join(root, 'factory')
    await mkdir(projectDir)
    const pidFile = join(root, 'git-pids.txt')
    const binDir = join(root, 'bin')
    await mkdir(binDir)
    await writeFakeGit(join(binDir, 'git'), pidFile)
    const controller = new AbortController()
    const runProcess: RunProcess = (command, args, options = {}) => defaultRunProcess(command, args, {
      ...options,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    })

    const promise = initGit(projectDir, runProcess, controller.signal)
    const pids = await waitForGitConfigPids(pidFile, 2)
    controller.abort()

    await expect(promise).rejects.toMatchObject({ initCode: 'init_cancelled' })
    await expect(waitForPidsToExit(pids)).resolves.toBeUndefined()
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-scaffold-'))
  tmpDirs.push(dir)
  return dir
}

async function writeFakeGit(path: string, pidFile: string): Promise<void> {
  await writeFile(path, `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('config')) {
  fs.appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n')
  setInterval(() => {}, 1000)
} else {
  process.exit(0)
}
`, 'utf8')
  await chmod(path, 0o755)
}

async function waitForGitConfigPids(pidFile: string, count: number): Promise<number[]> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(pidFile)) {
      const pids = readFileSync(pidFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10))
      if (pids.length >= count) return pids
    }
    await delay(10)
  }
  throw new Error('timed out waiting for fake git config probes')
}

async function waitForPidsToExit(pids: number[]): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (pids.every((pid) => !isRunning(pid))) return
    await delay(10)
  }
  throw new Error(`git config probe still running: ${pids.filter(isRunning).join(', ')}`)
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withDb(projectDir: string, fn: (db: SqliteDatabase) => void): void {
  const db = initDb(join(projectDir, 'ductum.db'))
  try {
    fn(db)
  } finally {
    db.close()
  }
}
