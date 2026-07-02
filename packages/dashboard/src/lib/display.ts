/** First N characters of an ID. Mirrors @ductum/core/display but avoids pulling Node-only deps into the browser bundle. */
export function shortId(id: string, len = 6): string {
  return id.slice(0, len)
}

export function shortHostPath(path: string): string {
  const value = path.trim()
  if (value === '') return value
  const projectMatch = value.match(/^\/Users\/[^/]+\/project\/([^/]+)(?:\/(.+))?$/)
  if (projectMatch) return projectMatch[2] == null ? projectMatch[1]! : `${projectMatch[1]}/${projectMatch[2]}`
  const factoryMatch = value.match(/\/\.ductum\/worktrees\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(.+))?$/)
  if (factoryMatch) return factoryMatch[4] == null ? `${factoryMatch[1]}/${factoryMatch[2]}/${factoryMatch[3]}` : `${factoryMatch[2]}/${factoryMatch[3]}/${factoryMatch[4]}`
  const tmpWorktree = value.match(/^\/tmp\/(?:ductum\/)?worktrees\/(.+)$/)
  if (tmpWorktree) return `worktrees/${tmpWorktree[1]}`
  const homeMatch = value.match(/^\/Users\/[^/]+\/(.+)$/)
  if (homeMatch) return `~/${homeMatch[1]}`
  return value
}

export function decisionActorLabel(decidedBy: string | null | undefined): string {
  const actor = decidedBy?.trim()
  if (actor == null || actor === '') return 'actor unknown'
  if (actor === 'system') return 'system actor'
  return `by ${actor}`
}
