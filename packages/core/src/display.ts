/**
 * Human-readable display labels for IDs and paths.
 *
 * IDs are the internal plumbing — display labels are for every surface
 * a human touches: dashboard URLs, CLI output, worktree paths, logs.
 */

/** First N characters of an ID. Default 6. */
export function shortId(id: string, len = 6): string {
  return id.slice(0, len)
}

/**
 * Compact label for a run: `project/task/shortId`
 * Used in CLI output, log messages, MCP responses.
 */
export function runLabel(projectName: string, taskName: string, runId: string): string {
  return `${projectName}/${taskName}/${shortId(runId)}`
}

/**
 * Dashboard URL path for a run: `/:project/:spec/:task/:shortId`
 */
export function runPath(projectName: string, specName: string, taskName: string, runId: string): string {
  return `/${enc(projectName)}/${enc(specName)}/${enc(taskName)}/${shortId(runId)}`
}

/** Dashboard URL path for a task: `/:project/:spec/:task` */
export function taskPath(projectName: string, specName: string, taskName: string): string {
  return `/${enc(projectName)}/${enc(specName)}/${enc(taskName)}`
}

/** Dashboard URL path for a spec: `/:project/:spec` */
export function specPath(projectName: string, specName: string): string {
  return `/${enc(projectName)}/${enc(specName)}`
}

/** Dashboard URL path for a project: `/:project` */
export function projectPath(projectName: string): string {
  return `/${enc(projectName)}`
}

/**
 * Filesystem-safe slug for worktree directories: `taskName-shortId`
 */
export function worktreeSlug(taskName: string, runId: string): string {
  const sanitized = taskName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)
  return `${sanitized}-${shortId(runId)}`
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}
