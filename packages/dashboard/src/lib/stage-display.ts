/** Shared stage/status display constants — work in both light and dark themes. */

export const WORKFLOW_STAGES = [
  'understand',
  'implement',
  'ship',
  'done',
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

export const STAGE_LABEL: Record<string, string> = {
  understand: 'Understanding',
  implement: 'Implementing',
  ship: 'Shipping',
  done: 'Done',
  failed: 'Failed',
  stalled: 'Stalled',
}

// Theme-adaptive classes using dark: variant
export const STAGE_CLASSES: Record<string, string> = {
  understand: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/40',
  implement: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  ship: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40',
  done: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
  failed: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/40',
  stalled: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
}

export const SPEC_STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  reviewed: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/40',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
  implementing: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  done: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
}

export const TASK_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  assigned: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/40',
  'in-progress': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  ready: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/40',
  active: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  done: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
  failed: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/40',
  blocked: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
}

export const HARNESS_CLASSES: Record<string, string> = {
  'claude-agent-sdk': 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40',
  claude: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40',
  opencode: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/40',
}

export const EVIDENCE_CLASSES: Record<string, string> = {
  ci: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300',
  review: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  test: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  lint: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
}

export const GATE_CLASSES: Record<string, string> = {
  allowed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
}

export const LATCH_CLASSES: Record<string, string> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
  pending: 'text-amber-600 dark:text-amber-400',
}

/** Tool name → color class for activity feed */
export const TOOL_CLASSES: Record<string, string> = {
  Read: 'text-blue-600 dark:text-blue-400',
  Write: 'text-emerald-600 dark:text-emerald-400',
  Edit: 'text-emerald-600 dark:text-emerald-400',
  Bash: 'text-amber-600 dark:text-amber-400',
  Glob: 'text-cyan-600 dark:text-cyan-400',
  Grep: 'text-cyan-600 dark:text-cyan-400',
  ToolSearch: 'text-violet-600 dark:text-violet-400',
  Agent: 'text-pink-600 dark:text-pink-400',
}
