import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Agent, ProjectAgent, Spec, Task } from '@/api/client'
import { ReadyTaskQueue } from '@/components/project/ReadyTaskQueue'
import { renderWithProviders } from './test-utils'

const now = '2026-06-15T12:00:00.000Z'

function spec(overrides: Partial<Spec> = {}): Spec {
  return {
    id: 'spec-webhook',
    projectId: 'project1',
    name: 'issue-219-webhook-split',
    status: 'approved',
    document: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-fallback',
    specId: 'spec-webhook',
    name: '[redacted]',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function agent(
  id: string,
  name: string,
  model: string,
  capabilities: string[] = ['build'],
): Agent {
  return {
    id,
    name,
    model,
    harness: 'codex-sdk',
    capabilities,
    costTier: 80,
    spawnConfig: {},
    createdAt: now,
  }
}

function projectAgent(role: 'builder' | 'reviewer', agentId: string): ProjectAgent {
  return { projectId: 'project1', agentId, role }
}

describe('ReadyTaskQueue safe labels', () => {
  it('uses prompt-derived impl labels instead of IMPL task <id> when stored names are redacted', () => {
    const tasks = [
      task({ id: 'task-098bgx-generated', prompt: '# P1: Webhook notification backend/runtime\n\nBuild the delivery loop.' }),
      task({ id: 'task-woneYj-generated', prompt: '# P2: Webhook retry policy\n\nBackoff behavior.' }),
      task({ id: 'task-hH8TG2-generated', prompt: '# P3: Webhook signature verification\n\nVerify signatures.' }),
    ]
    renderWithProviders(
      <ReadyTaskQueue
        projectName="ductum"
        tasks={tasks}
        specs={[spec()]}
        agents={[agent('agent-1', 'codex', 'gpt-5.4')]}
        projectAgents={[projectAgent('builder', 'agent-1')]}
      />,
      { route: '/ductum' },
    )

    expect(screen.getAllByText('P1: Webhook notification backend/runtime').length).toBeGreaterThan(0)
    expect(screen.getAllByText('P2: Webhook retry policy').length).toBeGreaterThan(0)
    expect(screen.getAllByText('P3: Webhook signature verification').length).toBeGreaterThan(0)
    expect(screen.queryByText(/IMPL task/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
  })

  it('preserves review/fix role context while deriving safe labels from prompt headings', () => {
    const reviewPrompt = [
      '## Review Task',
      '',
      '### Original Task',
      '# P1: Webhook notification backend/runtime',
      '',
      '### Diff',
      '```diff',
      'diff with [redacted] context',
      '```',
    ].join('\n')
    const fixPrompt = [
      '## Fix Task (Review Round 1)',
      '',
      '### Original Task',
      '# P1: Webhook notification backend/runtime',
      '',
      '### Review Feedback',
      'Whitespace broke around [redacted] context.',
    ].join('\n')
    const tasks = [
      task({ id: 'task-review-prompt-backed', requiredRole: 'reviewer', prompt: reviewPrompt }),
      task({ id: 'task-fix-prompt-backed', requiredRole: 'builder', prompt: fixPrompt }),
    ]
    renderWithProviders(
      <ReadyTaskQueue
        projectName="ductum"
        tasks={tasks}
        specs={[spec()]}
        agents={[
          agent('agent-1', 'codex', 'gpt-5.4', ['build']),
          agent('agent-2', 'claude', 'opus-4', ['review']),
        ]}
        projectAgents={[projectAgent('builder', 'agent-1'), projectAgent('reviewer', 'agent-2')]}
      />,
      { route: '/ductum' },
    )

    expect(screen.getAllByText('Review: Webhook notification backend/runtime').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fix: Webhook notification backend/runtime').length).toBeGreaterThan(0)
    expect(screen.queryByText(/## Review Task|## Fix Task|Original Task|\[redacted\]/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/IMPL task/)).not.toBeInTheDocument()
  })

  it('falls back to the id-backed label when the prompt is empty', () => {
    // shortId('task-empty-prompt') === 'task-e' — see display.ts.
    const tasks = [task({ id: 'task-empty-prompt', prompt: '   \n\t\n' })]
    renderWithProviders(
      <ReadyTaskQueue
        projectName="ductum"
        tasks={tasks}
        specs={[spec()]}
        agents={[agent('agent-1', 'codex', 'gpt-5.4')]}
        projectAgents={[projectAgent('builder', 'agent-1')]}
      />,
      { route: '/ductum' },
    )

    // getByText throws when more than one node matches, so this pins both
    // the label text and that only one card carries it.
    expect(screen.getByText('IMPL task task-e')).toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
    expect(screen.queryByText(/IMPL task task-r/)).not.toBeInTheDocument()
  })

  it('falls back to a distinct id-backed label when the prompt heading is redacted', () => {
    // shortId('task-redacted-heading') === 'task-r' — distinct from task-e above.
    const tasks = [task({ id: 'task-redacted-heading', prompt: '# [redacted]\n\nbody' })]
    renderWithProviders(
      <ReadyTaskQueue
        projectName="ductum"
        tasks={tasks}
        specs={[spec()]}
        agents={[agent('agent-1', 'codex', 'gpt-5.4')]}
        projectAgents={[projectAgent('builder', 'agent-1')]}
      />,
      { route: '/ductum' },
    )

    expect(screen.getByText('IMPL task task-r')).toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
    expect(screen.queryByText(/IMPL task task-e/)).not.toBeInTheDocument()
  })
})
