#!/usr/bin/env node

/**
 * load-spec — loads a YAML spec file into a running Ductum instance.
 *
 * Usage:
 *   pnpm load-spec specs/backlog/dx-fixes.yaml
 *   node scripts/load-spec.mjs specs/backlog/dx-fixes.yaml
 *
 * The YAML format:
 *   project: <project-name>
 *   spec:
 *     name: <spec-name>
 *     status: approved
 *     document: <description>
 *   tasks:
 *     - name: <task-name>
 *       prompt: |
 *         <multi-line prompt>
 *       repos: [<repo-name>]
 *       verification: [<checklist-item>, ...]
 *       depends_on: [<task-name>, ...]   # by name, not ID
 *       requiredRole: builder|reviewer|docs  # optional
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API = process.env.DUCTUM_API_URL || 'http://localhost:4100'

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${API}${path}`, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path}: ${res.status} ${text}`)
  }
  return res.json()
}

async function main() {
  const specPath = process.argv[2]
  if (!specPath) {
    console.error('Usage: load-spec <spec-file.yaml>')
    process.exit(1)
  }

  // Check API
  try { await api('GET', '/api/health') }
  catch { console.error('API not reachable at', API); process.exit(1) }

  // Parse YAML
  const { parse } = await import('yaml')
  const content = readFileSync(resolve(specPath), 'utf-8')
  const spec = parse(content)

  // Find project
  const projects = await api('GET', '/api/projects')
  const project = projects.find(p => p.name === spec.project)
  if (!project) {
    console.error(`Project not found: ${spec.project}`)
    console.error(`Available: ${projects.map(p => p.name).join(', ')}`)
    process.exit(1)
  }
  console.log(`Project: ${project.name} (${project.id})`)

  // Check if spec already exists
  const existingSpecs = await api('GET', `/api/projects/${project.id}/specs`)
  let specRecord = existingSpecs.find(s => s.name === spec.spec.name)

  if (specRecord) {
    console.log(`Spec exists: ${specRecord.name} (${specRecord.id})`)
    const existingTasks = await api('GET', `/api/specs/${specRecord.id}/tasks`)
    if (existingTasks.length > 0) {
      console.log(`  ${existingTasks.length} tasks already loaded. Skipping.`)
      console.log(`  To reload: delete the spec first.`)
      process.exit(0)
    }
  } else {
    specRecord = await api('POST', `/api/projects/${project.id}/specs`, {
      name: spec.spec.name,
      status: spec.spec.status || 'approved',
      document: spec.spec.document || '',
    })
    console.log(`Spec created: ${specRecord.name} (${specRecord.id})`)
  }

  // Resolve agent names to IDs
  const agents = await api('GET', '/api/agents')
  const agentByName = Object.fromEntries(agents.map(a => [a.name, a.id]))

  // Create tasks
  const taskMap = {} // name -> id
  for (const task of spec.tasks) {
    // Resolve assignedAgent name to ID
    let assignedAgentId = null
    if (task.assignedAgent) {
      assignedAgentId = agentByName[task.assignedAgent]
      if (!assignedAgentId) {
        console.error(`Error: agent "${task.assignedAgent}" not found for task "${task.name}"`)
        console.error(`Available agents: ${Object.keys(agentByName).join(', ')}`)
        process.exit(1)
      }
    }

    const created = await api('POST', `/api/specs/${specRecord.id}/tasks`, {
      name: task.name,
      prompt: task.prompt,
      repos: task.repos || [],
      verification: task.verification || [],
      requiredRole: task.requiredRole || null,
      complexity: task.complexity || null,
      assignedAgentId,
    })
    taskMap[task.name] = created.id
    console.log(`  Task: ${task.name} (${created.id})`)
  }

  // Wire dependencies
  let depCount = 0
  for (const task of spec.tasks) {
    if (!task.depends_on || task.depends_on.length === 0) continue
    for (const depName of task.depends_on) {
      const depId = taskMap[depName]
      if (!depId) {
        console.error(`  Warning: dependency "${depName}" not found for task "${task.name}"`)
        continue
      }
      await api('POST', `/api/tasks/${taskMap[task.name]}/dependencies`, {
        dependsOnId: depId,
      })
      depCount++
    }
  }
  if (depCount > 0) console.log(`  ${depCount} dependencies wired`)

  // Evaluate DAG
  await api('POST', '/api/tasks/evaluate-dag', { specId: specRecord.id })
  console.log('  DAG evaluated')

  // Show result
  const tasks = await api('GET', `/api/specs/${specRecord.id}/tasks`)
  console.log('')
  console.log('Tasks:')
  for (const t of tasks) {
    console.log(`  ${t.name}: ${t.status}`)
  }
  console.log('')
  console.log(`Loaded ${tasks.length} tasks. Ready tasks will be dispatched automatically.`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
