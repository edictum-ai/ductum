import type { Decision, Spec, Task } from '@ductum/core'

import type { DuctumApi } from './api-client.js'
import type { ImportedSpec } from './spec-import-types.js'

const IMPORT_DECIDER = 'ductum-spec-import'

interface ImportedDecisionTraceRow {
  decision: string
  context: string
  alternatives: string[]
}

export interface DecisionTraceItem {
  label: string
  context: string
}

export async function recordImportedDecisionTraces(
  api: DuctumApi,
  spec: Spec,
  imported: ImportedSpec,
  tasks: Task[],
): Promise<number> {
  const existing = await api.listDecisions({ specId: spec.id })
  const created: Decision[] = []
  const taskByName = new Map(tasks.map((task) => [task.name, task]))

  for (const row of buildImportedDecisionTraceRows('Spec', imported.spec.name, imported.spec.document ?? '')) {
    if (hasImportedDecision(existing, null, row)) continue
    created.push(await api.createDecision(buildDecision(spec.id, null, row)))
    existing.push(created.at(-1)!)
  }

  for (const importedTask of imported.tasks) {
    const task = taskByName.get(importedTask.name)
    if (task == null) continue
    for (const row of buildImportedDecisionTraceRows('Task', importedTask.name, importedTask.prompt)) {
      if (hasImportedDecision(existing, task.id, row)) continue
      created.push(await api.createDecision(buildDecision(spec.id, task.id, row)))
      existing.push(created.at(-1)!)
    }
  }

  return created.length
}

export function extractDecisionTrace(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const sectionStart = lines.findIndex((line) => /^#{2,6}\s+Decision Trace\b/i.test(line.trim()))
  if (sectionStart >= 0) {
    const section = lines.slice(sectionStart + 1)
    const end = section.findIndex((line) => /^#{1,6}\s+\S/.test(line.trim()))
    const body = (end >= 0 ? section.slice(0, end) : section).join('\n').trim()
    return body === '' ? null : body
  }

  const inline = lines.find((line) => /\bDecision Trace\s*:/i.test(line))
  return inline == null ? null : inline.trim()
}

export function extractDecisionTraceItems(markdown: string): DecisionTraceItem[] {
  const trace = extractDecisionTrace(markdown)
  if (trace == null) return []

  const inline = /^Decision Trace\s*:\s*(.+)$/i.exec(trace)
  if (inline?.[1] != null) {
    return [{ label: 'Decisions', context: normalizeDecisionTraceContext(inline[1]) }]
  }

  const items: DecisionTraceItem[] = []
  let current: { label: string; parts: string[] } | null = null
  for (const line of trace.split(/\r?\n/)) {
    const entry = /^\s*[-*]\s+([^:]+):\s*(.*)$/.exec(line)
    if (entry != null) {
      if (current != null) {
        items.push({
          label: normalizeDecisionTraceLabel(current.label),
          context: normalizeDecisionTraceContext(current.parts.join('\n')),
        })
      }
      current = {
        label: entry[1] ?? 'Trace',
        parts: entry[2] == null || entry[2].trim() === '' ? [] : [entry[2]],
      }
      continue
    }
    if (current == null) continue
    const trimmed = line.trim()
    if (trimmed !== '') current.parts.push(trimmed)
  }
  if (current != null) {
    items.push({
      label: normalizeDecisionTraceLabel(current.label),
      context: normalizeDecisionTraceContext(current.parts.join('\n')),
    })
  }

  const normalized = items.filter((item) => item.context !== '')
  if (normalized.length > 0) return dedupeDecisionTraceItems(normalized)

  return [{ label: 'Trace', context: normalizeDecisionTraceContext(trace) }]
}

function buildImportedDecisionTraceRows(
  kind: 'Spec' | 'Task',
  label: string,
  markdown: string,
): ImportedDecisionTraceRow[] {
  const trace = extractDecisionTrace(markdown)
  if (trace == null) return []
  const alternatives = decisionRefs(trace)
  return extractDecisionTraceItems(markdown).map((item) => ({
    decision: `Imported ${kind} Decision Trace: ${label} / ${item.label}`,
    context: item.context,
    alternatives,
  }))
}

function buildDecision(specId: Spec['id'], taskId: Task['id'] | null, row: ImportedDecisionTraceRow) {
  return {
    specId,
    ...(taskId == null ? {} : { taskId }),
    decision: row.decision,
    context: row.context,
    alternatives: row.alternatives,
    decidedBy: IMPORT_DECIDER,
  }
}

function hasImportedDecision(decisions: Decision[], taskId: Task['id'] | null, row: ImportedDecisionTraceRow) {
  return decisions.some((decision) =>
    decision.decidedBy === IMPORT_DECIDER &&
    decision.taskId === taskId &&
    decision.decision.trim() === row.decision.trim() &&
    decision.context.trim() === row.context.trim(),
  )
}

function decisionRefs(trace: string): string[] {
  return [...new Set([...trace.matchAll(/\b(?:decisions\/)?(\d{3})\b/g)].map((match) => `decisions/${match[1]}`))]
}

function normalizeDecisionTraceLabel(label: string) {
  return label.trim().replace(/\s+/g, ' ')
}

function normalizeDecisionTraceContext(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
    .trim()
}

function dedupeDecisionTraceItems(items: DecisionTraceItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.label}\u0000${item.context}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
