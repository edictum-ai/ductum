import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

import type { ImportedSpec, ImportedTask } from './spec-import-types.js'

const VALID_COMPLEXITY = new Set(['simple', 'standard', 'complex'])
const VALID_ROLES = new Set(['builder', 'reviewer', 'docs', 'watcher'])
const VALID_SPEC_STATUS = new Set(['draft', 'reviewed', 'approved', 'implementing', 'done', 'failed'])
const VALID_TASK_STATUS = new Set(['pending', 'blocked', 'ready', 'active', 'done', 'failed'])

export async function parseYamlSpec(
  filePath: string,
  projectOverride?: string,
): Promise<ImportedSpec> {
  const content = await readFile(filePath, 'utf8')
  return parseYamlContent(content, projectOverride)
}

export function parseYamlContent(
  content: string,
  projectOverride?: string,
): ImportedSpec {
  const doc = parseYaml(content) as Record<string, unknown>
  return parseYamlObject(doc, projectOverride)
}

export function parseYamlObject(
  doc: unknown,
  projectOverride?: string,
): ImportedSpec {
  if (doc == null || typeof doc !== 'object') {
    throw new Error('Invalid YAML content')
  }
  const root = doc as Record<string, unknown>

  const project = projectOverride ?? requireField<string>(root, 'project', 'string')
  const specSection = requireField<Record<string, unknown>>(root, 'spec', 'object')
  const rawTasksSection = root.tasks
  const fanOutTasks = parseFanOutTasks(specSection)
  if (rawTasksSection == null && fanOutTasks.length === 0) {
    throw new Error('Missing required field: tasks')
  }
  if (rawTasksSection != null && !Array.isArray(rawTasksSection)) {
    throw new Error('Field "tasks" must be an array')
  }

  const rawMaxFix = specSection.maxFixIterations
  if (rawMaxFix != null && (
    typeof rawMaxFix !== 'number' || !Number.isInteger(rawMaxFix) || rawMaxFix <= 0
  )) {
    throw new Error('spec.maxFixIterations must be a positive integer')
  }
  const rawSpecStatus = optionalField<string>(specSection, 'status', 'string')
  if (rawSpecStatus != null && !VALID_SPEC_STATUS.has(rawSpecStatus)) {
    throw new Error('spec.status must be one of: draft, reviewed, approved, implementing, done')
  }
  const maxFixIterations = rawMaxFix as number | undefined
  const spec: ImportedSpec['spec'] = {
    name: requireField<string>(specSection, 'name', 'string'),
    status: rawSpecStatus as ImportedSpec['spec']['status'],
    document: optionalField<string>(specSection, 'document', 'string'),
    ...(maxFixIterations != null ? { maxFixIterations } : {}),
  }

  const tasks = (rawTasksSection ?? []).map((entry, index) => {
    if (entry == null || typeof entry !== 'object') {
      throw new Error(`tasks[${index}] must be an object`)
    }
    return parseTaskEntry(entry as Record<string, unknown>, `tasks[${index}]`)
  })
  tasks.push(...fanOutTasks)
  validateTaskNames(tasks)
  validateDependencyRefs(tasks)
  return { project, spec, tasks }
}

function parseFanOutTasks(specSection: Record<string, unknown>): ImportedTask[] {
  if (specSection.fanOut == null) return []
  if (typeof specSection.fanOut !== 'object' || Array.isArray(specSection.fanOut)) {
    throw new Error('spec.fanOut must be an object')
  }
  const targets = (specSection.fanOut as Record<string, unknown>).targets
  if (!Array.isArray(targets)) throw new Error('spec.fanOut.targets must be an array')
  return targets.map((entry, index) => {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`spec.fanOut.targets[${index}] must be an object`)
    }
    const raw = entry as Record<string, unknown>
    const targetRef = optionalField<string>(raw, 'targetRef', 'string') ?? optionalField<string>(raw, 'target', 'string')
    if (targetRef == null || targetRef.trim() === '') {
      throw new Error(`spec.fanOut.targets[${index}].targetRef is required`)
    }
    const name = optionalField<string>(raw, 'taskName', 'string')
      ?? optionalField<string>(raw, 'name', 'string')
      ?? targetRef
    return parseTaskEntry({ ...raw, name, target: targetRef }, `spec.fanOut.targets[${index}]`)
  })
}

function parseTaskEntry(entry: Record<string, unknown>, label: string): ImportedTask {
  const rawComplexity = optionalField<string>(entry, 'complexity', 'string')
  if (rawComplexity != null && !VALID_COMPLEXITY.has(rawComplexity)) {
    throw new Error(`${label}.complexity must be one of: simple, standard, complex`)
  }
  const rawRole = optionalField<string>(entry, 'requiredRole', 'string')
  if (rawRole != null && !VALID_ROLES.has(rawRole)) {
    throw new Error(`${label}.requiredRole must be one of: builder, reviewer, docs, watcher`)
  }
  const rawStatus = optionalField<string>(entry, 'status', 'string')
  if (rawStatus != null && !VALID_TASK_STATUS.has(rawStatus)) {
    throw new Error(`${label}.status must be one of: pending, blocked, ready, active, done, failed`)
  }
  const target = optionalField<string>(entry, 'target', 'string')
  if (target != null && target.trim() === '') throw new Error(`${label}.target must not be empty`)
  const assignedAgent = optionalField<string>(entry, 'assignedAgent', 'string')
  if (assignedAgent != null && assignedAgent.trim() === '') {
    throw new Error(`${label}.assignedAgent must not be empty`)
  }
  return {
    name: requireField<string>(entry, 'name', 'string'),
    ...(target == null ? {} : { target }),
    prompt: requireField<string>(entry, 'prompt', 'string').trim(),
    repos: optionalStringArray(entry, 'repos'),
    verification: optionalStringArray(entry, 'verification'),
    dependsOn: optionalStringArray(entry, 'depends_on'),
    assignedAgent,
    complexity: rawComplexity as ImportedTask['complexity'],
    requiredRole: rawRole as ImportedTask['requiredRole'],
    status: rawStatus as ImportedTask['status'],
  }
}

function validateDependencyRefs(tasks: ImportedTask[]): void {
  const names = new Set(tasks.map((t) => t.name))
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!names.has(dep)) {
        throw new Error(`Task "${task.name}" depends on "${dep}" which is not defined in this spec`)
      }
    }
  }
}

function validateTaskNames(tasks: ImportedTask[]): void {
  const names = new Set<string>()
  for (const task of tasks) {
    if (names.has(task.name)) throw new Error(`Duplicate task name: ${task.name}`)
    names.add(task.name)
  }
}

function requireField<T>(obj: Record<string, unknown>, field: string, type: string): T {
  const value = obj[field]
  if (value == null) throw new Error(`Missing required field: ${field}`)
  if (type === 'string' && typeof value !== 'string') throw new Error(`Field "${field}" must be a string`)
  if (type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`Field "${field}" must be an object`)
  }
  if (type === 'array' && !Array.isArray(value)) throw new Error(`Field "${field}" must be an array`)
  return value as T
}

function optionalField<T>(obj: Record<string, unknown>, field: string, type: string): T | undefined {
  const value = obj[field]
  if (value == null) return undefined
  if (type === 'string' && typeof value !== 'string') throw new Error(`Field "${field}" must be a string`)
  return value as T
}

function optionalStringArray(obj: Record<string, unknown>, field: string): string[] {
  const value = obj[field]
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`Field "${field}" must be an array`)
  return value.map((item) => String(item))
}
