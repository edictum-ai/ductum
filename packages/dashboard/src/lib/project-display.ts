import type { Decision, ProjectRun, Spec, Task, WorkItemSource } from '@/api/client'
import { shortId } from '@/lib/display'
import { classifyTaskKind } from '@/lib/task-kind'
import { deriveTaskLabelFromPrompt } from '@/lib/task-prompt-label'

export function displaySpecName(spec: Spec): string {
  if (isUsefulLabel(spec.name)) return spec.name
  const source = sourceLabel(spec.source)
  if (source != null) return source
  return `Spec ${shortId(spec.id)}`
}

export function displayTaskName(task: Task): string {
  const kind = classifyTaskKind(task)
  // Review/fix lineage names (`review-P1`, `fix-P1-r1`) are auto-generated
  // by the post-completion router and provide no human value beyond the
  // role badge. Try the prompt-derived label first for these tasks so
  // operators see `Review: Webhook notification backend` instead of
  // `review-P1`.
  if ((kind.kind === 'review' || kind.kind === 'fix')) {
    const promptLabel = deriveTaskLabelFromPrompt(task)
    if (promptLabel != null) return promptLabel
  }
  if (isUsefulLabel(task.name)) return task.name
  const source = sourceLabel(task.source)
  if (source != null) return source
  const promptLabel = deriveTaskLabelFromPrompt(task)
  if (promptLabel != null) return promptLabel
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
  const text = value ?? ''
  if (/\[redacted\]/i.test(text)) return true
  try {
    return /\[redacted\]/i.test(decodeURIComponent(text))
  } catch {
    return false
  }
}
