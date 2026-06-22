interface EventStreamFilters {
  runId?: string
  taskId?: string
  specId?: string
  projectId?: string
}

export function buildEventStreamUrl(filters: EventStreamFilters = {}) {
  const params = new URLSearchParams()
  if (filters.runId) params.set('runId', filters.runId)
  if (filters.taskId) params.set('taskId', filters.taskId)
  if (filters.specId) params.set('specId', filters.specId)
  if (filters.projectId) params.set('projectId', filters.projectId)

  return `/api/events/stream${params.toString() ? `?${params}` : ''}`
}
