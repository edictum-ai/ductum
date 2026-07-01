import { describe, expect, it, vi } from 'vitest'
import type { RepairReport } from '@ductum/core'

import { createMockApi, emptyRepairReport, runCommand } from './helpers.js'

describe('ductum doctor command', () => {
  it('emits a schema envelope by default in non-TTY mode', async () => {
    const result = await runCommand(['doctor'])
    const payload = JSON.parse(result.text) as {
      kind?: string
      data?: { status?: string }
    }

    expect(result.code).toBe(0)
    expect(payload.kind).toBe('doctor.report')
    expect(payload.data?.status).toBe('clear')
  })

  it('reports clear status when the repair engine finds no issues', async () => {
    const api = createMockApi({ getRepairReport: vi.fn().mockResolvedValue(emptyRepairReport()) })

    const result = await runCommand(['--human', 'doctor'], api)

    expect(result.code).toBe(0)
    expect(api.getRepairReport).toHaveBeenCalled()
    expect(result.text).toContain('Doctor')
    expect(result.text).toContain('status: clear')
    expect(result.text).toContain('No setup, readiness, or Attempt recovery items found.')
    expect(result.text).not.toContain('next: ductum repair')
  })

  it('reports blocked status with exact suggested action and repair handoff', async () => {
    const report = repairReport({
      blockers: 1,
      attention: 0,
      item: {
        title: 'Provider auth is missing',
        reason: 'OpenAI provider has no usable credential.',
        suggestedAction: 'Open Factory Settings and add an OpenAI secret.',
      },
    })
    const api = createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) })

    const result = await runCommand(['--human', 'doctor'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('status: blocked')
    expect(result.text).toContain('Provider auth is missing')
    expect(result.text).toContain('reason: OpenAI provider has no usable credential.')
    expect(result.text).toContain('action: Open Factory Settings and add an OpenAI secret.')
    expect(result.text).toContain('next: ductum repair')
  })

  it('renders a failing local app repair item without collapsing it into clear output', async () => {
    const report = repairReport({
      blockers: 1,
      attention: 0,
      item: {
        title: 'Local app port is not reachable',
        reason: 'Local app health check timed out after 500ms.',
        suggestedAction: 'Start Ductum on a reachable local port, or choose a different port.',
      },
    })
    const api = createMockApi({ getRepairReport: vi.fn().mockResolvedValue(report) })

    const result = await runCommand(['--human', 'doctor'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('status: blocked')
    expect(result.text).toContain('Local app port is not reachable')
    expect(result.text).toContain('Local app health check timed out after 500ms.')
  })

  it('uses attention status as a non-zero JSON smoke gate', async () => {
    const report = repairReport({
      blockers: 0,
      attention: 1,
      item: {
        title: 'Attempt needs operator action',
        reason: 'Checkpoint resume needs an operator decision.',
        suggestedAction: 'Inspect the Attempt and retry or cancel it.',
      },
    })

    const result = await runCommand(['--json', 'doctor'], createMockApi({
      getRepairReport: vi.fn().mockResolvedValue(report),
    }))
    const json = JSON.parse(result.text) as { kind?: string; data?: { status?: string; summary?: { attention?: number } } }

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('doctor status: attention')
    expect(json.kind).toBe('doctor.report')
    expect(json.data?.status).toBe('attention')
    expect(json.data?.summary?.attention).toBe(1)
  })

  it('uses blocked status as a stronger non-zero JSON smoke gate', async () => {
    const report = repairReport({
      blockers: 1,
      attention: 0,
      item: {
        title: 'Provider auth is missing',
        reason: 'OpenAI provider has no usable credential.',
        suggestedAction: 'Open Factory Settings and add an OpenAI secret.',
      },
    })

    const result = await runCommand(['--json', 'doctor'], createMockApi({
      getRepairReport: vi.fn().mockResolvedValue(report),
    }))
    const json = JSON.parse(result.text) as { kind?: string; data?: { status?: string; summary?: { blockers?: number } } }

    expect(result.code).toBe(2)
    expect(result.errorText).toContain('doctor status: blocked')
    expect(json.kind).toBe('doctor.report')
    expect(json.data?.status).toBe('blocked')
    expect(json.data?.summary?.blockers).toBe(1)
  })
})

function repairReport(input: {
  blockers: number
  attention: number
  item: { title: string; reason: string; suggestedAction: string }
}): RepairReport {
  const item: RepairReport['items'][number] = {
    id: 'provider:openai:auth:missing',
    area: 'provider_auth',
    severity: input.blockers > 0 ? 'blocker' : 'attention',
    title: input.item.title,
    reason: input.item.reason,
    suggestedAction: input.item.suggestedAction,
    record: { type: 'Provider', id: 'provider:openai', name: 'OpenAI' },
    field: { path: 'providers.openai.auth', label: 'Provider auth', value: '(missing)' },
    blocks: 'Blocks agents whose provider is not authenticated.',
    status: 'missing',
    issueCode: null,
    target: null,
    href: null,
    linkLabel: null,
  }
  return {
    ...emptyRepairReport(),
    items: [item],
    groups: [{
      area: 'provider_auth',
      label: 'Provider auth',
      blocks: 'Blocks agents whose provider is not authenticated.',
      items: [item],
    }],
    summary: {
      ...emptyRepairReport().summary,
      total: 1,
      blockers: input.blockers,
      attention: input.attention,
      byArea: { ...emptyRepairReport().summary.byArea, provider_auth: 1 },
    },
  }
}
