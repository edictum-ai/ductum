import { describe, expect, it, vi } from 'vitest'
import type { RepairReport, Run, Task } from '@ductum/core'

import { activeTask, createMockApi, emptyRepairReport, readyTask, runCommand, stalledRun, stalledTask } from './helpers.js'

describe('ductum repair command', () => {
  it('prints shared repair contract fields without raw internal enum labels', async () => {
    const report: RepairReport = {
      ...emptyRepairReport(),
      items: [{
        id: 'repository:repo-1:remoteUrl:missing',
        area: 'repository_readiness',
        severity: 'blocker',
        title: 'Repository remote is required',
        reason: 'Project ductum needs remote repository support.',
        suggestedAction: 'Add a remote URL through Project Repository settings.',
        record: { type: 'Repository', id: 'repo-1', name: 'ductum' },
        field: {
          path: 'projects.ductum.repositories.ductum.remoteUrl',
          label: 'Repository remote URL',
          value: '(missing)',
        },
        blocks: 'Blocks attempts that need a ready repository.',
        status: 'missing',
        issueCode: 'repository_remote_missing',
        target: { projectId: 'project-1', projectName: 'ductum', repositoryId: 'repo-1', repositoryName: 'ductum' },
        href: null,
        linkLabel: null,
      }],
      groups: [{
        area: 'repository_readiness',
        label: 'Repository readiness',
        blocks: 'Blocks attempts that need a ready repository.',
        items: [],
      }],
      summary: {
        ...emptyRepairReport().summary,
        total: 1,
        blockers: 1,
        byArea: { ...emptyRepairReport().summary.byArea, repository_readiness: 1 },
      },
    }
    report.groups[0]!.items = report.items
    const api = createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) })

    const result = await runCommand(['repair', 'list'], api)

    expect(result.code).toBe(0)
    expect(api.getRepairReport).toHaveBeenCalled()
    expect(result.text).toContain('Repository readiness')
    expect(result.text).toContain('field: Repository remote URL (projects.ductum.repositories.ductum.remoteUrl)')
    expect(result.text).toContain('value: (missing)')
    expect(result.text).toContain('action: Add a remote URL through Project Repository settings.')
    expect(result.text).not.toContain('repository_readiness')
    expect(result.text).not.toContain('repository_remote_missing')
  })

  it('renders grouped items from the canonical API contract', async () => {
    const report: RepairReport = {
      ...emptyRepairReport(),
      items: [repairItem('factory:dispatcher-disabled', 'factory_setup', 'Dispatcher is disabled')],
      groups: [{
        area: 'provider_auth',
        label: 'Provider auth',
        blocks: 'Blocks agents whose provider is not authenticated.',
        items: [repairItem('provider:openai:auth:missing', 'provider_auth', 'OpenAI auth is missing')],
      }],
      summary: {
        ...emptyRepairReport().summary,
        total: 1,
        blockers: 1,
        byArea: { ...emptyRepairReport().summary.byArea, provider_auth: 1 },
      },
    }
    const api = createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) })

    const result = await runCommand(['repair', 'list'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Provider auth')
    expect(result.text).toContain('OpenAI auth is missing')
    expect(result.text).not.toContain('Dispatcher is disabled')
    expect(result.text).not.toMatch(/\bRun\b|\bTarget\b|\bResources\b|\bseed\b/i)
  })

  it('redacts secret-bearing repair output in human and JSON modes', async () => {
    const report = secretRepairReport()
    const human = await runCommand([
      'repair',
      'list',
    ], createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) }))
    const json = await runCommand([
      '--json',
      'repair',
      'list',
    ], createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) }))

    for (const text of [human.text, json.text]) {
      expect(text).not.toContain('sk-proj-test-secret')
      expect(text).not.toContain('123456:telegram-secret')
      expect(text).not.toContain('postgres://user:password@example.com/db')
      expect(text).not.toContain('OPENAI_API_KEY=secret')
      expect(text).not.toContain('webhook-secret-value')
      expect(text).toContain('[redacted]')
    }
    expect(json.text).toContain('OPENAI_API_KEY')
  })

  it('shows failed ship attempts in repair recovery output with the exact lifecycle blocker', async () => {
    const failedRun: Run = {
      ...stalledRun,
      id: 'attempt-recovery-github-failed' as Run['id'],
      stage: 'ship',
      terminalState: 'failed',
      failReason: 'GitHub issue lifecycle failed before approval: Repository edictum-ai/ductum is missing GitHub App installation auth. Production writes fail closed.',
    }
    const report: RepairReport = {
      ...emptyRepairReport(),
      items: [repairItem('attempt-recovery:needs-operator', 'attempt_recovery', '1 attempt stopped and needs a decision')],
      groups: [{
        area: 'attempt_recovery',
        label: 'Attempt recovery',
        blocks: 'Blocks tasks whose latest Attempt needs an operator decision.',
        items: [],
      }],
      summary: {
        ...emptyRepairReport().summary,
        total: 1,
        attention: 1,
        byArea: { ...emptyRepairReport().summary.byArea, attempt_recovery: 1 },
      },
    }
    report.groups[0]!.items = report.items
    const api = createMockApi({
      getRepairReport: vi.fn().mockResolvedValue(report),
      listTasks: vi.fn().mockResolvedValue([readyTask, activeTask, stalledTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === stalledTask.id) return [failedRun]
        return []
      }),
    })

    const result = await runCommand(['repair', 'list'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain(`attempt: ${failedRun.id}`)
    expect(result.text).toContain('status: Failed')
    expect(result.text).toContain(failedRun.failReason as string)
    expect(result.text).toContain(`ductum retry ${failedRun.id}`)
  })

  it('expands Attempt recovery items with full IDs, reasons, and safe commands', async () => {
    const firstRun: Run = { ...stalledRun, id: 'attempt-recovery-full-id-aaaaaa' as Run['id'], failReason: 'checkpoint resume unavailable across server restart' }
    const secondTask: Task = { ...stalledTask, id: 'task-second-recovery' as Task['id'], name: 'Second Recovery Task' }
    const secondRun: Run = { ...stalledRun, id: 'attempt-recovery-full-id-bbbbbb' as Run['id'], taskId: secondTask.id, failReason: 'agent process exited during restart reconcile' }
    const report: RepairReport = {
      ...emptyRepairReport(),
      items: [
        repairItem('attempt-recovery:needs-operator', 'attempt_recovery', '2 attempts stopped and need a decision'),
        repairItem('attempt:attempt-recovery-full-id-aaaaaa:linked_commit_without_lineage', 'attempt_recovery', 'Linked commit has no execution lineage'),
      ],
      groups: [{
        area: 'attempt_recovery',
        label: 'Attempt recovery',
        blocks: 'Blocks tasks whose latest Attempt needs an operator decision.',
        items: [],
      }],
      summary: {
        ...emptyRepairReport().summary,
        total: 1,
        attention: 1,
        byArea: { ...emptyRepairReport().summary.byArea, attempt_recovery: 1 },
      },
    }
    report.groups[0]!.items = report.items
    const api = createMockApi({
      getRepairReport: vi.fn().mockResolvedValue(report),
      listTasks: vi.fn().mockResolvedValue([readyTask, activeTask, stalledTask, secondTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === stalledTask.id) return [firstRun]
        if (taskId === secondTask.id) return [secondRun]
        return []
      }),
    })

    const result = await runCommand(['repair', 'list'], api)

    expect(result.code).toBe(0)
    for (const run of [firstRun, secondRun]) {
      expect(result.text).toContain(`attempt: ${run.id}`)
      expect(result.text).toContain(`ductum status ${run.id}`)
      expect(result.text).toContain(`ductum logs ${run.id}`)
      expect(result.text).toContain(`ductum watch ${run.id}`)
      expect(result.text).toContain(`ductum retry ${run.id}`)
      expect(result.text.match(new RegExp(`attempt: ${run.id}`, 'g'))).toHaveLength(1)
    }
    expect(result.text).toContain('project: ductum')
    expect(result.text).toContain('spec: P6')
    expect(result.text).toContain('task: Stalled Task')
    expect(result.text).toContain('task: Second Recovery Task')
    expect(result.text).toContain('checkpoint resume unavailable across server restart')
    expect(result.text).toContain('agent process exited during restart reconcile')
  })
})

function repairItem(id: string, area: RepairReport['items'][number]['area'], title: string): RepairReport['items'][number] {
  return {
    id,
    area,
    severity: 'blocker',
    title,
    reason: `${title}.`,
    suggestedAction: 'Open Factory Settings and fix the selected item.',
    record: { type: 'Provider', id: 'provider:openai', name: 'OpenAI' },
    field: {
      path: 'providers.openai.auth',
      label: 'Provider auth',
      value: '(missing)',
    },
    blocks: 'Blocks agents whose provider is not authenticated.',
    status: 'missing',
    issueCode: null,
    target: null,
    href: null,
    linkLabel: null,
  }
}

function secretRepairReport(): RepairReport {
  const report: RepairReport = {
    ...emptyRepairReport(),
    items: [{
      id: 'telegram:webhookSecret:invalid',
      area: 'migration',
      severity: 'blocker',
      title: 'Telegram webhook secret is unsafe',
      reason: 'Saw OPENAI_API_KEY=secret and postgres://user:password@example.com/db',
      suggestedAction: 'Replace bot token 123456:telegram-secret',
      record: { type: 'NotificationChannel', id: 'ops', name: 'ops' },
      field: {
        path: 'notificationChannels.ops.config.webhookSecret',
        label: 'Webhook secret',
        value: 'webhook-secret-value',
      },
      blocks: 'Blocks Telegram approvals.',
      status: 'missing',
      issueCode: 'telegram_webhook_secret_invalid',
      target: null,
      href: null,
      linkLabel: null,
    }, {
      id: 'provider:openai:token:invalid',
      area: 'provider_auth',
      severity: 'blocker',
      title: 'OpenAI token is unsafe',
      reason: 'Configured value sk-proj-test-secret is literal',
      suggestedAction: 'Use env var OPENAI_API_KEY',
      record: { type: 'ProviderAuth', id: 'openai', name: 'OpenAI' },
      field: {
        path: 'providers.openai.auth',
        label: 'Provider auth',
        value: 'sk-proj-test-secret',
      },
      blocks: 'Blocks provider auth.',
      status: 'missing',
      issueCode: 'provider_auth_invalid',
      target: null,
      href: null,
      linkLabel: null,
    }],
    groups: [{
      area: 'migration',
      label: 'Migration',
      blocks: 'Blocks Telegram approvals.',
      items: [],
    }],
    summary: {
      ...emptyRepairReport().summary,
      total: 2,
      blockers: 2,
      byArea: { ...emptyRepairReport().summary.byArea, migration: 1, provider_auth: 1 },
    },
  }
  report.groups[0]!.items = report.items
  return report
}
