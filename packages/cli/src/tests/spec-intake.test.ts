import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createMockApi, readyTask, runCommand, spec } from './helpers.js'

describe('spec intake command', () => {
  it('blocks import when the contract gate is incomplete', async () => {
    const { dir, yamlPath } = await writeYamlSpec({ specDocument: '' })
    const api = createMockApi({ createSpec: vi.fn() })
    try {
      const result = await runCommand(['spec', 'intake', 'ductum', yamlPath, '--import'], api)

      expect(result.code).toBe(1)
      expect(result.text).toContain('Blocked: contract incomplete; task import not run.')
      expect(result.text).toContain('ductum spec intake ductum')
      expect(result.text).toContain('--waive-contract')
      expect(result.errorText).toContain('contract is incomplete')
      expect(api.createSpec).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps JSON output parseable when the contract gate blocks import', async () => {
    const { dir, yamlPath } = await writeYamlSpec({ specDocument: '' })
    const api = createMockApi({ createSpec: vi.fn() })
    try {
      const result = await runCommand(['--json', 'spec', 'intake', 'ductum', yamlPath, '--import'], api)
      const payload = JSON.parse(result.stdout)

      expect(result.code).toBe(1)
      expect(payload.blocked).toBe(true)
      expect(payload.contract.incomplete).toBe(true)
      expect(payload.nextCommands).toEqual(expect.arrayContaining([
        expect.stringContaining('--waive-contract'),
      ]))
      expect(result.stdout).not.toContain('Warning:')
      expect(result.errorText).toContain('Warning:')
      expect(api.createSpec).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('imports a clean file-backed spec when requested', async () => {
    const { dir, yamlPath } = await writeYamlSpec({ specDocument: completePrompt('Spec behavior') })
    const importedSpec = { ...spec, id: 'spec-intake' as typeof spec.id, name: 'intake-clean' }
    const importedTask = { ...readyTask, id: 'task-intake' as typeof readyTask.id, specId: importedSpec.id, name: 'P1' }
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue(importedSpec),
      createTask: vi.fn().mockResolvedValue(importedTask),
      listTasks: vi.fn().mockResolvedValue([importedTask]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: [importedTask.id] }),
    })
    try {
      const result = await runCommand(['spec', 'intake', 'ductum', yamlPath, '--import'], api)

      expect(result.code).toBe(0)
      expect(result.text).toContain('Spec intake complete')
      expect(result.text).toContain('contract: complete')
      expect(result.text).toContain('tasks: 1')
      expect(result.text).toContain('ductum task dag intake-clean --project ductum')
      expect(api.createSpec).toHaveBeenCalled()
      expect(api.createTask).toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('imports only with an explicit waiver when the contract is incomplete', async () => {
    const { dir, yamlPath } = await writeYamlSpec({ specDocument: '' })
    const importedSpec = { ...spec, id: 'spec-waived' as typeof spec.id, name: 'intake-clean' }
    const importedTask = { ...readyTask, id: 'task-waived' as typeof readyTask.id, specId: importedSpec.id, name: 'P1' }
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue(importedSpec),
      createTask: vi.fn().mockResolvedValue(importedTask),
      listTasks: vi.fn().mockResolvedValue([importedTask]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: [importedTask.id] }),
    })
    try {
      const result = await runCommand(['spec', 'intake', 'ductum', yamlPath, '--import', '--waive-contract'], api)

      expect(result.code).toBe(0)
      expect(result.text).toContain('contract: incomplete (waived)')
      expect(result.text).toContain('tasks: 1')
      expect(api.createSpec).toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('prints a waiver-preserving import command when auditing without import', async () => {
    const { dir, yamlPath } = await writeYamlSpec({ specDocument: '' })
    try {
      const result = await runCommand(['spec', 'intake', 'ductum', yamlPath, '--waive-contract'])

      expect(result.code).toBe(0)
      expect(result.text).toContain('Ready: contract incomplete but waiver supplied; import was not requested.')
      expect(result.text).toContain('--import --waive-contract')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

async function writeYamlSpec(input: { specDocument: string }) {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-spec-intake-'))
  const yamlPath = join(dir, 'spec.yaml')
  await writeFile(yamlPath, [
    'project: ductum',
    'spec:',
    '  name: intake-clean',
    ...(input.specDocument === ''
      ? []
      : [
        '  document: |',
        ...input.specDocument.split('\n').map((line) => `    ${line}`),
      ]),
    'tasks:',
    '  - name: P1',
    '    prompt: |',
    ...completePrompt('Task behavior').split('\n').map((line) => `      ${line}`),
  ].join('\n'))
  return { dir, yamlPath }
}

function completePrompt(label: string): string {
  return [
    '## Decision Trace',
    '- Decisions: `059`, `060`.',
    '',
    '## Behavior Contract',
    '',
    `- Missing ${label} evidence must fail loudly in CLI output.`,
    '- Every runtime behavior claim must have behavioral tests or recorded evidence.',
    '',
    '## Verification',
    '- pnpm test',
    '',
    '## Drift handling',
    '- Record a decision before changing scope.',
    '',
    '## Slop Review',
    '- Did every Behavior Contract item get tested or evidenced?',
    '- Are missing or invalid inputs loud failures?',
  ].join('\n')
}
