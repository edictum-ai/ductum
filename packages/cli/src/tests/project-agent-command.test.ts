import { describe, expect, it } from 'vitest'

import { agent, assignment, createMockApi, project, runCommand } from './helpers.js'

describe('ductum project agent', () => {
  it('lists assignments for a project by name', async () => {
    const api = createMockApi()
    const result = await runCommand(['project', 'agent', 'list', project.name], api)

    expect(result.code).toBe(0)
    expect(api.listProjectAgents).toHaveBeenCalledWith(project.id)
    expect(result.text).toContain(agent.name)
    expect(result.text).toContain(assignment.role)
  })

  it('assigns an agent with a default role of builder', async () => {
    const api = createMockApi()
    const result = await runCommand(
      ['project', 'agent', 'assign', project.name, agent.name],
      api,
    )

    expect(result.code).toBe(0)
    expect(api.assignProjectAgent).toHaveBeenCalledWith(project.id, agent.id, 'builder')
    expect(result.text).toContain(`Assigned ${agent.name} to ${project.name} as builder`)
  })

  it('honors --role on assign', async () => {
    const api = createMockApi()
    const result = await runCommand(
      ['project', 'agent', 'assign', project.name, agent.name, '--role', 'reviewer'],
      api,
    )

    expect(result.code).toBe(0)
    expect(api.assignProjectAgent).toHaveBeenCalledWith(project.id, agent.id, 'reviewer')
  })

  it('unassigns without a role (removes all)', async () => {
    const api = createMockApi()
    const result = await runCommand(
      ['project', 'agent', 'unassign', project.name, agent.name],
      api,
    )

    expect(result.code).toBe(0)
    expect(api.unassignProjectAgent).toHaveBeenCalledWith(project.id, agent.id, undefined)
    expect(result.text).toContain(`Unassigned ${agent.name}`)
  })

  it('unassigns a specific role', async () => {
    const api = createMockApi()
    const result = await runCommand(
      ['project', 'agent', 'unassign', project.name, agent.name, '--role', 'docs'],
      api,
    )

    expect(result.code).toBe(0)
    expect(api.unassignProjectAgent).toHaveBeenCalledWith(project.id, agent.id, 'docs')
    expect(result.text).toContain('docs')
  })

  it('shows up in --help output', async () => {
    const api = createMockApi()
    const result = await runCommand(['project', '--help'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('agent')
  })
})
