import { describe, expect, it, vi } from 'vitest'

import type { Decision, Spec, Task } from '@ductum/core'
import { applyImportedSpec } from '../import-handler.js'
import { extractDecisionTrace, extractDecisionTraceItems } from '../spec-import-decisions.js'
import { createMockApi, project, spec } from './helpers.js'

describe('spec import decision trace recording', () => {
  it('extracts section and inline Decision Trace text', () => {
    expect(extractDecisionTrace('## Decision Trace\n- Decisions: 060\n\n## Next')).toBe('- Decisions: 060')
    expect(extractDecisionTrace('Decision Trace: 053, 060\nDo work.')).toBe('Decision Trace: 053, 060')
    expect(extractDecisionTrace('# No trace')).toBeNull()
  })

  it('extracts labeled decision trace items and preserves unlabeled traces as evidence', () => {
    expect(extractDecisionTraceItems([
      '## Decision Trace',
      '- Decisions: 059, 060, 108',
      '- Allowed scope: keep spec import rows operator-readable',
      '  without a new table.',
      '- Drift handling: record a decision before widening scope.',
      '',
      '## Next',
    ].join('\n'))).toEqual([
      { label: 'Decisions', context: '059, 060, 108' },
      { label: 'Allowed scope', context: 'keep spec import rows operator-readable without a new table.' },
      { label: 'Drift handling', context: 'record a decision before widening scope.' },
    ])
    expect(extractDecisionTraceItems('## Decision Trace\nThis trace is weird but still evidence.\n')).toEqual([
      { label: 'Trace', context: 'This trace is weird but still evidence.' },
    ])
  })

  it('records spec and task decision traces through the API', async () => {
    const createdTasks: Task[] = []
    const createDecision = vi.fn().mockImplementation(async (input) => ({
      id: `decision-${createDecision.mock.calls.length}` as Decision['id'],
      runId: null,
      supersedesId: null,
      createdAt: '2026-04-30T00:00:00Z',
      ...input,
    }))
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue({
        ...spec,
        id: 'spec-import' as Spec['id'],
        name: 'decision-import',
      }),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        const task = {
          id: `task-${createdTasks.length + 1}` as Task['id'],
          specId: 'spec-import' as Spec['id'],
          targetId: null,
          assignedAgentId: null,
          requiredRole: null,
          complexity: null,
          status: 'pending' as const,
          retryCount: 0,
          retryAfter: null,
          budgetExtraUsd: 0,
          turnExtraCount: 0,
          createdAt: '2026-04-30T00:00:00Z',
          updatedAt: '2026-04-30T00:00:00Z',
          verification: [],
          repos: [],
          ...input,
        } as Task
        createdTasks.push(task)
        return task
      }),
      listTasks: vi.fn().mockResolvedValue(createdTasks),
      listDecisions: vi.fn().mockResolvedValue([]),
      createDecision,
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['task-1'] }),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
    })

    await applyImportedSpec(api, {
      project: project.name,
      spec: {
        name: 'decision-import',
        document: [
          '## Decision Trace',
          '- Decisions: 053, 060',
          '- Non-goals: no second policy engine.',
          '- Allowed scope: import rows only.',
          '',
        ].join('\n'),
      },
      tasks: [{
        name: 'task-one',
        prompt: 'Decision Trace: 066\nDo work.',
        repos: [],
        verification: [],
        dependsOn: [],
      }],
    })

    expect(createDecision).toHaveBeenCalledTimes(4)
    expect(createDecision).toHaveBeenCalledWith(expect.objectContaining({
      specId: 'spec-import',
      decision: 'Imported Spec Decision Trace: decision-import / Decisions',
      context: '053, 060',
      alternatives: ['decisions/053', 'decisions/060'],
      decidedBy: 'ductum-spec-import',
    }))
    expect(createDecision).toHaveBeenCalledWith(expect.objectContaining({
      specId: 'spec-import',
      decision: 'Imported Spec Decision Trace: decision-import / Non-goals',
      context: 'no second policy engine.',
      alternatives: ['decisions/053', 'decisions/060'],
      decidedBy: 'ductum-spec-import',
    }))
    expect(createDecision).toHaveBeenCalledWith(expect.objectContaining({
      specId: 'spec-import',
      decision: 'Imported Spec Decision Trace: decision-import / Allowed scope',
      context: 'import rows only.',
      alternatives: ['decisions/053', 'decisions/060'],
      decidedBy: 'ductum-spec-import',
    }))
    expect(createDecision.mock.calls[0]?.[0]).not.toHaveProperty('taskId')
    expect(createDecision).toHaveBeenCalledWith(expect.objectContaining({
      specId: 'spec-import',
      taskId: 'task-1',
      decision: 'Imported Task Decision Trace: task-one / Decisions',
      context: '066',
      alternatives: ['decisions/066'],
    }))
  })

  it('does not duplicate existing trace decisions when a spec already has tasks', async () => {
    const createDecision = vi.fn()
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([spec]),
      listTasks: vi.fn().mockResolvedValue([{
        ...({} as Task),
        id: 'task-existing' as Task['id'],
        name: 'task-existing',
      }]),
      listDecisions: vi.fn().mockResolvedValue([{
        id: 'decision-existing' as Decision['id'],
        specId: spec.id,
        taskId: null,
        runId: null,
        decision: 'Imported Spec Decision Trace: P6 / Decisions',
        context: '060',
        alternatives: ['decisions/060'],
        decidedBy: 'ductum-spec-import',
        supersedesId: null,
        createdAt: '2026-04-30T00:00:00Z',
      }]),
      createDecision,
    })

    const result = await applyImportedSpec(api, {
      project: project.name,
      spec: { name: spec.name, document: '## Decision Trace\n- Decisions: 060' },
      tasks: [{
        name: 'task-existing',
        prompt: 'Decision Trace: 060',
        repos: [],
        verification: [],
        dependsOn: [],
      }],
    })

    expect(result.skipped).toBe(true)
    expect(createDecision).toHaveBeenCalledTimes(1)
    expect(createDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'Imported Task Decision Trace: task-existing / Decisions',
      taskId: 'task-existing',
      context: '060',
    }))
  })
})
