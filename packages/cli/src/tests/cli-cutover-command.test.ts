import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId, initDb, SqliteFactoryRepo, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activeRun, activeTask, createMockApi, project, readyTask, runCommand, stalledRun, stalledTask } from './helpers.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('public operator CLI surface', () => {
  it('teaches the normal path first and keeps old command groups out of top-level help', async () => {
    const result = await runCommand(['--help'])

    expect(result.code).toBe(0)
    expect(result.text).toContain('Normal path:')
    expect(result.text).toContain('ductum init --no-login --no-browser')
    expect(result.text).toContain('ductum start --no-browser')
    expect(result.text).toContain('ductum project create <name> --repo <path> --merge-mode human')
    expect(result.text).toContain('ductum doctor')
    expect(result.text).toContain('ductum repair')
    expect(result.text).toContain('ductum status')

    for (const command of ['init', 'start', 'status', 'doctor', 'repair', 'project', 'repository', 'spec', 'task', 'attempt', 'approve', 'deny', 'retry', 'cancel', 'watch', 'logs', 'factory']) {
      expect(helpLine(result.text, command), command).not.toBe('')
    }
    for (const command of ['agent', 'run', 'queue', 'config', 'resource', 'target', 'debug', 'legacy', 'serve', 'runs', 'events', 'dispatcher', 'operator', 'telegram', 'budget', 'turns']) {
      expect(helpLine(result.text, command), command).toBe('')
    }
    expect(result.text.toLowerCase()).not.toContain('seed')
  })

  it('shows Projects, Factory Activity, and next actions in status', async () => {
    const result = await runCommand(['status'])

    expect(result.code).toBe(0)
    expect(result.text).toContain('Projects')
    expect(result.text).toContain(project.name)
    expect(result.text).toContain('REPOSITORIES')
    expect(result.text).toContain('Factory Activity')
    expect(result.text).toContain('ACTIVE ATTEMPTS')
    expect(result.text).toContain('Next Operator Actions')
    expect(result.text).toContain('failed or stalled Attempt')
    expect(result.text).not.toContain('Needs Attention\n(empty)')
    expect(result.text).not.toContain('activeRuns')
    expect(result.text).not.toContain('stalledRuns')
    expect(result.text).not.toContain('<spec.yaml>')
  })

  it('lists every needs-operator Attempt in status with full IDs and safe commands', async () => {
    const secondTask: Task = { ...stalledTask, id: 'task-second-stalled' as Task['id'], name: 'Second Stalled Task' }
    const firstRun: Run = { ...stalledRun, id: 'attempt-stalled-full-id-111111' as Run['id'], failReason: 'checkpoint resume unavailable across server restart' }
    const secondRun: Run = { ...stalledRun, id: 'attempt-stalled-full-id-222222' as Run['id'], taskId: secondTask.id, failReason: 'heartbeat timeout after restart' }
    const api = createMockApi({
      listTasks: vi.fn().mockImplementation(async () => [readyTask, activeTask, stalledTask, secondTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === activeTask.id) return [activeRun]
        if (taskId === stalledTask.id) return [firstRun]
        if (taskId === secondTask.id) return [secondRun]
        return []
      }),
    })

    const result = await runCommand(['status'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Needs Attention')
    for (const run of [firstRun, secondRun]) {
      expect(result.text).toContain(run.id)
      expect(result.text).toContain(`ductum status ${run.id}`)
      expect(result.text).toContain(`ductum logs ${run.id}`)
      expect(result.text).toContain(`ductum watch ${run.id}`)
      expect(result.text).toContain(`ductum retry ${run.id}`)
    }
    expect(result.text).toContain('checkpoint resume unavailable across server restart')
    expect(result.text).toContain('heartbeat timeout after restart')
  })

  it('labels historical stalled Attempts separately from current repair work', async () => {
    const historicalTask: Task = {
      ...stalledTask,
      id: 'task-historical-stalled' as Task['id'],
      status: 'done',
    }
    const historicalRun: Run = {
      ...stalledRun,
      taskId: historicalTask.id,
      id: 'attempt-historical-stalled' as Run['id'],
      failReason: 'stalled before a later successful fix',
    }
    const api = createMockApi({
      listTasks: vi.fn().mockResolvedValue([historicalTask]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) =>
        taskId === historicalTask.id ? [historicalRun] : [],
      ),
    })

    const result = await runCommand(['status'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('PAST STALLS')
    expect(result.text).toContain('NEEDS ATTENTION')
    expect(result.text).not.toContain('failed or stalled Attempt needs operator action')
    expect(result.text).toContain('past stalled Attempt remains in history')
    expect(result.text).toContain('<spec-or-directory>')
    expect(result.text).not.toContain('<spec.yaml>')
    expect(result.text).not.toContain('Needs Attention\n')
  })

  it('uses redesigned wording in watch snapshots', async () => {
    const result = await runCommand(['watch', '--once'])

    expect(result.code).toBe(0)
    expect(result.text).toContain('Factory Activity')
    expect(result.text).toContain('Active attempts')
    expect(result.text).toContain('Active Attempts')
    expect(result.text).toContain('Needs Attention')
    expect(result.text).toContain('attempt start task-ready --agent mimi --project ductum')
    expect(result.text).not.toContain('Active Runs')
    expect(result.text).not.toContain('run task-ready --agent')
  })

  it('uses phase/result summaries for normal Attempt commands', async () => {
    const approvalApi = createMockApi({
      approveRun: vi.fn().mockResolvedValue({ success: false, stage: 'ship', reason: 'merge conflict' }),
    })

    const logs = await runCommand(['logs', activeRun.id])
    const approval = await runCommand(['approve', activeRun.id], approvalApi)
    const cancel = await runCommand(['--human', 'cancel', activeRun.id, '--reason', 'duplicate attempt'])

    expect(logs.text).toContain('phase: In progress')
    expect(logs.text).not.toContain('stage:')
    expect(approval.text).toContain('phase: Awaiting approval')
    expect(approval.text).not.toContain('stage: ship')
    expect(cancel.text).toContain('result: Cancelled')
    expect(cancel.text).not.toContain('terminalState')
  })

  it('does not expose raw enum labels in normal status output', async () => {
    const waitingApprovalRun: Run = {
      ...activeRun,
      id: 'attempt-awaiting-approval' as Run['id'],
      taskId: activeTask.id,
      stage: 'ship',
      pendingApproval: true,
    }
    const api = createMockApi({
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === activeTask.id) return [waitingApprovalRun]
        return []
      }),
    })

    const result = await runCommand(['status'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('APPROVALS')
    expect(result.text).not.toContain('awaiting_approval')
    expect(result.text).not.toContain('legacy-config')
    expect(result.text).not.toContain('persisted-db')
  })

  it('uses redesigned wording for DB-backed Factory data start plans', async () => {
    const dir = await persistedFactoryDir()
    const result = await runCommand(['--human', 'start', '--dir', dir, '--dry-run'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(result.text).toContain('Project Summary')
    expect(result.text).toContain('Factory Activity')
    expect(result.text).toContain('Setup')
    expect(result.text).toContain('Next Operator Actions')
    expect(result.text).toContain('using DB-backed Factory data')
    expect(result.text).not.toContain('persisted-db')
    expect(result.text).not.toContain('ductum.yaml')
    expect(result.text.toLowerCase()).not.toContain('seed')
  })

  it('does not mention migration for fresh start without Factory state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-p7a-missing-home-'))
    tmpDirs.push(home)
    const result = await runCommand(['start', '--dry-run'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('No Factory setup found')
    expect(result.errorText).toContain('Next setup action: ductum init')
    expect(result.errorText).not.toContain('migrate-legacy')
    expect(result.errorText.toLowerCase()).not.toContain('seed')
  })

  it('starts Attempts through the normal Attempt command', async () => {
    const doneRun: Run = { ...activeRun, stage: 'done' as const }
    const api = createMockApi({
      dispatch: vi.fn().mockResolvedValue(activeRun),
      getRun: vi.fn().mockResolvedValue(doneRun),
    })

    const result = await runCommand(['attempt', 'start', readyTask.id, '--agent', 'mimi', '--project', project.name], api)

    expect(result.code).toBe(0)
    expect(api.dispatch).toHaveBeenCalledWith(readyTask.id, 'agent-1')
    expect(result.text).toContain('Starting Attempt')
    expect(result.text).toContain('Attempt')
    expect(result.text).not.toContain('stage: done')
  })
})

function helpLine(text: string, command: string): string {
  return text.split('\n').find((line) => line.trimStart().startsWith(`${command} `) || line.trim() === command) ?? ''
}

async function persistedFactoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-p7a-persisted-'))
  tmpDirs.push(dir)
  await writeFile(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=existing-token\n')
  const db = initDb(join(dir, 'ductum.db'))
  new SqliteFactoryRepo(db).create({
    id: createId<'FactoryId'>(),
    name: 'Persisted Factory',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  db.close()
  return dir
}
