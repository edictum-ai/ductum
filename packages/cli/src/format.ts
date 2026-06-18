import {
  DISPLAY_STATUS_LABEL,
  deriveDisplayStatus,
  redactPublicOutput,
  redactPublicText,
  type Run,
  runLabel,
  type Task,
  type TaskDependency,
  type DisplayStatus,
} from '@ductum/core'

const ANSI = {
  reset: '\u001B[0m',
  gray: '\u001B[90m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  cyan: '\u001B[36m',
} as const

export interface TableColumn {
  key: string
  label: string
  align?: 'left' | 'right'
}

export function formatRunLabel(projectName: string, taskName: string, runId: string): string {
  return runLabel(projectName, taskName, runId)
}

export function formatJson(value: unknown) {
  return JSON.stringify(redactPublicOutput(value), null, 2)
}

export function stripAnsi(text: string) {
  return text.replace(/\u001B\[[0-9;]*m/g, '')
}

export function formatStatusBadge(status: string | null | undefined) {
  const value = status ?? 'unknown'
  const color =
    value === 'done'
      ? ANSI.green
      : value === 'failed' || value === 'fail' || value === 'stalled'
        ? ANSI.red
        : value === 'blocked' || value === 'pending'
          ? ANSI.gray
          : ANSI.yellow
  return `${color}${value}${ANSI.reset}`
}

type RunWithUiStatus = Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> & {
  ui?: { status?: { key?: DisplayStatus; label?: string } }
}

/**
 * Format the user-facing display status for a run.
 * When the API sends an enriched UI status, prefer it over local derivation
 * so handoff-only states such as "awaiting review" stay visible in the CLI.
 */
export function formatDisplayStatus(run: RunWithUiStatus): string {
  const status = run.ui?.status?.key ?? deriveDisplayStatus(run)
  const label = run.ui?.status?.label ?? DISPLAY_STATUS_LABEL[status]
  const color: Record<DisplayStatus, string> = {
    running: ANSI.cyan,
    awaiting_review: ANSI.yellow,
    awaiting_approval: ANSI.yellow,
    failed: ANSI.red,
    stalled: ANSI.red,
    cancelled: ANSI.gray,
    paused: ANSI.gray,
    frozen: ANSI.yellow,
    quarantined: ANSI.red,
    done: ANSI.green,
  }
  return `${color[status]}${label}${ANSI.reset}`
}

export function formatTable<T extends object>(columns: TableColumn[], rows: T[]) {
  if (rows.length === 0) {
    return '(empty)'
  }

  const widths = columns.map((column) => {
    const values = rows.map((row) => stringifyCell((row as Record<string, unknown>)[column.key]))
    return Math.max(stripAnsi(column.label).length, ...values.map((value) => stripAnsi(value).length))
  })

  const header = columns.map((column, index) => padCell(column.label, widths[index] ?? 0, column.align)).join('  ')
  const separator = widths.map((width) => '-'.repeat(width)).join('  ')
  const body = rows.map((row) =>
    columns
      .map((column, index) =>
        padCell(stringifyCell((row as Record<string, unknown>)[column.key]), widths[index] ?? 0, column.align),
      )
      .join('  '),
  )
  return [header, separator, ...body].join('\n')
}

export function formatTaskDag(tasks: Task[], dependencies: TaskDependency[]) {
  if (tasks.length === 0) {
    return '(empty)'
  }

  const orderedTasks = tasks.map((task) => task.id)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const depsByTask = new Map(tasks.map((task) => [task.id, [] as Task['id'][]]))
  const childrenByTask = new Map(tasks.map((task) => [task.id, [] as Task['id'][]]))

  for (const dependency of dependencies) {
    depsByTask.get(dependency.taskId)?.push(dependency.dependsOnId)
    childrenByTask.get(dependency.dependsOnId)?.push(dependency.taskId)
  }

  const roots = orderedTasks.filter((taskId) => (depsByTask.get(taskId) ?? []).length === 0)
  const seen = new Set<string>()
  const lines: string[] = []

  const visit = (taskId: Task['id'], prefix: string, isLast: boolean, isRoot = false) => {
    const task = taskById.get(taskId)
    if (task == null) {
      return
    }

    const marker = isRoot ? '' : isLast ? '\\- ' : '|- '
    const dependencyList = depsByTask.get(taskId) ?? []
    const suffix = dependencyList.length <= 1 ? '' : ` deps:${dependencyList.length}`
    lines.push(`${prefix}${marker}${task.name} [${task.id}] ${task.status}${suffix}`.trimEnd())

    const nextPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '|  '}`
    const children = (childrenByTask.get(taskId) ?? [])
      .slice()
      .sort((left, right) => orderedTasks.indexOf(left) - orderedTasks.indexOf(right))

    children.forEach((childId, index) => {
      if (seen.has(`${taskId}:${childId}`)) {
        return
      }
      seen.add(`${taskId}:${childId}`)
      visit(childId, nextPrefix, index === children.length - 1)
    })
  }

  roots.forEach((rootId, index) => visit(rootId, '', index === roots.length - 1, true))

  for (const taskId of orderedTasks) {
    if (roots.includes(taskId)) {
      continue
    }
    if (!lines.some((line) => line.includes(`[${taskId}]`))) {
      visit(taskId, '', true, true)
    }
  }

  return lines.join('\n')
}

export function formatSummaryRows(summary: Record<string, unknown>) {
  return Object.entries(summary)
    .map(([key, value]) => `${key}: ${stringifyCell(value)}`)
    .join('\n')
}

function stringifyCell(value: unknown): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    return redactPublicText(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(redactPublicOutput(value))
}

function padCell(value: string, width: number, align: 'left' | 'right' = 'left') {
  const padding = Math.max(0, width - stripAnsi(value).length)
  return align === 'right' ? `${' '.repeat(padding)}${value}` : `${value}${' '.repeat(padding)}`
}
