import type { Agent, Project, ProjectAgent, Spec } from '@ductum/core'

import type { DuctumApi } from '../api-client.js'

export function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

export function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

export function formatRunCost(run: {
  costUsd: number
  tokensIn: number
  tokensOut: number
  stage: string
  terminalState: string | null
  ui?: { cost?: { label: string } }
}) {
  if (run.ui?.cost?.label != null) return run.ui.cost.label
  if (run.costUsd > 0) return formatCurrency(run.costUsd)
  if (run.tokensIn > 0 || run.tokensOut > 0) return '<$0.01'
  if (run.terminalState == null && run.stage !== 'done') return 'pending'
  return 'unmeasured'
}

export function renderSections(...sections: Array<string | null | undefined>) {
  return sections.filter((section): section is string => section != null && section !== '').join('\n\n')
}

export function titleLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function formatReason(reason: string | null | undefined): string {
  if (reason == null || reason.trim() === '') return ''
  const [code, ...detailParts] = reason.split(':')
  const detail = detailParts.join(':').trim()
  const label = titleLabel(code ?? reason)
  return detail === '' ? label : `${label}: ${detail}`
}

export function displayName<T extends { id: string; name: string }>(
  items: T[],
  id: string | null | undefined,
  fallback = '-',
) {
  if (id == null) {
    return fallback
  }
  return items.find((item) => item.id === id)?.name ?? id
}

export async function requireProjectByName(api: DuctumApi, name: string) {
  const project = (await api.listProjects()).find((item) => item.name === name)
  if (project == null) {
    throw new Error(`Project not found: ${name}`)
  }
  return project
}

export async function requireAgentByName(api: DuctumApi, name: string) {
  const agent = (await api.listAgents()).find((item) => item.name === name)
  if (agent == null) {
    throw new Error(`Agent not found: ${name}`)
  }
  return agent
}

export async function requireSpecByNameOrId(api: DuctumApi, specRef: string, projectName?: string) {
  if (projectName != null) {
    const project = await requireProjectByName(api, projectName)
    const spec = (await api.listSpecs(project.id)).find((item) => item.id === specRef || item.name === specRef)
    if (spec == null) {
      throw new Error(`Spec not found in project ${projectName}: ${specRef}`)
    }
    return spec
  }

  const projects = await api.listProjects()
  const matches: Array<{ project: Project; spec: Spec }> = []
  const specsByProject = new Map<Project['id'], Spec[]>()
  for (const project of projects) {
    const specs = await api.listSpecs(project.id)
    specsByProject.set(project.id, specs)
    for (const spec of specs) {
      if (spec.id === specRef || spec.name === specRef) {
        matches.push({ project, spec })
      }
    }
  }

  const idMatch = matches.find((item) => item.spec.id === specRef)
  if (idMatch != null) {
    return idMatch.spec
  }
  if (matches.length === 0) {
    const projectHint = projects.find((project) => project.name === specRef || project.id === specRef)
    if (projectHint != null) {
      const specs = specsByProject.get(projectHint.id) ?? []
      const specNames = specs.length === 0
        ? 'No specs are imported for that Project.'
        : `Available specs: ${specs.map((spec) => `${spec.name} [${spec.id}]`).join(', ')}.`
      throw new Error(
        `Spec not found: ${specRef}. "${specRef}" is a Project, not a Spec. Run \`ductum spec list ${projectHint.name}\`, then \`ductum task list <spec-id-or-name> --project ${projectHint.name}\`.\n${specNames}`,
      )
    }
    throw new Error(`Spec not found: ${specRef}`)
  }
  if (matches.length > 1) {
    const choices = matches.map(({ project, spec }) => `  ${project.name}/${spec.name} [${spec.id}]`)
    throw new Error(
      `Ambiguous spec "${specRef}" — found ${matches.length} matches. Use --project <name>:\n${choices.join('\n')}`,
    )
  }
  const match = matches[0]
  if (match == null) {
    throw new Error(`Spec not found: ${specRef}`)
  }
  return match.spec
}

export async function loadAssignments(api: DuctumApi, projects: Project[]) {
  const pairs = await Promise.all(
    projects.map(async (project) => [project.id, await api.listProjectAgents(project.id)] as const),
  )
  return new Map<string, ProjectAgent[]>(pairs)
}

export function formatAssignments(
  assignments: ProjectAgent[],
  projects: Project[],
  agents: Agent[],
) {
  return assignments.map((assignment) => ({
    project: projects.find((project) => project.id === assignment.projectId)?.name ?? assignment.projectId,
    agent: agents.find((agent) => agent.id === assignment.agentId)?.name ?? assignment.agentId,
    role: assignment.role,
  }))
}

export function parseEnv(values: string[]) {
  return Object.fromEntries(
    values.map((entry) => {
      const index = entry.indexOf('=')
      if (index <= 0) {
        throw new Error(`Invalid env entry: ${entry}`)
      }
      return [entry.slice(0, index), entry.slice(index + 1)]
    }),
  )
}
