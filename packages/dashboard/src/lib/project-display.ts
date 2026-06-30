import type { Decision, ProjectRun, Spec, Task, WorkItemSource } from '@/api/client'
import { shortId } from '@/lib/display'
import { classifyTaskKind } from '@/lib/task-kind'

export function displaySpecName(spec: Spec): string {
  if (isUsefulLabel(spec.name)) return spec.name
  const source = sourceLabel(spec.source)
  if (source != null) return source
  return `Spec ${shortId(spec.id)}`
}

export function displayTaskName(task: Task): string {
  if (isUsefulLabel(task.name)) return task.name
  const source = sourceLabel(task.source)
  if (source != null) return source
  const kind = classifyTaskKind(task)
  return `${kind.roleCode} task ${shortId(task.id)}`
}

export function displayRunTaskName(run: Pick<ProjectRun, 'taskId' | 'taskName'>, task?: Task): string {
  if (task != null) return displayTaskName(task)
  if (isUsefulLabel(run.taskName)) return run.taskName
  return `Task ${shortId(run.taskId)}`
}

export function displayStoredName(value: string, fallback: string): string {
  return isUsefulLabel(value) ? value : fallback
}

export function displayDecisionTitle(decision: Pick<Decision, 'id' | 'decision'>): string {
  const raw = decision.decision.trim()
  if (raw !== '' && !hasRedactionMarker(raw)) return raw
  const normalized = raw.toLowerCase()
  if (normalized.includes('imported spec decision trace')) return 'Imported spec decision trace'
  if (normalized.includes('imported task decision trace')) return 'Imported task decision trace'
  return `Decision ${shortId(decision.id)}`
}

export function displayDecisionContext(value: string): string {
  return isUsefulLabel(value) ? value : 'Context hidden because it contains redacted source text.'
}

export function specRouteSegment(spec: Spec): string {
  return hasRedactionMarker(spec.name) ? spec.id : spec.name
}

export function taskRouteSegment(task: Task): string {
  return hasRedactionMarker(task.name) ? task.id : task.name
}

export function runTaskRouteSegment(run: Pick<ProjectRun, 'taskId' | 'taskName'>, task?: Task): string {
  if (task != null) return taskRouteSegment(task)
  return hasRedactionMarker(run.taskName) ? run.taskId : run.taskName
}

function sourceLabel(source: WorkItemSource | null | undefined): string | null {
  if (source == null) return null
  const issue = `${source.repoOwner}/${source.repoName}#${source.issueNumber}`
  return isUsefulLabel(source.title) ? `${issue}: ${source.title}` : issue
}

function isUsefulLabel(value: string | null | undefined): value is string {
  const text = value?.trim()
  if (text == null || text === '') return false
  if (hasRedactionMarker(text)) return false
  return true
}

export function hasRedactionMarker(value: string | null | undefined): boolean {
  return /\[redacted\]/i.test(value ?? '')
}
