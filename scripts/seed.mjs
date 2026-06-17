#!/usr/bin/env node

/**
 * Seed script — bootstraps a Ductum factory with agents, a project, and sample tasks.
 *
 * Usage:
 *   pnpm seed                          # uses default API at localhost:4100
 *   DUCTUM_API_URL=http://... pnpm seed  # custom API URL
 *
 * Requires the API server to be running.
 */

const API = process.env.DUCTUM_API_URL || 'http://localhost:4100'

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function put(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PUT ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function get(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GET ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function main() {
  console.log(`Seeding Ductum at ${API}...\n`)

  // Check API is reachable
  try {
    await get('/api/health')
  } catch {
    console.error('API not reachable. Start it first: pnpm dev:api')
    process.exit(1)
  }

  // 1. Initialize factory (PUT is upsert — creates or updates)
  const factory = await put('/api/factory', {
    name: 'Sample Factory',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  console.log(`Factory: ${factory.name} (${factory.id})`)

  // 2. Register agents
  const agents = [
    {
      name: 'mimi',
      model: 'claude-opus-4.6',
      harness: 'claude-agent-sdk',
      capabilities: ['build', 'test', 'fix'],
    },
    {
      name: 'codex',
      model: 'gpt-5.4',
      harness: 'opencode',
      capabilities: ['build', 'review', 'fix'],
    },
    {
      name: 'glm',
      model: 'glm-5.1',
      harness: 'opencode',
      capabilities: ['docs', 'quick-fix'],
    },
  ]

  const registeredAgents = {}
  for (const agentDef of agents) {
    const existing = await get('/api/agents')
    const found = existing.find((a) => a.name === agentDef.name)
    if (found) {
      registeredAgents[agentDef.name] = found
      console.log(`Agent exists: ${agentDef.name} (${found.id})`)
    } else {
      const agent = await post('/api/agents', agentDef)
      registeredAgents[agentDef.name] = agent
      console.log(`Agent registered: ${agentDef.name} (${agent.id})`)
    }
  }

  // 3. Create project
  const existingProjects = await get('/api/projects')
  let project = existingProjects.find((p) => p.name === 'edictum')
  if (!project) {
    project = await post('/api/projects', {
      factoryId: factory.id,
      name: 'edictum',
      repos: ['edictum-ai/edictum', 'edictum-ai/edictum-ts', 'edictum-ai/edictum-go'],
      config: { mergeMode: 'human', workflowPath: 'workflows/coding-guard.yaml' },
    })
    console.log(`Project created: ${project.name} (${project.id})`)
  } else {
    console.log(`Project exists: ${project.name} (${project.id})`)
  }

  // 4. Assign agents to project
  const assignments = [
    { agentName: 'mimi', role: 'builder' },
    { agentName: 'codex', role: 'reviewer' },
    { agentName: 'glm', role: 'docs' },
  ]

  for (const { agentName, role } of assignments) {
    const agent = registeredAgents[agentName]
    try {
      await post(`/api/projects/${project.id}/agents`, {
        agentId: agent.id,
        role,
      })
      console.log(`Assigned ${agentName} as ${role} on ${project.name}`)
    } catch (e) {
      // Already assigned
      console.log(`${agentName} already assigned to ${project.name}`)
    }
  }

  // 5. Create a sample spec
  const specs = await get(`/api/projects/${project.id}/specs`)
  let spec = specs.find((s) => s.name === 'sample-feature')
  if (!spec) {
    spec = await post(`/api/projects/${project.id}/specs`, {
      name: 'sample-feature',
      status: 'approved',
      document: '# Sample Feature\n\nAdd a --verbose flag to the CLI that prints debug output.',
    })
    console.log(`Spec created: ${spec.name} (${spec.id})`)
  } else {
    console.log(`Spec exists: ${spec.name} (${spec.id})`)
  }

  // 6. Create sample tasks with dependencies
  const existingTasks = await get(`/api/specs/${spec.id}/tasks`)
  if (existingTasks.length > 0) {
    console.log(`Tasks already exist for spec ${spec.name} (${existingTasks.length} tasks)`)
  } else {
    const t1 = await post(`/api/specs/${spec.id}/tasks`, {
      name: 'P1-add-verbose-flag',
      prompt: 'Add a --verbose flag to the CLI. When set, print debug output for each command.',
      repos: ['edictum-ai/edictum-ts'],
      verification: ['--verbose flag exists', 'Debug output printed when set', 'Tests pass'],
    })

    const t2 = await post(`/api/specs/${spec.id}/tasks`, {
      name: 'P2-verbose-tests',
      prompt: 'Write tests for the --verbose flag. Cover: flag parsing, output presence, output absence.',
      repos: ['edictum-ai/edictum-ts'],
      verification: ['3+ test cases', 'All pass', 'Coverage for flag on/off'],
    })

    const t3 = await post(`/api/specs/${spec.id}/tasks`, {
      name: 'P3-verbose-docs',
      prompt: 'Document the --verbose flag in README.md and CLI help text.',
      repos: ['edictum-ai/edictum-ts'],
      requiredRole: 'docs',
      verification: ['README updated', 'CLI help shows flag'],
    })

    // P2 depends on P1, P3 depends on P1
    await post(`/api/tasks/${t2.id}/dependencies`, { dependsOnId: t1.id })
    await post(`/api/tasks/${t3.id}/dependencies`, { dependsOnId: t1.id })

    console.log(`Created 3 tasks: ${t1.name} → ${t2.name}, ${t3.name}`)

    // Trigger DAG evaluation
    await post('/api/tasks/evaluate-dag', { specId: spec.id })
    console.log('DAG evaluated — P1 should be ready')
  }

  console.log('\n--- Seed complete ---')
  console.log(`\nDashboard: http://localhost:5176`)
  console.log(`API:       ${API}`)
  console.log(`\nNext steps:`)
  console.log(`  pnpm dev        # start API + dashboard`)
  console.log(`  ductum status   # check from CLI`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
