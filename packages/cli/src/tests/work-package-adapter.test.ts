import { describe, expect, it } from 'vitest'

import {
  PublicContractError,
  type WorkPackage,
} from '@ductum/core'
import {
  adaptSpecIntakeToImportedSpec,
  adaptWorkPackageToImportedSpec,
} from '../work-package-adapter.js'

const qratumGeneratorInput = {
  schemaVersion: 'ductum.spec-intake.v1',
  project: { name: 'Qratum' },
  spec: {
    name: 'generator-contract',
    status: 'approved',
    document: 'Generated from Qratum planning output.',
  },
  repositories: [
    {
      name: 'qratum',
      components: [
        {
          name: 'specs',
          path: 'specs',
          tasks: [
            {
              name: 'write-contract',
              prompt: 'Write the public contract.',
              verification: ['pnpm test'],
              requiredRole: 'builder',
            },
          ],
        },
      ],
    },
  ],
} satisfies WorkPackage

const workPackageCannotIncludeAttempts = {
  schemaVersion: 'ductum.spec-intake.v1',
  project: { name: 'Qratum' },
  spec: { name: 'bad-generator-output' },
  repositories: [],
  // @ts-expect-error WorkPackage stops at Task; Attempts are runtime records.
  attempts: [{ id: 'run_1' }],
} satisfies WorkPackage
void workPackageCannotIncludeAttempts

describe('WorkPackage compatibility adapter', () => {
  it('accepts Qratum/generator input as WorkPackage instead of legacy task YAML', () => {
    expect('tasks' in qratumGeneratorInput).toBe(false)
    expect(qratumGeneratorInput.repositories[0]?.components?.[0]?.tasks?.[0]?.name).toBe('write-contract')
  })

  it('maps WorkPackage to the existing legacy spec import shape', () => {
    const imported = adaptWorkPackageToImportedSpec(qratumGeneratorInput)
    expect(imported).toEqual({
      project: 'Qratum',
      spec: {
        name: 'generator-contract',
        status: 'approved',
        document: 'Generated from Qratum planning output.',
      },
      tasks: [
        {
          name: 'write-contract',
          prompt: 'Write the public contract.',
          repos: ['qratum'],
          verification: ['pnpm test'],
          dependsOn: [],
          repository: 'qratum',
          component: 'specs',
          assignedAgent: undefined,
          complexity: undefined,
          requiredRole: 'builder',
          status: undefined,
        },
      ],
    })
  })

  it('rejects generated Attempts with an exact field path', () => {
    const invalid = {
      ...qratumGeneratorInput,
      repositories: [
        {
          name: 'qratum',
          components: [{ name: 'specs', attempts: [{ id: 'run_1' }] }],
        },
      ],
    }

    expect(() => adaptSpecIntakeToImportedSpec(invalid as WorkPackage)).toThrow(PublicContractError)
    try {
      adaptSpecIntakeToImportedSpec(invalid as WorkPackage)
    } catch (error) {
      const contractError = error as PublicContractError
      expect(contractError.issues[0]).toMatchObject({
        recordType: 'SpecIntake',
        fieldPath: 'repositories[0].components[0].attempts',
        humanLabel: 'Attempts',
      })
    }
  })

  it('reports missing dependencies with exact task field paths', () => {
    const invalid = {
      ...qratumGeneratorInput,
      repositories: [{
        name: 'qratum',
        tasks: [{
          name: 'write-contract',
          prompt: 'Write it.',
          dependsOn: ['missing-task'],
        }],
      }],
    } satisfies WorkPackage

    expect(() => adaptWorkPackageToImportedSpec(invalid)).toThrow(PublicContractError)
    try {
      adaptWorkPackageToImportedSpec(invalid)
    } catch (error) {
      const contractError = error as PublicContractError
      expect(contractError.issues[0]).toMatchObject({
        recordType: 'Task',
        recordName: 'write-contract',
        fieldPath: 'repositories[0].tasks[0].dependsOn[0]',
        humanLabel: 'Task dependency',
        invalidValue: 'missing-task',
        missingDependency: { recordType: 'Task', idOrName: 'missing-task' },
      })
    }
  })
})
